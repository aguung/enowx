package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/store"
)

// Keys manages gateway API keys. Keys are stored as-is (re-viewable), so the
// secret is returned on list too.
type Keys struct {
	store store.KeyStore
	// onChange re-registers the user's API-key hashes with the cloud (for Free-AI
	// auth) after a key is added or removed. Nil if not syncing.
	onChange func()
}

func NewKeys(s store.KeyStore) *Keys { return &Keys{store: s} }

// SetOnChange wires the Free-AI key-hash re-registration hook.
func (h *Keys) SetOnChange(f func()) { h.onChange = f }

func (h *Keys) changed() {
	if h.onChange != nil {
		go h.onChange()
	}
}

type keyDTO struct {
	ID            int64   `json:"id"`
	Label         string  `json:"label"`
	Secret        string  `json:"secret"`
	TokenLimit    int64   `json:"token_limit"`
	TokensUsed    int64   `json:"tokens_used"`
	MaxConcurrent int64   `json:"max_concurrent"`
	ExpiresAt     *string `json:"expires_at"`
	Enabled       bool    `json:"enabled"`
	CreatedAt     string  `json:"created_at"`
	LastUsed      *string `json:"last_used"`
}

func toKeyDTO(k store.APIKey) keyDTO {
	d := keyDTO{
		ID:            k.ID,
		Label:         k.Label,
		Secret:        k.Secret,
		TokenLimit:    k.TokenLimit,
		TokensUsed:    k.TokensUsed,
		MaxConcurrent: k.MaxConcurrent,
		Enabled:       k.Enabled,
		CreatedAt:     k.CreatedAt.Format("2006-01-02 15:04"),
	}
	if k.ExpiresAt != nil {
		s := k.ExpiresAt.Format("2006-01-02")
		d.ExpiresAt = &s
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
		Label         string `json:"label"`
		TokenLimit    int64  `json:"token_limit"`
		MaxConcurrent int64  `json:"max_concurrent"`
		ExpiresInDays int    `json:"expires_in_days"`
	}
	body, _ := io.ReadAll(r.Body)
	_ = json.Unmarshal(body, &in)

	secret, err := generateKey()
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, "failed to generate key")
		return
	}
	key := store.APIKey{
		Label:         in.Label,
		Secret:        secret,
		TokenLimit:    max64(in.TokenLimit, 0),
		MaxConcurrent: max64(in.MaxConcurrent, 0),
		Enabled:       true,
	}
	if in.ExpiresInDays > 0 {
		t := time.Now().AddDate(0, 0, in.ExpiresInDays)
		key.ExpiresAt = &t
	}
	id, err := h.store.Add(r.Context(), key)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.changed() // register the new key's hash with the cloud (Free-AI auth)
	writeData(w, map[string]any{"id": id, "secret": secret})
}

func max64(v, lo int64) int64 {
	if v < lo {
		return lo
	}
	return v
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
	h.changed() // re-register remaining key hashes with the cloud
	writeData(w, map[string]any{"ok": true})
}

func generateKey() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "enx-" + hex.EncodeToString(b), nil
}
