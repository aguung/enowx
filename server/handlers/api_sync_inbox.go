package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Inbox proxies the caller's inbox messages.
func (h *Sync) Inbox(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.Inbox(r.Context())
	proxyJSON(w, out, err)
}

// InboxRead proxies marking one/all inbox messages read.
func (h *Sync) InboxRead(w http.ResponseWriter, r *http.Request) {
	err := h.mgr.InboxRead(r.Context(), readBody(r))
	proxyJSON(w, "{\"ok\":true}", err)
}

// --- admin inbox ---

func (h *Sync) SendInbox(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.SendInbox(r.Context(), readBody(r))
	proxyJSON(w, out, err)
}

func (h *Sync) AdminInboxList(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.AdminInboxList(r.Context())
	proxyJSON(w, out, err)
}

func (h *Sync) DeleteInbox(w http.ResponseWriter, r *http.Request) {
	err := h.mgr.DeleteInbox(r.Context(), chi.URLParam(r, "id"))
	proxyJSON(w, "{\"ok\":true}", err)
}

func (h *Sync) InboxRoles(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.InboxRoles(r.Context())
	proxyJSON(w, out, err)
}
