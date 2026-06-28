// Package config loads the one typed Config at startup (JSON file + env
// overrides), passed explicitly — no package-level globals.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	RuntimeDir string `json:"runtime_dir"`
	LogLevel   string `json:"log_level"`
}

func Default() Config {
	home, _ := os.UserHomeDir()
	return Config{
		Host:       "127.0.0.1",
		Port:       1430,
		RuntimeDir: filepath.Join(home, ".enowx"),
		LogLevel:   "info",
	}
}

func Load() (Config, error) {
	c := Default()
	if v := os.Getenv("ENOWX_RUNTIME_DIR"); v != "" {
		c.RuntimeDir = v
	}
	if b, err := os.ReadFile(filepath.Join(c.RuntimeDir, "config.json")); err == nil {
		_ = json.Unmarshal(b, &c)
	}
	if v := os.Getenv("ENOWX_HOST"); v != "" {
		c.Host = v
	}
	if v := os.Getenv("ENOWX_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.Port = n
		}
	}
	if v := os.Getenv("ENOWX_LOG_LEVEL"); v != "" {
		c.LogLevel = v
	}
	if err := os.MkdirAll(c.RuntimeDir, 0o755); err != nil {
		return c, err
	}
	return c, nil
}

func (c Config) DBPath() string { return filepath.Join(c.RuntimeDir, "enowx.db") }
func (c Config) Addr() string   { return c.Host + ":" + strconv.Itoa(c.Port) }
