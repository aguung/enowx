package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/core/sanitize"
	"github.com/enowdev/enowx/server/middleware"
	"github.com/enowdev/enowx/store"
)

// Filters manages content-filter rules (pattern→replacement) that obfuscate
// request text upstream and restore it downstream.
type Filters struct {
	dash  *middleware.Dashboard
	store store.FilterStore
}

func NewFilters(dash *middleware.Dashboard, s store.FilterStore) *Filters {
	f := &Filters{dash: dash, store: s}
	f.reload() // load rules into the engine on startup
	return f
}

// reload pushes the active DB rules into the sanitize engine.
func (h *Filters) reload() {
	list, err := h.store.List(context.Background())
	if err != nil {
		return
	}
	rules := make([]sanitize.Rule, 0, len(list))
	for _, f := range list {
		if f.IsActive {
			rules = append(rules, sanitize.Rule{Pattern: f.Pattern, Replacement: f.Replacement, Regex: f.IsRegex})
		}
	}
	sanitize.SetRules(rules)
}

func (h *Filters) guard(w http.ResponseWriter, r *http.Request) bool {
	if !h.dash.Authorized(r) {
		writeAPIErr(w, http.StatusForbidden, "requires the dashboard login when accessed remotely")
		return false
	}
	return true
}

func (h *Filters) List(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w, r) {
		return
	}
	list, err := h.store.List(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"filters": list})
}

type filterBody struct {
	Pattern     string `json:"pattern"`
	Replacement string `json:"replacement"`
	IsRegex     bool   `json:"is_regex"`
	IsActive    bool   `json:"is_active"`
}

func (h *Filters) Add(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w, r) {
		return
	}
	var b filterBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || strings.TrimSpace(b.Pattern) == "" {
		writeAPIErr(w, http.StatusBadRequest, "pattern is required")
		return
	}
	id, err := h.store.Add(r.Context(), store.ContentFilter{
		Pattern: strings.TrimSpace(b.Pattern), Replacement: b.Replacement, IsRegex: b.IsRegex, IsActive: b.IsActive,
	})
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.reload()
	writeData(w, map[string]any{"id": id})
}

func (h *Filters) Update(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w, r) {
		return
	}
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var b filterBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeAPIErr(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.store.Update(r.Context(), store.ContentFilter{
		ID: id, Pattern: strings.TrimSpace(b.Pattern), Replacement: b.Replacement, IsRegex: b.IsRegex, IsActive: b.IsActive,
	}); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.reload()
	writeData(w, map[string]any{"ok": true})
}

func (h *Filters) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w, r) {
		return
	}
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err := h.store.Delete(r.Context(), id); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.reload()
	writeData(w, map[string]any{"ok": true})
}

// ListTemplates returns the saved named filter sets.
func (h *Filters) ListTemplates(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w, r) {
		return
	}
	list, err := h.store.ListTemplates(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"templates": list})
}

// SaveTemplate snapshots the current active filters under a name.
func (h *Filters) SaveTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w, r) {
		return
	}
	var b struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || strings.TrimSpace(b.Name) == "" {
		writeAPIErr(w, http.StatusBadRequest, "name is required")
		return
	}
	cur, err := h.store.List(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := h.store.SaveTemplate(r.Context(), strings.TrimSpace(b.Name), cur); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

// LoadTemplate replaces the active filters with a template's set.
func (h *Filters) LoadTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w, r) {
		return
	}
	name := chi.URLParam(r, "name")
	rules, err := h.store.LoadTemplate(r.Context(), name)
	if err != nil {
		writeAPIErr(w, http.StatusNotFound, "template not found")
		return
	}
	if err := h.store.ReplaceAll(r.Context(), rules); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.reload()
	writeData(w, map[string]any{"ok": true})
}

// DeleteTemplate removes a saved template.
func (h *Filters) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w, r) {
		return
	}
	if err := h.store.DeleteTemplate(r.Context(), chi.URLParam(r, "name")); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}
