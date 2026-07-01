package antigravity

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"time"

	"github.com/enowdev/enowx/core/transport"
)

// AuthorizeURL builds the Google OAuth authorize URL for an Antigravity login.
func AuthorizeURL() (state, authURL string, err error) {
	state, err = randB64URL(32)
	if err != nil {
		return "", "", err
	}
	q := url.Values{
		"client_id":     {clientID},
		"response_type": {"code"},
		"redirect_uri":  {redirectURI},
		"scope":         {strings.Join(oauthScopes, " ")},
		"state":         {state},
		"access_type":   {"offline"},
		"prompt":        {"consent"},
	}
	return state, authorizeURL + "?" + q.Encode(), nil
}

// ExchangeAndOnboard swaps the auth code for tokens, resolves the account email,
// and discovers the CloudCode project id. Returns canonical creds.
func ExchangeAndOnboard(doer transport.Doer, code string) (map[string]string, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"redirect_uri":  {redirectURI},
	}
	req, _ := http.NewRequest(http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := doer.Do(req)
	if err != nil {
		return nil, fmt.Errorf("antigravity token exchange: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("antigravity token exchange %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var tok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &tok); err != nil {
		return nil, fmt.Errorf("antigravity token decode: %w", err)
	}
	if tok.AccessToken == "" {
		return nil, fmt.Errorf("antigravity token exchange: empty access_token")
	}

	exp := time.Now().Add(time.Hour)
	if tok.ExpiresIn > 0 {
		exp = time.Now().Add(time.Duration(tok.ExpiresIn-60) * time.Second)
	}
	creds := map[string]string{
		"access_token":  tok.AccessToken,
		"refresh_token": tok.RefreshToken,
		"expires_at":    exp.Format(time.RFC3339),
	}
	if email := fetchEmail(doer, tok.AccessToken); email != "" {
		creds["email"] = email
	}
	// Project id + tier discovery (best-effort: generate a project id if it fails
	// so the account still saves).
	pid, tier := discoverProject(doer, tok.AccessToken)
	if pid == "" {
		pid = generateProjectID()
	}
	creds["project_id"] = pid
	if tier != "" {
		creds["plan"] = tier
	}
	return creds, nil
}

func fetchEmail(doer transport.Doer, token string) string {
	req, _ := http.NewRequest(http.MethodGet, userInfoURL, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := doer.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var out struct {
		Email string `json:"email"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out.Email
}

// discoverProject runs loadCodeAssist + onboardUser to obtain the CloudCode
// project id and the account tier. Returns ("", "") on failure.
func discoverProject(doer transport.Doer, token string) (projectID, tier string) {
	meta := map[string]any{"ideType": 9, "platform": platformEnum(), "pluginType": 2}

	// loadCodeAssist → project + currentTier + allowedTiers.
	var load struct {
		CloudaicompanionProject json.RawMessage `json:"cloudaicompanionProject"`
		CurrentTier             struct {
			ID string `json:"id"`
		} `json:"currentTier"`
		AllowedTiers []struct {
			ID        string `json:"id"`
			IsDefault bool   `json:"isDefault"`
		} `json:"allowedTiers"`
	}
	if !cloudCodePost(doer, token, "loadCodeAssist", map[string]any{"metadata": meta}, &load) {
		return "", ""
	}
	tier = load.CurrentTier.ID
	onboardTier := "legacy-tier"
	for _, t := range load.AllowedTiers {
		if t.IsDefault && t.ID != "" {
			onboardTier = t.ID
		}
	}
	if pid := projectFromRaw(load.CloudaicompanionProject); pid != "" {
		return pid, tier
	}

	// onboardUser → long-running op; poll until done.
	for i := 0; i < 10; i++ {
		var ob struct {
			Done     bool `json:"done"`
			Response struct {
				CloudaicompanionProject json.RawMessage `json:"cloudaicompanionProject"`
			} `json:"response"`
		}
		if !cloudCodePost(doer, token, "onboardUser", map[string]any{"tierId": onboardTier, "metadata": meta}, &ob) {
			return "", tier
		}
		if ob.Done {
			return projectFromRaw(ob.Response.CloudaicompanionProject), tier
		}
		time.Sleep(5 * time.Second)
	}
	return "", tier
}

func cloudCodePost(doer transport.Doer, token, method string, body any, out any) bool {
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, cloudCodeProd+":"+method, bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "google-api-nodejs-client/9.15.1")
	req.Header.Set("X-Goog-Api-Client", "google-cloud-sdk vscode_cloudshelleditor/0.1")
	meta, _ := json.Marshal(map[string]any{"ideType": 9, "platform": platformEnum(), "pluginType": 2})
	req.Header.Set("Client-Metadata", string(meta))
	resp, err := doer.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return false
	}
	raw, _ := io.ReadAll(resp.Body)
	return json.Unmarshal(raw, out) == nil
}

// projectFromRaw handles cloudaicompanionProject being a string or {id}.
func projectFromRaw(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil && s != "" {
		return s
	}
	var o struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(raw, &o) == nil {
		return o.ID
	}
	return ""
}

// platformEnum mirrors the Antigravity binary's platform enum.
func platformEnum() int {
	switch runtime.GOOS {
	case "darwin":
		if runtime.GOARCH == "arm64" {
			return 2
		}
		return 1
	case "linux":
		if runtime.GOARCH == "arm64" {
			return 4
		}
		return 3
	case "windows":
		return 5
	}
	return 0
}

var (
	projAdj  = []string{"useful", "bright", "swift", "calm", "bold"}
	projNoun = []string{"fuze", "wave", "spark", "flow", "core"}
)

func generateProjectID() string {
	u, _ := randB64URL(4)
	return fmt.Sprintf("%s-%s-%s", pick(projAdj), pick(projNoun), strings.ToLower(u)[:5])
}

func pick(s []string) string {
	b := make([]byte, 1)
	_, _ = rand.Read(b)
	return s[int(b[0])%len(s)]
}

func randB64URL(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
