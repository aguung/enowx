package plugins

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

//go:embed all:templates
var templatesFS embed.FS

// entryFor is the default entry file per runtime.
var entryFor = map[string]string{
	"python": "main.py",
	"node":   "index.js",
	"go":     ".",
	"static": "",
}

// Create scaffolds a new plugin folder + writes a plugin.json. If starter is
// true it also copies the runtime's example files; otherwise the folder is left
// empty (just the manifest) so the author can structure the plugin however they
// like and code it in their own IDE. Returns the created manifest.
func (m *Manager) Create(id, name, runtime string, starter bool) (*Manifest, error) {
	if !idRe.MatchString(id) {
		return nil, fmt.Errorf("invalid plugin id (lowercase letters, digits, dashes)")
	}
	if !validRuntimes[runtime] {
		return nil, fmt.Errorf("invalid runtime")
	}
	dest := filepath.Join(m.dir, id)
	if _, err := os.Stat(dest); err == nil {
		return nil, fmt.Errorf("a plugin with id %q already exists", id)
	}
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return nil, err
	}
	// Starter files ship for python/node/static; go authors bring their own.
	tmplRuntime := runtime
	if runtime == "go" {
		tmplRuntime = ""
	}
	if starter && tmplRuntime != "" {
		if err := copyTemplate(tmplRuntime, dest); err != nil {
			return nil, err
		}
	}

	man := &Manifest{
		ID: id, Name: nz(name, id), Description: "", Icon: "puzzle",
		Runtime: runtime, Entry: entryFor[runtime], UI: "public/index.html",
		Version: "1.0.0",
	}
	raw, _ := json.MarshalIndent(man, "", "  ")
	if err := os.WriteFile(filepath.Join(dest, "plugin.json"), raw, 0o644); err != nil {
		return nil, err
	}
	return man, nil
}

// copyTemplate copies templates/<runtime>/* into dest.
func copyTemplate(runtime, dest string) error {
	root := "templates/" + runtime
	return fs.WalkDir(templatesFS, root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		target := filepath.Join(dest, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := templatesFS.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}

func nz(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}
