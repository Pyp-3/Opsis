package api

import "net/http"

func (s *Server) linkRoutes() {
	s.handle("GET /v1/boards/{id}/backlinks", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		if !s.validID(id) {
			return failure(400, "Invalid board ID.")
		}
		board, err := s.readBoard(s.db, id)
		if err != nil {
			return err
		}
		editor, err := isBoardEditor(s.db, id, user.ID)
		if err != nil {
			return err
		}
		if board == nil || (board.OwnerID.String != user.ID && (board.Archived || (board.Visibility != "public" && !editor))) {
			return boardMissing()
		}
		rows, err := s.db.Query(`SELECT b.id,b.title,json_extract(n.value,'$.id'),json_extract(n.value,'$.label')
    FROM boards_v2 b,json_each(b.snapshot,'$.board.nodes') n
    WHERE json_extract(n.value,'$.linkedBoardId')=? AND b.archived=0
    AND (b.owner_id=? OR b.visibility='public' OR EXISTS
      (SELECT 1 FROM board_editors e WHERE e.board_id=b.id AND e.user_id=?))
    ORDER BY b.title,b.id,json_extract(n.value,'$.id')`, id, user.ID, user.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		links := []map[string]string{}
		for rows.Next() {
			var id, title, concept, label string
			if err := rows.Scan(&id, &title, &concept, &label); err != nil {
				return err
			}
			links = append(links, map[string]string{"id": id, "title": title, "conceptId": concept, "label": label})
		}
		if err := rows.Err(); err != nil {
			return err
		}
		writeJSON(w, 200, links)
		return nil
	})
}
