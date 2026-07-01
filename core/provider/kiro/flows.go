package kiro

import (
	"bytes"
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
	awsClientName = "KiroIDE"
	awsClientType = "public"
	awsIssuerURL  = "https://auth.desktop.kiro.dev"
	awsDefaultURL = "https://view.awsapps.com/start"

	oauthAuthorizeURL = "https://prod.us-east-1.auth.desktop.kiro.dev/login"
	oauthTokenURL     = "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token"
	oauthRedirectURI  = "kiro://kiro.kiroAgent/authenticate-success"

	// kiroDesktopRefreshURL refreshes social (Kiro OAuth) tokens — a different
	// endpoint from the AWS SSO OIDC one used for builder-id / idc accounts.
	kiroDesktopRefreshURL = "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken"
)

var (
	awsScopes     = []string{"codewhisperer:completions", "codewhisperer:analysis"}
	awsGrantTypes = []string{"refresh_token", "urn:ietf:params:oauth:grant-type:device_code"}
)

func postJSON(doer transport.Doer, url string, payload, out any, headers map[string]string) (int, []byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := doer.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if out != nil && resp.StatusCode == http.StatusOK {
		_ = json.Unmarshal(raw, out)
	}
	return resp.StatusCode, raw, nil
}

// --- AWS device-code (builder-id / idc) ---

type AWSClient struct {
	ClientID     string
	ClientSecret string
}

type AWSDeviceAuth struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

func registerAWSClient(doer transport.Doer, region string) (*AWSClient, error) {
	region = orDefault(region, "us-east-1")
	var out struct {
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	}
	code, raw, err := postJSON(doer, fmt.Sprintf("https://oidc.%s.amazonaws.com/client/register", region), map[string]any{
		"clientName": awsClientName,
		"clientType": awsClientType,
		"scopes":     awsScopes,
		"grantTypes": awsGrantTypes,
		"issuerUrl":  awsIssuerURL,
	}, &out, nil)
	if err != nil {
		return nil, err
	}
	if code != http.StatusOK || out.ClientID == "" {
		return nil, fmt.Errorf("kiro aws register %d: %s", code, trunc(raw))
	}
	return &AWSClient{ClientID: out.ClientID, ClientSecret: out.ClientSecret}, nil
}

// StartAWSDevice registers a client and begins device authorization.
// StartAWSDevice begins the AWS device-code flow. startURL is the SSO start URL:
// empty uses the default Builder ID portal; an IAM Identity Center URL enables
// enterprise SSO (IdC).
func StartAWSDevice(doer transport.Doer, region, startURL string) (*AWSClient, *AWSDeviceAuth, error) {
	region = orDefault(region, "us-east-1")
	startURL = orDefault(startURL, awsDefaultURL)
	client, err := registerAWSClient(doer, region)
	if err != nil {
		return nil, nil, err
	}
	var out struct {
		DeviceCode              string `json:"deviceCode"`
		UserCode                string `json:"userCode"`
		VerificationURI         string `json:"verificationUri"`
		VerificationURIComplete string `json:"verificationUriComplete"`
		ExpiresIn               int    `json:"expiresIn"`
		Interval                int    `json:"interval"`
	}
	code, raw, err := postJSON(doer, fmt.Sprintf("https://oidc.%s.amazonaws.com/device_authorization", region), map[string]string{
		"clientId":     client.ClientID,
		"clientSecret": client.ClientSecret,
		"startUrl":     startURL,
	}, &out, nil)
	if err != nil {
		return nil, nil, err
	}
	if code != http.StatusOK || out.DeviceCode == "" {
		return nil, nil, fmt.Errorf("kiro aws device auth %d: %s", code, trunc(raw))
	}
	return client, &AWSDeviceAuth{
		DeviceCode:              out.DeviceCode,
		UserCode:                out.UserCode,
		VerificationURI:         out.VerificationURI,
		VerificationURIComplete: out.VerificationURIComplete,
		ExpiresIn:               out.ExpiresIn,
		Interval:                out.Interval,
	}, nil
}

