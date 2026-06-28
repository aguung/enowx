package handlers

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"

	"github.com/coder/websocket"
	"github.com/creack/pty"
)

// Terminal serves a real PTY shell over a WebSocket. It is gated to loopback
// clients only — a shell reachable from the network would be a takeover risk.
type Terminal struct{}

func NewTerminal() *Terminal { return &Terminal{} }

type termMsg struct {
	Type string `json:"type"`           // "input" | "resize"
	Data string `json:"data,omitempty"` // input bytes
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

func (h *Terminal) WS(w http.ResponseWriter, r *http.Request) {
	if !isLoopback(r) {
		http.Error(w, "terminal is available on localhost only", http.StatusForbidden)
		return
	}

	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
	if err != nil {
		return
	}
	defer c.Close(websocket.StatusNormalClosure, "")

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	cmd := exec.Command(shell, "-l")
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home
	}
	ptmx, err := pty.Start(cmd)
	if err != nil {
		c.Close(websocket.StatusInternalError, "pty start failed")
		return
	}
	defer func() {
		_ = ptmx.Close()
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// PTY -> client (binary frames).
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				if werr := c.Write(ctx, websocket.MessageBinary, buf[:n]); werr != nil {
					cancel()
					return
				}
			}
			if err != nil {
				cancel()
				return
			}
		}
	}()

	// client -> PTY (control + input).
	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageText {
			ptmx.Write(data)
			continue
		}
		var m termMsg
		if json.Unmarshal(data, &m) != nil {
			ptmx.Write(data)
			continue
		}
		switch m.Type {
		case "resize":
			_ = pty.Setsize(ptmx, &pty.Winsize{Cols: m.Cols, Rows: m.Rows})
		case "input":
			ptmx.Write([]byte(m.Data))
		default:
			ptmx.Write(data)
		}
	}
}

func isLoopback(r *http.Request) bool {
	host := r.Host
	if h, _, err := net.SplitHostPort(r.Host); err == nil {
		host = h
	}
	if host == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return strings.HasPrefix(host, "127.") || host == "[::1]"
}
