// Restore Old Account — an official enowx plugin.
//
// It brings a user's provider accounts over from the previous enowx into this
// app. The heavy lifting is server-side: the gateway proxies to the cloud, which
// looks the user up by their signed-in Discord id, decrypts their old provider
// credentials, and returns them. This plugin just maps the old provider names to
// this app's ids and re-adds each account locally (de-duplicating against what's
// already there). Credentials only ever travel over the local loopback API.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var enowxAPI = strings.TrimRight(os.Getenv("ENOWX_API"), "/")

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/restore", handleRestore)
	mux.HandleFunc("/", serveStatic)
	fmt.Println("restore-legacy plugin on :" + port)
	_ = http.ListenAndServe("127.0.0.1:"+port, mux)
}

// serveStatic serves the plugin UI from public/.
func serveStatic(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, "/")
	if rel == "" {
		rel = "public/index.html"
	}
	exe, _ := os.Executable()
	base := filepath.Dir(exe)
	// `go run` builds to a temp dir, so also try the source dir.
	for _, dir := range []string{".", base} {
		full := filepath.Join(dir, rel)
		if b, err := os.ReadFile(full); err == nil {
			if strings.HasSuffix(full, ".html") {
				w.Header().Set("Content-Type", "text/html")
			}
			w.Write(b)
			return
		}
	}
	http.NotFound(w, r)
}

// --- restore flow ---------------------------------------------------------

type legacyAccount struct {
	Provider string `json:"provider"`
	Email    string `json:"email"`
	Creds    string `json:"creds"`
	Status   string `json:"status"`
}

type legacyResp struct {
	Found         bool            `json:"found"`
	Accounts      []legacyAccount `json:"accounts"`
	DonationTotal int64           `json:"donation_total_idr"`
}

// providerMap maps old provider ids to this app's ids. Only mapped providers are
// imported; anything else is reported as skipped (never silently dropped).
var providerMap = map[string]string{
	"kiro":         "kiro",
	"codebuddy":    "codebuddy",
	"codebuddy-cn": "codebuddy-cn",
	"codex":        "codex",
	"antigravity":  "antigravity",
	"leonardo":     "leonardo",
	"suno":         "suno",
}

type existingAccount struct {
	Provider string `json:"provider"`
	Label    string `json:"label"`
}

type summary struct {
	Imported      int            `json:"imported"`
	Skipped       int            `json:"skipped"`
	Failed        int            `json:"failed"`
	Unsupported   map[string]int `json:"unsupported"`
	DonationTotal int64          `json:"donation_total_idr"`
	Found         bool           `json:"found"`
	Message       string         `json:"message,omitempty"`
}

func handleRestore(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	out := summary{Unsupported: map[string]int{}}

	// 1) Pull the decrypted legacy accounts from the cloud (via the gateway).
	leg, err := fetchLegacy()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	out.Found = leg.Found
	out.DonationTotal = leg.DonationTotal
	if !leg.Found {
		out.Message = "No legacy account was found for your Discord login."
		writeJSON(w, http.StatusOK, out)
		return
	}

	// 2) De-dupe against what's already added.
	have := existingSet()

	// 3) Re-add each mapped account locally.
	for _, a := range leg.Accounts {
		v2, ok := providerMap[a.Provider]
		if !ok {
			out.Unsupported[a.Provider]++
			continue
		}
		if have[v2+"\x00"+a.Email] {
			out.Skipped++
			continue
		}
		if addAccount(v2, a.Email, a.Creds) {
			out.Imported++
			have[v2+"\x00"+a.Email] = true
		} else {
			out.Failed++
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func fetchLegacy() (*legacyResp, error) {
	resp, err := http.Get(enowxAPI + "/api/legacy/accounts")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("restore unavailable (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	// The gateway wraps responses in { data, error }.
	var env struct {
		Data  legacyResp `json:"data"`
		Error string     `json:"error"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, err
	}
	if env.Error != "" {
		return nil, fmt.Errorf("%s", env.Error)
	}
	return &env.Data, nil
}

func existingSet() map[string]bool {
	set := map[string]bool{}
	resp, err := http.Get(enowxAPI + "/api/accounts")
	if err != nil {
		return set
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var env struct {
		Data []existingAccount `json:"data"`
	}
	if json.Unmarshal(body, &env) == nil {
		for _, a := range env.Data {
			set[a.Provider+"\x00"+a.Label] = true
		}
	}
	return set
}

func addAccount(provider, label, creds string) bool {
	// Old credentials are a JSON object string. The add API wants creds as a
	// map[string]string (multi-field) or a plain secret (single token). Coerce
	// every value to a string so numeric/bool fields don't break the decode.
	body := map[string]any{"provider": provider, "label": label}
	var raw map[string]any
	if json.Unmarshal([]byte(creds), &raw) == nil && len(raw) > 0 {
		m := make(map[string]string, len(raw))
		for k, v := range raw {
			switch t := v.(type) {
			case string:
				m[k] = t
			case nil:
				m[k] = ""
			default:
				b, _ := json.Marshal(t)
				m[k] = string(b)
			}
		}
		body["creds"] = m
	} else {
		body["secret"] = creds
	}
	payload, _ := json.Marshal(body)
	resp, err := http.Post(enowxAPI+"/api/accounts", "application/json", bytes.NewReader(payload))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
