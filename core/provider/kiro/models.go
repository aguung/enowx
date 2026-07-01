package kiro

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/enowdev/enowx/core/provider"
)

// Models fetches the account's available models from CodeWhisperer's
// ListAvailableModels endpoint (kiro exposes a live model list), so the UI shows
// exactly what this account can access.
func (p *Provider) Models(acc provider.Account) ([]provider.Model, error) {
	am := p.manager(acc)
	token, err := am.token()
	if err != nil {
		return nil, err
	}
	region := am.creds["sso_region"]
	if region == "" {
		region = "us-east-1"
	}
	params := url.Values{"origin": {"AI_EDITOR"}}
	if arn := am.profileARN(); arn != "" {
		params.Set("profileArn", arn)
	}
	u := fmt.Sprintf("https://q.%s.amazonaws.com/ListAvailableModels?%s", region, params.Encode())
	r, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("Accept", "application/json")

	resp, err := p.doer.Do(r)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("kiro models: upstream %d", resp.StatusCode)
	}

	var out struct {
		Models []struct {
			ModelID   string `json:"modelId"`
			ModelName string `json:"modelName"`
		} `json:"models"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	models := make([]provider.Model, 0, len(out.Models))
	for _, m := range out.Models {
		name := m.ModelName
		if name == "" {
			name = m.ModelID
		}
		models = append(models, provider.Model{ID: m.ModelID, Name: name, Type: "chat", OwnedBy: ownerFromModelID(m.ModelID)})
	}
	return models, nil
}

// ownerFromModelID guesses a friendly owner label from the model id prefix.
func ownerFromModelID(id string) string {
	switch {
	case strings.HasPrefix(id, "claude"):
		return "anthropic"
	case strings.HasPrefix(id, "deepseek"):
		return "deepseek"
	case strings.HasPrefix(id, "qwen"):
		return "alibaba"
	case strings.HasPrefix(id, "glm"):
		return "zhipu"
	case strings.Contains(id, "minimax") || strings.Contains(id, "MiniMax"):
		return "minimax"
	default:
		return ""
	}
}
