package mitm

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// hostsPath returns the OS hosts-file location.
func hostsPath() string {
	if runtime.GOOS == "windows" {
		return `C:\Windows\System32\drivers\etc\hosts`
	}
	return "/etc/hosts"
}

const (
	hostsBegin = "# BEGIN enx-mitm"
	hostsEnd   = "# END enx-mitm"
)

// EnableHosts redirects the given hosts to 127.0.0.1 by adding an enx-managed
// block to the hosts file, then flushes the DNS cache. Replaces any prior block.
func EnableHosts(hosts []string) error {
	if len(hosts) == 0 {
		return nil
	}
	var b strings.Builder
	b.WriteString(hostsBegin + "\n")
	for _, h := range hosts {
		b.WriteString("127.0.0.1 " + h + "\n")
	}
	b.WriteString(hostsEnd + "\n")
	if err := writeHostsBlock(b.String()); err != nil {
		return err
	}
	flushDNS()
	return nil
}

// DisableHosts removes the enx-managed block from the hosts file + flushes DNS.
func DisableHosts() error {
	if err := writeHostsBlock(""); err != nil {
		return err
	}
	flushDNS()
	return nil
}

// HostsEnabled reports whether our block is currently present.
func HostsEnabled() bool {
	b, err := os.ReadFile(hostsPath())
	if err != nil {
		return false
	}
	return strings.Contains(string(b), hostsBegin)
}

// writeHostsBlock replaces (or removes, when block=="") the enx block in the
// hosts file, preserving everything else. Requires write access to the hosts file
// (elevated privileges).
func writeHostsBlock(block string) error {
	path := hostsPath()
	existing, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	cleaned := stripBlock(string(existing))
	out := cleaned
	if block != "" {
		if !strings.HasSuffix(out, "\n") && out != "" {
			out += "\n"
		}
		out += block
	}
	return os.WriteFile(path, []byte(out), 0o644)
}

// stripBlock removes our BEGIN..END block (and its trailing newline) from text.
func stripBlock(text string) string {
	lines := strings.Split(text, "\n")
	var out []string
	skip := false
	for _, ln := range lines {
		t := strings.TrimSpace(ln)
		if t == hostsBegin {
			skip = true
			continue
		}
		if t == hostsEnd {
			skip = false
			continue
		}
		if !skip {
			out = append(out, ln)
		}
	}
	return strings.Join(out, "\n")
}

// flushDNS best-effort clears the OS resolver cache so the new hosts entries take
// effect immediately.
func flushDNS() {
	switch runtime.GOOS {
	case "darwin":
		_ = exec.Command("dscacheutil", "-flushcache").Run()
		_ = exec.Command("killall", "-HUP", "mDNSResponder").Run()
	case "linux":
		_ = exec.Command("resolvectl", "flush-caches").Run()
	case "windows":
		_ = exec.Command("ipconfig", "/flushdns").Run()
	}
}
