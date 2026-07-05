package handlers

import (
	"net/http"
	"strconv"

	"github.com/enowdev/enowx/store"
)

// Requests exposes the request log for the UI.
type Requests struct{ store store.LogStore }

func NewRequests(s store.LogStore) *Requests { return &Requests{store: s} }

type requestDTO struct {
	ID           int64  `json:"id"`
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	Status       string `json:"status"`
	Source       string `json:"source"`
	InTokens     int64  `json:"in_tokens"`
	OutTokens    int64  `json:"out_tokens"`
	LatencyMS    int64  `json:"latency_ms"`
	ProxyUsed    string `json:"proxy_used"`
	AccountLabel string `json:"account_label"`
	CreatedAt    string `json:"created_at"`
}

func (h *Requests) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, err := h.store.Recent(r.Context(), limit)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]requestDTO, 0, len(rows))
	for _, l := range rows {
		out = append(out, requestDTO{
			ID:           l.ID,
			Provider:     l.Provider,
			Model:        l.Model,
			Status:       l.Status,
			Source:       l.Source,
			InTokens:     l.InTokens,
			OutTokens:    l.OutTokens,
			LatencyMS:    l.LatencyMS,
			ProxyUsed:    l.ProxyUsed,
			AccountLabel: l.AccountLabel,
			CreatedAt:    l.CreatedAt.Format("2006-01-02 15:04:05"),
		})
	}
	writeData(w, out)
}

func (h *Requests) Clear(w http.ResponseWriter, r *http.Request) {
	if err := h.store.Clear(r.Context()); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

func (h *Requests) Summary(w http.ResponseWriter, r *http.Request) {
	// All-time by default (from the persistent rollup, so totals don't reset when
	// request logs are purged). ?range=today narrows to the current day.
	summary := h.store.SummaryAll
	if r.URL.Query().Get("range") == "today" {
		summary = h.store.SummaryToday
	}
	sum, err := summary(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, sum)
}

func (h *Requests) Series(w http.ResponseWriter, r *http.Request) {
	rng := store.SeriesRange(r.URL.Query().Get("range"))
	switch rng {
	case store.RangeDaily, store.Range7d, store.Range30d, store.RangeAll:
	default:
		rng = store.RangeDaily
	}
	pts, err := h.store.Series(r.Context(), rng)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, pts)
}

func (h *Requests) TopModels(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, err := h.store.TopModels(r.Context(), limit)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, rows)
}
