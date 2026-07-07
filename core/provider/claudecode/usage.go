package claudecode

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/enowdev/enowx/core/provider"
)

const profileURL = "https://api.anthropic.com/api/oauth/profile"

// Usage reports Claude's subscription plan + rate-limit utilization. Claude
// exposes the limit windows (5h + 7d) as response headers on a normal request,
// so we send a tiny message and read the anthropic-ratelimit-unified-* headers.
func (p *Provider) Usage(acc provider.Account) (*provider.Usage, error) {
	am := p.manager(acc)
	token, err := am.token()
	if err != nil {
		return nil, err
	}

	plan := p.plan(token) // "Max" | "Pro" | ""

	body, _ := json.Marshal(map[string]any{
		"model":      "claude-haiku-4-5",
		"max_tokens": 1,
		"messages":   []map[string]any{{"role": "user", "content": "."}},
	})
	req, err := http.NewRequest(http.MethodPost, messagesEndpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("anthropic-beta", anthropicBeta)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.doer.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { io.Copy(io.Discard, resp.Body); resp.Body.Close() }()

	u := &provider.Usage{Plan: plan}
	for _, w := range []struct{ key, label string }{
		{"5h", "5h"}, {"7d", "Weekly"},
	} {
		util := resp.Header.Get("anthropic-ratelimit-unified-" + w.key + "-utilization")
		if util == "" {
			continue
		}
		pct, _ := strconv.ParseFloat(util, 64)
		win := provider.UsageWindow{Label: w.label, UsedPercent: pct * 100}
		if reset := resp.Header.Get("anthropic-ratelimit-unified-" + w.key + "-reset"); reset != "" {
			if ts, err := strconv.ParseInt(reset, 10, 64); err == nil {
				if secs := ts - time.Now().Unix(); secs > 0 {
					win.ResetInSecs = secs
				}
			}
		}
		u.Windows = append(u.Windows, win)
	}
	if len(u.Windows) == 0 && plan == "" {
		u.Message = "usage unavailable"
	}
	return u, nil
}

// plan fetches the subscription plan (Max/Pro) from the OAuth profile.
func (p *Provider) plan(token string) string {
	req, err := http.NewRequest(http.MethodGet, profileURL, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	resp, err := p.doer.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out struct {
		Account struct {
			HasClaudeMax bool `json:"has_claude_max"`
			HasClaudePro bool `json:"has_claude_pro"`
		} `json:"account"`
	}
	if json.Unmarshal(raw, &out) != nil {
		return ""
	}
	switch {
	case out.Account.HasClaudeMax:
		return "Max"
	case out.Account.HasClaudePro:
		return "Pro"
	}
	return ""
}
