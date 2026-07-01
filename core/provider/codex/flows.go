package codex

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/enowdev/enowx/core/transport"
)

const (
	oauthAuthorizeURL = "https://auth.openai.com/oauth/authorize"
	oauthRedirectURI  = "http://localhost:1455/auth/callback"
	oauthScope        = "openid profile email offline_access"
)

// OAuthFlow carries the state needed to complete a PKCE login.
type OAuthFlow struct {
	CodeVerifier string `json:"code_verifier"`
	State        string `json:"state"`
	AuthorizeURL string `json:"authorize_url"`
}

// StartOAuth builds a PKCE authorize URL for the ChatGPT/Codex login.
func StartOAuth() (*OAuthFlow, error) {
	verifier, err := randB64URL(64)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	state, err := randB64URL(24)
	if err != nil {
		return nil, err
	}
	q := url.Values{
		"client_id":                  {oauthClientID},
		"redirect_uri":               {oauthRedirectURI},
		"response_type":              {"code"},
		"scope":                      {oauthScope},
		"connection":                 {"email"},
		"prompt":                     {"login"},
		"screen_hint":                {"login"},
		"state":                      {state},
		"code_challenge":             {challenge},
		"code_challenge_method":      {"S256"},
		"id_token_add_organizations": {"true"},
		"codex_cli_simplified_flow":  {"true"},
		"originator":                 {"codex_cli_rs"},
	}
	return &OAuthFlow{
		CodeVerifier: verifier,
		State:        state,
		AuthorizeURL: oauthAuthorizeURL + "?" + q.Encode(),
	}, nil
}

// ExchangeOAuth swaps the auth code for tokens and returns canonical creds.
func ExchangeOAuth(doer transport.Doer, code, verifier string) (map[string]string, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {oauthRedirectURI},
		"client_id":     {oauthClientID},
		"code_verifier": {verifier},
	}
	req, err := http.NewRequest(http.MethodPost, oauthTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := doer.Do(req)
	if err != nil {
		return nil, fmt.Errorf("codex token exchange: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("codex token exchange status %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		IDToken      string `json:"id_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("codex token decode: %w", err)
	}
	if out.AccessToken == "" {
		return nil, fmt.Errorf("codex token exchange: empty access_token")
	}
	return credsFromTokens(out.AccessToken, out.RefreshToken, out.IDToken, out.ExpiresIn), nil
}

// credsFromTokens builds the canonical creds map, deriving account_id + email
// from the id/access token JWTs.
func credsFromTokens(access, refresh, id string, expiresIn int) map[string]string {
	c := map[string]string{
		"access_token":  access,
		"refresh_token": refresh,
	}
	if id != "" {
		c["id_token"] = id
	}
	exp := time.Now().Add(time.Hour)
	if expiresIn > 0 {
		exp = time.Now().Add(time.Duration(expiresIn-60) * time.Second)
	} else if t := jwtExpiry(access); !t.IsZero() {
		exp = t
	}
	c["expires_at"] = exp.Format(time.RFC3339)
	if acct := accountIDFromJWT(id); acct != "" {
		c["account_id"] = acct
	} else if acct := accountIDFromJWT(access); acct != "" {
		c["account_id"] = acct
	}
	if email := emailFromJWT(id); email != "" {
		c["email"] = email
	} else if email := emailFromJWT(access); email != "" {
		c["email"] = email
	}
	return c
}

func randB64URL(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