// PollAWSDevice polls once. pending=true means keep polling; creds!=nil means
// done. authMethod ("builder-id" or "idc") is stored on the resulting creds.
func PollAWSDevice(doer transport.Doer, client *AWSClient, deviceCode, region, authMethod string) (creds map[string]string, pending bool, err error) {
	region = orDefault(region, "us-east-1")
	authMethod = orDefault(authMethod, "builder-id")
	var out struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
		ExpiresIn    int    `json:"expiresIn"`
	}
	code, raw, e := postJSON(doer, fmt.Sprintf("https://oidc.%s.amazonaws.com/token", region), map[string]string{
		"clientId":     client.ClientID,
		"clientSecret": client.ClientSecret,
		"deviceCode":   deviceCode,
		"grantType":    "urn:ietf:params:oauth:grant-type:device_code",
	}, &out, nil)
	if e != nil {
		return nil, false, e
	}
	if code != http.StatusOK {
		var ep struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &ep)
		if ep.Error == "authorization_pending" || ep.Error == "slow_down" {
			return nil, true, nil
		}
		return nil, false, fmt.Errorf("kiro aws poll: %s", orDefault(ep.Error, trunc(raw)))
	}
	c := map[string]string{
		"access_token":  out.AccessToken,
		"refresh_token": out.RefreshToken,
		"sso_region":    region,
		"auth_method":   authMethod,
		"client_id":     client.ClientID,
		"client_secret": client.ClientSecret,
		"expires_at":    time.Now().Add(time.Duration(maxInt(out.ExpiresIn, 3600)) * time.Second).Format(time.RFC3339),
	}
	if arn := fetchProfileARN(doer, out.AccessToken); arn != "" {
		c["profile_arn"] = arn
	}
	return c, false, nil
}

// --- OAuth (social / Google) PKCE ---

type OAuthFlow struct {
	CodeVerifier string `json:"code_verifier"`
	State        string `json:"state"`
	AuthorizeURL string `json:"authorize_url"`
}

func StartOAuth() (*OAuthFlow, error) {
	verifier, err := randString(64)
	if err != nil {
		return nil, err
	}
	state, err := randString(32)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	params := url.Values{
		"idp":                   {"Google"},
		"redirect_uri":          {oauthRedirectURI},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
		"state":                 {state},
	}
	return &OAuthFlow{
		CodeVerifier: verifier,
		State:        state,
		AuthorizeURL: oauthAuthorizeURL + "?" + params.Encode(),
	}, nil
}

// ExchangeOAuth swaps the redirect code for tokens (social login).
func ExchangeOAuth(doer transport.Doer, code, verifier string) (map[string]string, error) {
	var out struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
		ProfileARN   string `json:"profileArn"`
		ExpiresIn    int    `json:"expiresIn"`
	}
	status, raw, err := postJSON(doer, oauthTokenURL, map[string]string{
		"code":          strings.TrimSpace(code),
		"code_verifier": strings.TrimSpace(verifier),
		"redirect_uri":  oauthRedirectURI,
	}, &out, nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK || out.AccessToken == "" {
		return nil, fmt.Errorf("kiro oauth exchange %d: %s", status, trunc(raw))
	}
	c := map[string]string{
		"access_token":  out.AccessToken,
		"refresh_token": out.RefreshToken,
		"auth_method":   "social",
		"sso_region":    "us-east-1",
		"expires_at":    time.Now().Add(time.Duration(maxInt(out.ExpiresIn, 3600)) * time.Second).Format(time.RFC3339),
	}
	if out.ProfileARN != "" {
		c["profile_arn"] = out.ProfileARN
	} else if arn := fetchProfileARN(doer, out.AccessToken); arn != "" {
		c["profile_arn"] = arn
	}
	return c, nil
}

// --- shared ---

func fetchProfileARN(doer transport.Doer, accessToken string) string {
	if strings.TrimSpace(accessToken) == "" {
		return ""
	}
	var out struct {
		Profiles []struct {
			Arn string `json:"arn"`
		} `json:"profiles"`
	}
	code, _, err := postJSON(doer, "https://q.us-east-1.amazonaws.com/ListAvailableProfiles", map[string]any{}, &out,
		map[string]string{"Authorization": "Bearer " + accessToken, "Content-Type": "application/x-amz-json-1.1"})
	if err != nil || code != http.StatusOK || len(out.Profiles) == 0 {
		return ""
	}
	return strings.TrimSpace(out.Profiles[0].Arn)
}

func randString(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b)[:n], nil
}

func orDefault(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func trunc(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 200 {
		return s[:200]
	}
	return s
}
