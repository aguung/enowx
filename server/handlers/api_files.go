package handlers

import (
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Files is a read-only file browser for the local machine. Loopback-only, like
// the terminal — it exposes the filesystem to whoever holds the UI.
type Files struct{}

func NewFiles() *Files { return &Files{} }

type entryDTO struct {
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
	Mod   string `json:"mod"`
}

type listDTO struct {
	Path    string     `json:"path"`
	Parent  string     `json:"parent"`
	Home    string     `json:"home"`
	Entries []entryDTO `json:"entries"`
}

func (h *Files) List(w http.ResponseWriter, r *http.Request) {
	if !isLoopback(r) {
		writeAPIErr(w, http.StatusForbidden, "file browser is available on localhost only")
		return
	}
	home, _ := os.UserHomeDir()
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" {
		path = home
	}
	path = filepath.Clean(path)

	items, err := os.ReadDir(path)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, err.Error())
		return
	}
	entries := make([]entryDTO, 0, len(items))
	for _, it := range items {
		info, err := it.Info()
		if err != nil {
			continue
		}
		entries = append(entries, entryDTO{
			Name:  it.Name(),
			IsDir: it.IsDir(),
			Size:  info.Size(),
			Mod:   info.ModTime().Format("2006-01-02 15:04"),
		})
	}
	// Directories first, then alphabetical (case-insensitive).
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	parent := filepath.Dir(path)
	if parent == path {
		parent = ""
	}
	writeData(w, listDTO{Path: path, Parent: parent, Home: home, Entries: entries})
}

const maxRead = 512 * 1024 // 512 KB preview cap

func (h *Files) Read(w http.ResponseWriter, r *http.Request) {
	if !isLoopback(r) {
		writeAPIErr(w, http.StatusForbidden, "file browser is available on localhost only")
		return
	}
	path := filepath.Clean(strings.TrimSpace(r.URL.Query().Get("path")))
	if path == "" || path == "." {
		writeAPIErr(w, http.StatusBadRequest, "path is required")
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if info.IsDir() {
		writeAPIErr(w, http.StatusBadRequest, "path is a directory")
		return
	}
	f, err := os.Open(path)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer f.Close()
	buf := make([]byte, maxRead)
	n, _ := f.Read(buf)
	content := buf[:n]
	writeData(w, map[string]any{
		"path":      path,
		"size":      info.Size(),
		"truncated": info.Size() > int64(n),
		"binary":    looksBinary(content),
		"content":   string(content),
	})
}

func looksBinary(b []byte) bool {
	return bytes.IndexByte(b, 0) >= 0
}
