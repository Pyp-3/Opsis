package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"image"
	"image/jpeg"
	"image/png"
	"net/http/httptest"
	"testing"
)

func encodedPicture(t *testing.T, width, height int, asJPEG bool) []byte {
	t.Helper()
	picture := image.NewRGBA(image.Rect(0, 0, width, height))
	var out bytes.Buffer
	var err error
	if asJPEG {
		err = jpeg.Encode(&out, picture, nil)
	} else {
		err = png.Encode(&out, picture)
	}
	if err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

// getImage reads an image route, returning the status and the response for header checks.
func (c *testClient) getImage(path string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", path, nil)
	r.RemoteAddr = "127.0.0.1:12345"
	if c.cookie != nil {
		r.AddCookie(c.cookie)
	}
	w := httptest.NewRecorder()
	c.server.ServeHTTP(w, r)
	return w
}

// Info images go through the embedded shared checks: only real PNG, JPEG or WebP bytes are
// stored, served sandboxed as their checked type, and only to people who may read the board.
func TestBoardInfoImages(t *testing.T) {
	s := newTestServer(t)
	owner := signup(t, s, "owner@example.com")
	stranger := signup(t, s, "stranger@example.com")
	guest := &testClient{t: t, server: s}
	created := owner.request("POST", "/v1/boards", map[string]any{"title": "Book"}, 201)
	path := "/v1/boards/" + created["id"].(string)
	upload := func(c *testClient, data []byte, status int) map[string]any {
		return c.request("POST", path+"/images", map[string]any{"data": base64.StdEncoding.EncodeToString(data)}, status)
	}

	picture := encodedPicture(t, 32, 20, false)
	sum := sha256.Sum256(picture)
	id := hex.EncodeToString(sum[:])
	stored := upload(owner, picture, 201)
	if stored["id"] != id || stored["mediaType"] != "image/png" || stored["width"] != float64(32) || stored["height"] != float64(20) {
		t.Fatal("unexpected stored image", stored)
	}
	if upload(owner, encodedPicture(t, 8, 8, true), 201)["mediaType"] != "image/jpeg" {
		t.Fatal("a JPEG was not recognised")
	}
	upload(owner, []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), 400)
	upload(owner, encodedPicture(t, 2401, 4, false), 400)
	owner.request("POST", path+"/images", map[string]any{"data": "not base64!"}, 400)
	upload(stranger, picture, 404)

	served := owner.getImage(path + "/images/" + id)
	if served.Code != 200 || !bytes.Equal(served.Body.Bytes(), picture) {
		t.Fatal("the owner could not read the image", served.Code)
	}
	for header, want := range map[string]string{
		"Content-Type":            "image/png",
		"X-Content-Type-Options":  "nosniff",
		"Content-Security-Policy": "default-src 'none'; sandbox",
	} {
		if got := served.Header().Get(header); got != want {
			t.Fatalf("%s: got %q, want %q", header, got, want)
		}
	}
	guestPath := "/v1/guest/boards/" + created["id"].(string) + "/images/" + id
	if stranger.getImage(path+"/images/"+id).Code != 404 || guest.getImage(guestPath).Code != 404 {
		t.Fatal("a private board's image was readable")
	}
	if owner.getImage(path+"/images/..%2F..%2Fsecret").Code != 404 {
		t.Fatal("a malformed image name was served")
	}

	shared := owner.request("PATCH", path, map[string]any{"revision": 1, "visibility": "link"}, 200)
	if stranger.getImage(path+"/images/"+id).Code != 200 || guest.getImage(guestPath).Code != 200 {
		t.Fatal("a link board's image did not open for readers")
	}
	upload(stranger, picture, 403)

	// Another board reads the image only once its document shows it; deleting the original
	// keeps the image for the board that still shows it.
	other := stranger.request("POST", "/v1/boards", map[string]any{"title": "Mine"}, 201)
	otherPath := "/v1/boards/" + other["id"].(string)
	if stranger.getImage(otherPath+"/images/"+id).Code != 404 {
		t.Fatal("a board read an image it does not show")
	}
	board := map[string]any{
		"version": 2, "title": "Mine", "description": "", "agent": "claude",
		"nodes": []any{}, "edges": []any{}, "positions": map[string]any{},
		"info": map[string]any{"text": "![Rack](image:" + id + ")"},
	}
	stranger.request("PUT", otherPath, map[string]any{"snapshot": map[string]any{"board": board, "past": []any{}, "future": []any{}}, "revision": 1}, 200)
	if stranger.getImage(otherPath+"/images/"+id).Code != 200 {
		t.Fatal("a board could not read an image its document shows")
	}
	owner.request("DELETE", path, map[string]any{"revision": shared["revision"]}, 204)
	if stranger.getImage(otherPath+"/images/"+id).Code != 200 {
		t.Fatal("deleting one board removed an image another board shows")
	}
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM board_images`).Scan(&count); err != nil || count != 1 {
		t.Fatal("unused images were not removed with their board", count, err)
	}
}
