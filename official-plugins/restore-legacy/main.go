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
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var enowxAPI = strings.TrimRight(os.Getenv("ENOWX_API"), "/")

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}
	// Restore any persisted progress so a run survives an app restart. If the
	// last run was interrupted mid-way (still "running"), resume it automatically
	// — the import is idempotent (already-added accounts are skipped), so it
	// continues from where it stopped and the UI shows the bar again.
	if loadProgress() && job.d.Running {
		go runRestore()
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/restore", handleRestore)
	mux.HandleFunc("/api/progress", handleProgress)
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

// progressData is the live state of a restore run (JSON-serialisable, no lock).
type progressData struct {
	Running     bool           `json:"running"`
	Finished    bool           `json:"finished"`
	Total       int            `json:"total"`
	Done        int            `json:"done"`
	Imported    int            `json:"imported"`
	Skipped     int            `json:"skipped"`
	Failed      int            `json:"failed"`
	Unsupported map[string]int `json:"unsupported"`
	Donation    int64          `json:"donation_total_idr"`
	Found       bool           `json:"found"`
	Error       string         `json:"error,omitempty"`
	Message     string         `json:"message,omitempty"`
}

// progress guards progressData. It lives in the sidecar process, which outlives
// the plugin's iframe, so the UI can reconnect (poll /api/progress) after
// switching tabs and keep showing the same run.
type progress struct {
	mu sync.Mutex
	d  progressData
}

var job = &progress{d: progressData{Unsupported: map[string]int{}}}

func (p *progress) snapshot() progressData {
	p.mu.Lock()
	defer p.mu.Unlock()
	cp := p.d
	cp.Unsupported = make(map[string]int, len(p.d.Unsupported))
	for k, v := range p.d.Unsupported {
		cp.Unsupported[k] = v
	}
	return cp
}

// progressFile is where the run state is persisted so it survives an app restart.
// The plugin's working dir is its install folder, which persists across restarts.
const progressFile = "progress.json"

// save writes the current state to disk. Call with the lock NOT held.
func (p *progress) save() {
	snap := p.snapshot()
	b, err := json.Marshal(snap)
	if err != nil {
		return
	}
	_ = os.WriteFile(progressFile, b, 0o644)
}

// loadProgress reads a persisted run into `job`, returning true if one existed.
func loadProgress() bool {
	b, err := os.ReadFile(progressFile)
	if err != nil {
		return false
	}
	var d progressData
	if json.Unmarshal(b, &d) != nil {
		return false
	}
	if d.Unsupported == nil {
		d.Unsupported = map[string]int{}
	}
	job.mu.Lock()
	job.d = d
	job.mu.Unlock()
	return true
}

// handleRestore starts a restore run in the background (idempotent: if one is
// already running it just returns the current progress). Returns immediately.
func handleRestore(w http.ResponseWriter, r *http.Request) {
	job.mu.Lock()
	if job.d.Running {
		job.mu.Unlock()
		writeJSON(w, http.StatusOK, job.snapshot())
		return
	}
	// reset for a fresh run
	job.d = progressData{Running: true, Unsupported: map[string]int{}}
	job.mu.Unlock()
	job.save()

	go runRestore()
	writeJSON(w, http.StatusOK, job.snapshot())
}

func handleProgress(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, job.snapshot())
}

// runRestore does the actual work, updating `job` as it goes.
func runRestore() {
	finish := func(msg, errMsg string) {
		job.mu.Lock()
		job.d.Running, job.d.Finished = false, true
		if msg != "" {
			job.d.Message = msg
		}
		if errMsg != "" {
			job.d.Error = errMsg
		}
		job.mu.Unlock()
		job.save()
	}

	leg, err := fetchLegacy()
	if err != nil {
		finish("", err.Error())
		return
	}
	job.mu.Lock()
	job.d.Found = leg.Found
	job.d.Donation = leg.DonationTotal
	job.mu.Unlock()
	if !leg.Found {
		finish("No legacy account was found for your Discord login.", "")
		return
	}

	// De-dupe against what's already added; total = mapped accounts to attempt.
	have := existingSet()
	total := 0
	for _, a := range leg.Accounts {
		if _, ok := providerMap[a.Provider]; ok {
			total++
		}
	}
	// Reset the per-run counters here: a resumed run re-processes every account
	// (idempotent via the dedupe above), so we must NOT keep the counts from the
	// interrupted run — otherwise done can exceed total (e.g. 914 of 744).
	job.mu.Lock()
	job.d.Total = total
	job.d.Done, job.d.Imported, job.d.Skipped, job.d.Failed = 0, 0, 0, 0
	job.d.Unsupported = map[string]int{}
	job.mu.Unlock()
	job.save()

	for _, a := range leg.Accounts {
		v2, ok := providerMap[a.Provider]
		if !ok {
			job.mu.Lock()
			job.d.Unsupported[a.Provider]++
			job.mu.Unlock()
			continue
		}
		// De-dupe on the credentials, not the email: token-based providers (kiro,
		// codebuddy) can have an empty or shared email across many distinct
		// accounts, so keying on email collapsed them into one. The label stays
		// human-friendly (email when present, else a short creds fingerprint) and
		// is made unique so re-runs match the pool account exactly.
		fp := credsFingerprint(a.Creds)
		label := a.Email
		if label == "" {
			label = v2 + "-" + fp
		}
		key := v2 + "\x00" + fp
		if have[key] || have[v2+"\x00"+label] {
			job.mu.Lock()
			job.d.Skipped++
			job.d.Done++
			done := job.d.Done
			job.mu.Unlock()
			if done%10 == 0 {
				job.save() // checkpoint periodically so a restart resumes near here
			}
			continue
		}
		ok = addAccount(v2, label, a.Creds)
		job.mu.Lock()
		if ok {
			job.d.Imported++
			have[key] = true
			have[v2+"\x00"+label] = true
		} else {
			job.d.Failed++
		}
		job.d.Done++
		done := job.d.Done
		job.mu.Unlock()
		if done%10 == 0 {
			job.save()
		}
	}
	finish("Done! Enable cloud sync to back your accounts up.", "")
}

// credsFingerprint returns a short stable hash of a credential blob, used to
// identify an account independent of its (possibly empty/shared) email.
func credsFingerprint(creds string) string {
	sum := sha256.Sum256([]byte(creds))
	return hex.EncodeToString(sum[:])[:12]
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
	// warmup=0: bulk import shouldn't warm each account inline (slow + rate-limited);
	// the user runs "Warm all" afterwards.
	resp, err := http.Post(enowxAPI+"/api/accounts?warmup=0", "application/json", bytes.NewReader(payload))
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
