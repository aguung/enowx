package mitm

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

// runElevated runs a single command with elevated privileges, prompting the user
// via the OS's native mechanism (macOS AppleScript admin dialog, Windows UAC,
// Linux pkexec/sudo). Used for the trust-store install and hosts-file writes,
// which need root/admin. Returns combined output on failure.
func runElevated(name string, args ...string) error {
	switch runtime.GOOS {
	case "darwin":
		return elevateDarwin(name, args...)
	case "windows":
		return elevateWindows(name, args...)
	default:
		return elevateLinux(name, args...)
	}
}

// elevateDarwin uses `osascript ... with administrator privileges`, which shows
// the native macOS password/Touch-ID dialog — no terminal sudo needed.
func elevateDarwin(name string, args ...string) error {
	// Build a shell-quoted command line for the embedded `do shell script`.
	parts := append([]string{name}, args...)
	quoted := make([]string, len(parts))
	for i, p := range parts {
		quoted[i] = shellQuote(p)
	}
	shellCmd := strings.Join(quoted, " ")
	// AppleScript string: escape backslashes then double-quotes.
	esc := strings.ReplaceAll(shellCmd, `\`, `\\`)
	esc = strings.ReplaceAll(esc, `"`, `\"`)
	script := fmt.Sprintf(`do shell script "%s" with administrator privileges`, esc)
	out, err := exec.Command("osascript", "-e", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("elevation failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// elevateWindows re-runs the command elevated via PowerShell Start-Process -Verb
// RunAs (triggers the UAC prompt).
func elevateWindows(name string, args ...string) error {
	argList := ""
	if len(args) > 0 {
		q := make([]string, len(args))
		for i, a := range args {
			q[i] = "'" + strings.ReplaceAll(a, "'", "''") + "'"
		}
		argList = " -ArgumentList " + strings.Join(q, ",")
	}
	ps := fmt.Sprintf("Start-Process -FilePath '%s'%s -Verb RunAs -Wait -WindowStyle Hidden",
		strings.ReplaceAll(name, "'", "''"), argList)
	out, err := exec.Command("powershell", "-NoProfile", "-Command", ps).CombinedOutput()
	if err != nil {
		return fmt.Errorf("elevation failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// elevateLinux prefers pkexec (GUI polkit prompt), falling back to sudo.
func elevateLinux(name string, args ...string) error {
	if _, err := exec.LookPath("pkexec"); err == nil {
		out, err := exec.Command("pkexec", append([]string{name}, args...)...).CombinedOutput()
		if err != nil {
			return fmt.Errorf("elevation failed: %s", strings.TrimSpace(string(out)))
		}
		return nil
	}
	out, err := exec.Command("sudo", append([]string{"-n", name}, args...)...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("elevation failed (need sudo): %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// shellQuote single-quotes an argument for POSIX shells.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
