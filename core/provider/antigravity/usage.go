package antigravity

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/enowdev/enowx/core/provider"
)

// Usage reports the account's CloudCode quota: each model group (Gemini,
// Claude/GPT) has a weekly + 5h window with a remaining fraction. Surfaced as
// Usage.Windows (used% = 100*(1-remainingFraction)).
func (p *Provider) Usage(acc provider.Account) (*provider.Usage, error) {
	am := p.manager(acc)
	token, err := am.token()
	if err != nil {
		return nil, err
	}
	body, _ := json.Marshal(map[string]any{"project": am.projectID()})
	req, err := http.NewRequest(http.MethodPost, inferenceHost+":retrieveUserQuotaSummary", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", userAgentBase+" "+goPlatform())
	resp, err := p.doer.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return &provider.Usage{Message: "quota unavailable"}, nil
	}

	var out struct {
		Groups []struct {
			DisplayName string `json:"displayName"`
			Buckets     []struct {
				DisplayName        string  `json:"displayName"`
				Window             string  `json:"window"`
				ResetTime          string  `json:"resetTime"`
				RemainingFraction  float64 `json:"remainingFraction"`
			} `json:"buckets"`
		} `json:"groups"`
	}
	if json.Unmarshal(raw, &out) != nil {
		return &provider.Usage{Message: "quota parse failed"}, nil
	}

	windows := []provider.UsageWindow{}
	for _, g := range out.Groups {
		short := groupShort(g.DisplayName)
		for _, b := range g.Buckets {
			used := (1 - b.RemainingFraction) * 100
			if used < 0 {
				used = 0
			}
			label := short + " " + windowShort(b.Window)
			windows = append(windows, provider.UsageWindow{
				Label:       label,
				UsedPercent: used,
				ResetInSecs: resetIn(b.ResetTime),
			})
		}
	}
	u := &provider.Usage{Windows: windows}
	if len(windows) == 0 {
		u.Message = "no quota data"
	}
	return u, nil
}

// groupShort turns a group display name into a short tag.
func groupShort(name string) string {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "gemini"):
		return "Gemini"
	case strings.Contains(n, "claude"), strings.Contains(n, "gpt"):
		return "Claude/GPT"
	}
	return name
}

func windowShort(w string) string {
	switch w {
	case "weekly":
		return "wk"
	case "5h":
		return "5h"
	}
	return w
}

func resetIn(t string) int64 {
	if t == "" {
		return 0
	}
	parsed, err := time.Parse(time.RFC3339, t)
	if err != nil {
		return 0
	}
	d := time.Until(parsed)
	if d < 0 {
		return 0
	}
	return int64(d.Seconds())
}
