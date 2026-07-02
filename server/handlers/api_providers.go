package handlers

import (
	"net/http"

	"github.com/enowdev/enowx/core/provider"
)

// providerMeta is the display catalog for known providers. The registry decides
// what is actually available; this only adds label/icon for the UI.
type providerMeta struct {
	Label string
	Icon  string
}

var providerCatalog = map[string]providerMeta{
	"codebuddy": {Label: "CodeBuddy", Icon: "codebuddy"},
	"kiro":      {Label: "Kiro", Icon: "kiro"},
	"codex":       {Label: "Codex", Icon: "codex"},
	"antigravity": {Label: "Antigravity", Icon: "antigravity"},
	"suno":        {Label: "Suno", Icon: "suno"},
}

type providerDTO struct {
	Name   string `json:"name"`
	Label  string `json:"label"`
	Icon   string `json:"icon"`
	Chat   bool   `json:"chat"`
	Images bool   `json:"images"`
	Music  bool   `json:"music"`
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
		meta := providerCatalog[name]
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
		})
	}
	writeData(w, out)
}
