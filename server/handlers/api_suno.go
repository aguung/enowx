package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/enowdev/enowx/core/suno"
	"github.com/enowdev/enowx/core/transport"
	"github.com/enowdev/enowx/store"
)

// Suno exposes AI music generation (create task + poll). The API key comes from a
// pooled Suno account's api_key credential.
type Suno struct {
	store  store.AccountStore
	client *suno.Client
}

func NewSuno(s store.AccountStore, doer transport.Doer) *Suno {
	return &Suno{store: s, client: suno.New(doer)}
}

// key returns the api_key of the first enabled Suno account, or "".
func (h *Suno) key(r *http.Request) string {
	rows, err := h.store.List(r.Context(), "suno")
	if err != nil {
		return ""
	}
	for _, a := range rows {
		if a.Disabled {
			continue
		}
		if k := strings.TrimSpace(a.Creds["api_key"]); k != "" {
			return k
		}
	}
	return ""
}

// GET /api/music/suno/key -> { configured }
func (h *Suno) GetKey(w http.ResponseWriter, r *http.Request) {
	writeData(w, map[string]any{"configured": h.key(r) != ""})
}

// POST /api/music/generate { prompt, style?, title?, model?, instrumental?, custom_mode? }
func (h *Suno) Generate(w http.ResponseWriter, r *http.Request) {
	key := h.key(r)
	if key == "" {
		writeAPIErr(w, http.StatusBadRequest, "no Suno account configured (add one in Providers)")
		return
	}
	var in struct {
		Prompt       string `json:"prompt"`
		Style        string `json:"style"`
		Title        string `json:"title"`
		Model        string `json:"model"`
		Instrumental bool   `json:"instrumental"`
		CustomMode   bool   `json:"custom_mode"`
		NegativeTags string `json:"negative_tags"`
		VocalGender  string `json:"vocal_gender"`
	}
	body, _ := io.ReadAll(r.Body)
	if err := json.Unmarshal(body, &in); err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	if strings.TrimSpace(in.Prompt) == "" && !in.CustomMode {
		writeAPIErr(w, http.StatusBadRequest, "prompt is required")
		return
	}
	taskID, err := h.client.Generate(key, suno.GenerateRequest{
		Prompt: in.Prompt, Style: in.Style, Title: in.Title, Model: in.Model,
		Instrumental: in.Instrumental, CustomMode: in.CustomMode,
		NegativeTags: in.NegativeTags, VocalGender: in.VocalGender,
	})
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeData(w, map[string]any{"task_id": taskID})
}

// GET /api/music/generate/status?task_id=...
func (h *Suno) Status(w http.ResponseWriter, r *http.Request) {
	key := h.key(r)
	if key == "" {
		writeAPIErr(w, http.StatusBadRequest, "no Suno account configured (add one in Providers)")
		return
	}
	taskID := strings.TrimSpace(r.URL.Query().Get("task_id"))
	if taskID == "" {
		writeAPIErr(w, http.StatusBadRequest, "task_id is required")
		return
	}
	res, err := h.client.Poll(key, taskID)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeData(w, res)
}
