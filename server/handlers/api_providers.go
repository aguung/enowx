package handlers

import (
	"net/http"
	"sync"

	"github.com/enowdev/enowx/core/provider"
)

// providerMeta is the display catalog for known providers. The registry decides
// what is actually available; this only adds label/icon for the UI.
type providerMeta struct {
	Label  string
	Icon   string
	Custom bool
}

var providerCatalog = map[string]providerMeta{
	"codebuddy":    {Label: "CodeBuddy", Icon: "codebuddy"},
	"codebuddy-cn": {Label: "CodeBuddy CN", Icon: "codebuddy"},
	"commandcode":  {Label: "Command Code", Icon: "commandcode"},
	"kiro":         {Label: "Kiro", Icon: "kiro"},
	"codex":        {Label: "Codex", Icon: "codex"},
	"antigravity":  {Label: "Antigravity", Icon: "antigravity"},
	"suno":         {Label: "Suno", Icon: "suno"},
	"leonardo":     {Label: "Leonardo", Icon: "leonardo"},
}

// catalogMu guards runtime additions (custom providers).
var catalogMu sync.RWMutex

// AddCatalogEntry registers display metadata for a custom provider at runtime.
func AddCatalogEntry(name, label, icon string) {
	catalogMu.Lock()
	providerCatalog[name] = providerMeta{Label: label, Icon: icon, Custom: true}
	catalogMu.Unlock()
}

// RemoveCatalogEntry removes a custom provider's display metadata.
func RemoveCatalogEntry(name string) {
	catalogMu.Lock()
	delete(providerCatalog, name)
	catalogMu.Unlock()
}

type providerDTO struct {
	Name   string `json:"name"`
	Label  string `json:"label"`
	Icon   string `json:"icon"`
	Chat   bool   `json:"chat"`
	Images bool   `json:"images"`
	Music  bool   `json:"music"`
	Custom bool   `json:"custom"`
}

// Providers lists the registered upstream providers with display metadata.
type Providers struct{ reg *provider.Registry }

func NewProviders(reg *provider.Registry) *Providers { return &Providers{reg: reg} }

func (h *Providers) List(w http.ResponseWriter, _ *http.Request) {
	out := make([]providerDTO, 0)
	for _, name := range h.reg.Names() {
		p, err := h.reg.Get(name)
		if err != nil {
			continue
		}
		catalogMu.RLock()
		meta := providerCatalog[name]
		catalogMu.RUnlock()
		if meta.Label == "" {
			meta.Label = name
		}
		if meta.Icon == "" {
			meta.Icon = name
		}
		caps := p.Caps()
		out = append(out, providerDTO{
			Name:   name,
			Label:  meta.Label,
			Icon:   meta.Icon,
			Chat:   caps.Chat,
			Images: caps.Images,
			Music:  caps.Music,
			Custom: meta.Custom,
		})
	}
	writeData(w, out)
}
