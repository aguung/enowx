package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Gmail store proxies — forward to the cloud (auth flows through the sync token).

func (h *Sync) GmailStoreInfo(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.GmailStoreInfo(r.Context())
	proxyJSON(w, out, err)
}
func (h *Sync) GmailBuy(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.GmailBuy(r.Context(), readBody(r))
	proxyJSON(w, out, err)
}
func (h *Sync) GmailOrderStatus(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.GmailOrderStatus(r.Context(), chi.URLParam(r, "ref"))
	proxyJSON(w, out, err)
}
func (h *Sync) GmailOrderAccounts(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.GmailOrderAccounts(r.Context(), chi.URLParam(r, "ref"))
	proxyJSON(w, out, err)
}
func (h *Sync) AdminGmailStock(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.AdminGmailStock(r.Context())
	proxyJSON(w, out, err)
}
func (h *Sync) AdminGmailAddStock(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.AdminGmailAddStock(r.Context(), readBody(r))
	proxyJSON(w, out, err)
}
func (h *Sync) AdminGmailDeleteStock(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.AdminGmailDeleteStock(r.Context(), chi.URLParam(r, "id"))
	proxyJSON(w, out, err)
}
func (h *Sync) AdminGmailOrders(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.AdminGmailOrders(r.Context())
	proxyJSON(w, out, err)
}
func (h *Sync) AdminGmailSetPrice(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.AdminGmailSetPrice(r.Context(), readBody(r))
	proxyJSON(w, out, err)
}
