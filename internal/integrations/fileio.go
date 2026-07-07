package integrations

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// writeAtomic writes data to path via a temp file + rename, creating parent dirs.
// Files are 0600, dirs 0700 — these hold credentials.
func writeAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".enx-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after a successful rename
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

// readJSON loads a JSON object from path into a map, returning an empty map when
// the file is missing or empty (so callers can merge unconditionally).
func readJSON(path string) (map[string]any, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	if len(b) == 0 {
		return map[string]any{}, nil
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		// Corrupt/non-object config — start fresh rather than fail the connect.
		return map[string]any{}, nil
	}
	if m == nil {
		m = map[string]any{}
	}
	return m, nil
}

// writeJSON marshals v (indented) and writes it atomically.
func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(path, append(b, '\n'))
}

// asMap returns m[key] as a map, creating it if absent/typed wrong.
func asMap(m map[string]any, key string) map[string]any {
	if v, ok := m[key].(map[string]any); ok {
		return v
	}
	sub := map[string]any{}
	m[key] = sub
	return sub
}

// fileExists reports whether a path exists.
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
