package api

import (
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"time"
)

// Images in a page's Info, stored once and named by the SHA-256 of their bytes. The rules for
// which bytes are an image live in the shared schema (board-images.ts); see the Fastify host's
// board-images.ts for the same routes.

var imageIDPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Reading a board's images counts with board reads, not the work budget.
var boardImagePath = regexp.MustCompile(`^/v1/(?:guest/)?boards/[0-9a-f-]{36}/images/[0-9a-f]{64}$`)

type imageLimits struct {
	Bytes       int `json:"bytes"`
	HeaderBytes int `json:"headerBytes"`
	Board       int `json:"board"`
}

type imageInfo struct {
	MediaType string `json:"mediaType"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
}

type execer interface {
	Exec(string, ...any) (sql.Result, error)
}

// recordImages lets a board read the stored images its snapshot shows (only images already
// stored, named by content hash, which a reader learns by seeing the image).
func (s *Server) recordImages(tx execer, boardID string, snapshot json.RawMessage) error {
	raw, err := s.contracts.Apply("snapshotImages", snapshot)
	if err != nil {
		return err
	}
	var ids []string
	if err := json.Unmarshal(raw, &ids); err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO board_image_refs SELECT ?,id FROM board_images WHERE id=?`, boardID, id); err != nil {
			return err
		}
	}
	return nil
}

// removeUnusedImages deletes images no remaining board shows and no template names (a
// template keeps its board's text).
func removeUnusedImages(tx execer) error {
	_, err := tx.Exec(`DELETE FROM board_images WHERE id NOT IN (SELECT image_id FROM board_image_refs) AND NOT EXISTS (SELECT 1 FROM board_templates t WHERE instr(t.board, board_images.id) > 0)`)
	return err
}

func (s *Server) imageLimits() (imageLimits, error) {
	var limits imageLimits
	raw, err := s.contracts.Apply("imageLimits", nil)
	if err == nil {
		err = json.Unmarshal(raw, &limits)
	}
	return limits, err
}

func imageMissing() error { return failure(404, "Image not found.") }

func (s *Server) sendImage(w http.ResponseWriter, boardID, image string) error {
	if !imageIDPattern.MatchString(image) {
		return imageMissing()
	}
	var mediaType string
	var data []byte
	err := s.db.QueryRow(`SELECT i.media_type,i.data FROM board_images i JOIN board_image_refs r ON r.image_id=i.id WHERE r.board_id=? AND i.id=?`, boardID, image).Scan(&mediaType, &data)
	if errors.Is(err, sql.ErrNoRows) {
		return imageMissing()
	}
	if err != nil {
		return err
	}
	header := w.Header()
	header.Set("Content-Type", mediaType)
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	header.Set("Cross-Origin-Resource-Policy", "same-origin")
	header.Set("Content-Disposition", "inline")
	header.Set("Cache-Control", "private, max-age=31536000, immutable")
	w.WriteHeader(200)
	_, err = w.Write(data)
	return err
}

func (s *Server) imageRoutes() {
	s.handle("POST /v1/boards/{id}/images", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		if !s.validID(id) {
			return failure(400, "Invalid board ID.")
		}
		limits, err := s.imageLimits()
		if err != nil {
			return err
		}
		raw, err := rawBody(w, r, int64(limits.Bytes*4/3+1024))
		if err != nil {
			return err
		}
		refuse := failure(400, fmt.Sprintf("Choose a PNG, JPEG or WebP image up to %d MB.", limits.Bytes/1024/1024))
		var body struct {
			Data string `json:"data"`
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			return refuse
		}
		// Strict base64, so the bytes checked are exactly the bytes sent.
		data, err := base64.StdEncoding.Strict().DecodeString(body.Data)
		if err != nil || len(data) == 0 || len(data) > limits.Bytes {
			return refuse
		}
		board, err := s.readBoard(s.db, id)
		if err != nil {
			return err
		}
		editor, err := isBoardEditor(s.db, id, user.ID)
		if err != nil {
			return err
		}
		if board == nil || (board.OwnerID.String != user.ID && (board.Archived || !editor)) {
			if board != nil && !board.Archived && board.Visibility != "private" {
				return failure(403, "Only the owner and editors can add images.")
			}
			return boardMissing()
		}
		header := data
		if len(header) > limits.HeaderBytes {
			header = header[:limits.HeaderBytes]
		}
		checked, err := s.contracts.Apply("imageInfo", map[string]any{"header": base64.StdEncoding.EncodeToString(header), "size": len(data)})
		if err != nil {
			return err
		}
		var info *imageInfo
		if err := json.Unmarshal(checked, &info); err != nil || info == nil {
			return refuse
		}
		sum := sha256.Sum256(data)
		imageID := hex.EncodeToString(sum[:])
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		var known, count int
		if err := tx.QueryRow(`SELECT count(*) FROM board_image_refs WHERE board_id=? AND image_id=?`, id, imageID).Scan(&known); err != nil {
			return err
		}
		if known == 0 {
			if err := tx.QueryRow(`SELECT count(*) FROM board_image_refs WHERE board_id=?`, id).Scan(&count); err != nil {
				return err
			}
			if count >= limits.Board {
				return failure(409, fmt.Sprintf("A board can hold up to %d images.", limits.Board))
			}
			if _, err := tx.Exec(`INSERT OR IGNORE INTO board_images VALUES(?,?,?,?,?,?)`, imageID, info.MediaType, info.Width, info.Height, data, time.Now().UnixMilli()); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO board_image_refs VALUES(?,?)`, id, imageID); err != nil {
				return err
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		writeJSON(w, 201, map[string]any{"id": imageID, "mediaType": info.MediaType, "width": info.Width, "height": info.Height})
		return nil
	})
	s.handle("GET /v1/boards/{id}/images/{image}", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		if !s.validID(id) {
			return imageMissing()
		}
		board, err := s.readBoard(s.db, id)
		if err != nil {
			return err
		}
		editor, err := isBoardEditor(s.db, id, user.ID)
		if err != nil {
			return err
		}
		if board == nil || (board.OwnerID.String != user.ID && (board.Archived || (board.Visibility == "private" && !editor))) {
			return imageMissing()
		}
		return s.sendImage(w, id, r.PathValue("image"))
	})
	// A link or public board's images open for anyone, as the board itself does.
	s.handle("GET /v1/guest/boards/{id}/images/{image}", func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		if !s.validID(id) {
			return imageMissing()
		}
		board, err := s.readBoard(s.db, id)
		if err != nil {
			return err
		}
		if board == nil || board.Archived || board.Visibility == "private" {
			return imageMissing()
		}
		return s.sendImage(w, id, r.PathValue("image"))
	})
}
