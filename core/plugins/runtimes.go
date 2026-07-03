package plugins

import (
	"context"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Runtime describes a plugin runtime and whether it's installed.
type Runtime struct {
	ID        string `json:"id"`      // go | python | node
	Available bool   `json:"available"`
	Version   string `json:"version,omitempty"`
	bin       string
}

// runtimeProbes maps a runtime id to candidate binaries + a version flag.
var runtimeProbes = []struct {
	id   string
	bins []string
	flag string
}{
	{"go", []string{"go"}, "version"},
	// Prefer a newer Python (3.10+); some plugins need it and the macOS
	// CommandLineTools python3 is often 3.9. Homebrew paths first.
	{"python", []string{
		"/opt/homebrew/bin/python3", "/usr/local/bin/python3",
		"python3.13", "python3.12", "python3.11", "python3.10",
		"python3", "python",
	}, "--version"},
	{"node", []string{"node"}, "--version"},
}

// DetectRuntimes probes the machine for installed plugin runtimes.
func DetectRuntimes() []Runtime {
	out := make([]Runtime, 0, len(runtimeProbes))
	for _, p := range runtimeProbes {
		r := Runtime{ID: p.id}
		for _, b := range p.bins {
			path, err := exec.LookPath(b)
			if err != nil {
				continue
			}
			ver := probeVersion(path, p.flag)
			// Skip Python older than 3.10 (many plugin deps require it).
			if p.id == "python" && pythonTooOld(ver) {
				continue
			}
			r.Available = true
			r.bin = path
			r.Version = ver
			break
		}
		out = append(out, r)
	}
	return out
}

// runtimeBin returns the resolved binary for a runtime id, or "" if missing.
func runtimeBin(id string) string {
	for _, r := range DetectRuntimes() {
		if r.ID == id {
			return r.bin
		}
	}
	return ""
}

// resolveBinEntry expands {os}/{arch} placeholders in a "bin" plugin's entry to
// the current platform, adding .exe on Windows. e.g. "bin/app-{os}-{arch}" →
// "bin/app-darwin-arm64".
func resolveBinEntry(entry string) string {
	e := strings.ReplaceAll(entry, "{os}", runtime.GOOS)
	e = strings.ReplaceAll(e, "{arch}", runtime.GOARCH)
	if runtime.GOOS == "windows" && !strings.HasSuffix(e, ".exe") {
		e += ".exe"
	}
	return e
}

// runArgs builds the command + args to launch a plugin's entry for a runtime.
func runArgs(runtime, entry string) (bin string, args []string, ok bool) {
	b := runtimeBin(runtime)
	if b == "" {
		return "", nil, false
	}
	switch runtime {
	case "python":
		return b, []string{entry}, true
	case "node":
		return b, []string{entry}, true
	case "go":
		// `go run <entry-or-dir>` — entry may be "." or a file.
		return b, []string{"run", entry}, true
	}
	return "", nil, false
}

// pythonTooOld reports whether a "Python 3.x.y" version string is < 3.10.
func pythonTooOld(ver string) bool {
	// ver like "Python 3.9.6"
	fields := strings.Fields(ver)
	if len(fields) < 2 {
		return false // unknown → don't reject
	}
	parts := strings.Split(fields[1], ".")
	if len(parts) < 2 {
		return false
	}
	major, _ := strconv.Atoi(parts[0])
	minor, _ := strconv.Atoi(parts[1])
	if major < 3 {
		return true
	}
	return major == 3 && minor < 10
}

func probeVersion(bin, flag string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, flag).CombinedOutput()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0])
}
