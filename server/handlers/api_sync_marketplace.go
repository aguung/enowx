package handlers

import (
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// MarketplaceList proxies browsing listings (forwards the query string).
func (h *Sync) MarketplaceList(w http.ResponseWriter, r *http.Request) {
	q := ""
	if raw := r.URL.RawQuery; raw != "" {
		q = "?" + raw
	}
	out, err := h.mgr.MarketplaceList(r.Context(), q)
	proxyJSON(w, out, err)
}

// MarketplaceGet proxies fetching one listing.
func (h *Sync) MarketplaceGet(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.MarketplaceGet(r.Context(), chi.URLParam(r, "id"))
	proxyJSON(w, out, err)
}

// MarketplaceCreate proxies creating a listing.
func (h *Sync) MarketplaceCreate(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	out, err := h.mgr.MarketplaceCreate(r.Context(), body)
	proxyJSON(w, out, err)
}

// MarketplaceUpdate proxies editing a listing.
func (h *Sync) MarketplaceUpdate(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	out, err := h.mgr.MarketplaceAction(r.Context(), http.MethodPatch, chi.URLParam(r, "id"), body)
	proxyJSON(w, out, err)
}

// MarketplaceDelete proxies deleting a listing.
func (h *Sync) MarketplaceDelete(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.MarketplaceAction(r.Context(), http.MethodDelete, chi.URLParam(r, "id"), nil)
	proxyJSON(w, out, err)
}

// --- rekber ---

func (h *Sync) RekberFee(w http.ResponseWriter, r *http.Request) {
	q := ""
	if raw := r.URL.RawQuery; raw != "" {
		q = "?" + raw
	}
	out, err := h.mgr.RekberGet(r.Context(), "/fee"+q)
	proxyJSON(w, out, err)
}

func (h *Sync) RekberThreads(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.RekberGet(r.Context(), "/threads")
	proxyJSON(w, out, err)
}

func (h *Sync) RekberCreate(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
	out, err := h.mgr.RekberPost(r.Context(), "/threads", body)
	proxyJSON(w, out, err)
}

func (h *Sync) RekberGetThread(w http.ResponseWriter, r *http.Request) {
	q := ""
	if raw := r.URL.RawQuery; raw != "" {
		q = "?" + raw
	}
	out, err := h.mgr.RekberGet(r.Context(), "/threads/"+chi.URLParam(r, "id")+q)
	proxyJSON(w, out, err)
}

func (h *Sync) RekberSend(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	out, err := h.mgr.RekberPost(r.Context(), "/threads/"+chi.URLParam(r, "id")+"/messages", body)
	proxyJSON(w, out, err)
}

func (h *Sync) RekberAction(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	out, err := h.mgr.RekberPost(r.Context(), "/threads/"+chi.URLParam(r, "id")+"/action/"+chi.URLParam(r, "action"), body)
	proxyJSON(w, out, err)
}

func (h *Sync) RekberDelivery(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.RekberDelivery(r.Context(), chi.URLParam(r, "id"))
	proxyJSON(w, out, err)
}

func (h *Sync) RekberOrders(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.RekberOrders(r.Context())
	proxyJSON(w, out, err)
}

// RekberAccount (admin) get/set the global rekber account.
func (h *Sync) RekberAccountGet(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.RekberAccountGet(r.Context())
	proxyJSON(w, out, err)
}

func (h *Sync) RekberAccountSet(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
	out, err := h.mgr.RekberAccountSet(r.Context(), body)
	proxyJSON(w, out, err)
}

// --- orders ---

func (h *Sync) OrderCreate(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
	out, err := h.mgr.OrderCreate(r.Context(), body)
	proxyJSON(w, out, err)
}

func (h *Sync) OrdersList(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.OrdersList(r.Context())
	proxyJSON(w, out, err)
}

func (h *Sync) OrderGet(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.OrderGet(r.Context(), chi.URLParam(r, "id"))
	proxyJSON(w, out, err)
}

// --- official store (VIP) + admin ---

func (h *Sync) OfficialList(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.OfficialList(r.Context())
	proxyJSON(w, out, err)
}

func (h *Sync) VIPBalance(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.VIPAdminGet(r.Context(), "/balance")
	proxyJSON(w, out, err)
}

func (h *Sync) VIPCatalog(w http.ResponseWriter, r *http.Request) {
	q := ""
	if raw := r.URL.RawQuery; raw != "" {
		q = "?" + raw
	}
	out, err := h.mgr.VIPAdminGet(r.Context(), "/catalog"+q)
	proxyJSON(w, out, err)
}

func (h *Sync) VIPProducts(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.VIPAdminGet(r.Context(), "/products")
	proxyJSON(w, out, err)
}

func (h *Sync) VIPProductUpsert(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
	out, err := h.mgr.VIPAdminSend(r.Context(), http.MethodPost, "/products", body)
	proxyJSON(w, out, err)
}

func (h *Sync) VIPProductToggle(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1024))
	out, err := h.mgr.VIPAdminSend(r.Context(), http.MethodPatch, "/products/"+chi.URLParam(r, "id"), body)
	proxyJSON(w, out, err)
}

func (h *Sync) VIPProductDelete(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.VIPAdminSend(r.Context(), http.MethodDelete, "/products/"+chi.URLParam(r, "id"), nil)
	proxyJSON(w, out, err)
}
