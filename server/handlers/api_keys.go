package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/store"
)

// Keys manages gateway API keys. Keys are stored as-is (re-viewable), so the
// secret is returned on list too.
type Keys struct{ store store.KeyStore }

func NewKeys(s store.KeyStore) *Keys { return &Keys{store: s} }

type keyDTO struct {
	ID        int64   `json:"id"`
	Label     string  `json:"label"`
	Secret    string  `json:"secret"`
	CreatedAt string  `json:"created_at"`
	LastUsed  *string `json:"last_used"`
}

func toKeyDTO(k store.APIKey) keyDTO {
	d := keyDTO{
		ID:        k.ID,
		Label:     k.Label,
		Secret:    k.Secret,
		CreatedAt: k.CreatedAt.Format("2006-01-02 15:04"),
	}
	if k.LastUsed != nil {
		s := k.LastUsed.Format("2006-01-02 15:04")
		d.LastUsed = &s
	}
	return d
}

func (h *Keys) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.store.List(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]keyDTO, 0, len(rows))
	for _, k := range rows {
		out = append(out, toKeyDTO(k))
	}
	writeData(w, out)
}

func (h *Keys) Add(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Label string `json:"label"`
	}
	body, _ := io.ReadAll(r.Body)
	_ = json.Unmarshal(body, &in)

	secret, err := generateKey()
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, "failed to generate key")
		return
	}
	id, err := h.store.Add(r.Context(), store.APIKey{Label: in.Label, Secret: secret})
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"id": id, "secret": secret})
}

func (h *Keys) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.store.Delete(r.Context(), id); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

func generateKey() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "enx-" + hex.EncodeToString(b), nil
}
