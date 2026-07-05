package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const skillRepo = "https://github.com/enowdev/enowX-Skill.git"

// skillCmd handles `enx skill install <slug> [-g]`.
//
//	enx skill install <slug>       install into ./.agents/skill/<slug> (project)
//	enx skill install <slug> -g    install into ~/.agents/skill/<slug> (global)
func skillCmd(args []string) {
	sub := ""
	if len(args) > 0 {
		sub = args[0]
		args = args[1:]
	}
	switch sub {
	case "install", "add":
		skillInstall(args)
	default:
		fmt.Fprintln(os.Stderr, "usage: enx skill install <slug> [-g]")
		os.Exit(1)
	}
}

func skillInstall(args []string) {
	var slug string
	global := false
	for _, a := range args {
		switch a {
		case "-g", "--global":
			global = true
		default:
			if strings.HasPrefix(a, "-") {
				fmt.Fprintf(os.Stderr, "unknown flag %q\n", a)
				os.Exit(1)
			}
			slug = a
		}
	}
	if slug == "" {
		fmt.Fprintln(os.Stderr, "usage: enx skill install <slug> [-g]")
		os.Exit(1)
	}

	// git is required for the sparse checkout.
	if _, err := exec.LookPath("git"); err != nil {
		fmt.Fprintln(os.Stderr, "git is required to install skills — please install git and retry")
		os.Exit(1)
	}

	// Destination: ~/.agents/skill/<slug> (global) or ./.agents/skill/<slug>.
	base := ".agents"
	scope := "this project"
	if global {
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintf(os.Stderr, "cannot resolve home directory: %v\n", err)
			os.Exit(1)
		}
		base = filepath.Join(home, ".agents")
		scope = "globally"
	}
	dest := filepath.Join(base, "skill", slug)
	if _, err := os.Stat(dest); err == nil {
		fmt.Fprintf(os.Stderr, "%q is already installed at %s (remove it first to reinstall)\n", slug, dest)
		os.Exit(1)
	}

	fmt.Printf("installing skill %q %s…\n", slug, scope)

	// Sparse-checkout only skill/<slug>/ from the registry repo into a temp dir,
	// then move that folder to the destination.
	tmp, err := os.MkdirTemp("", "enx-skill-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
	defer os.RemoveAll(tmp)

	sub := "skill/" + slug
	steps := [][]string{
		{"clone", "--depth", "1", "--filter=blob:none", "--sparse", skillRepo, tmp},
		{"-C", tmp, "sparse-checkout", "set", sub},
	}
	for _, s := range steps {
		cmd := exec.Command("git", s...)
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "git %s failed: %v\n", s[0], err)
			os.Exit(1)
		}
	}

	src := filepath.Join(tmp, "skill", slug)
	if _, err := os.Stat(src); err != nil {
		fmt.Fprintf(os.Stderr, "skill %q not found in the registry\n", slug)
		os.Exit(1)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
	if err := os.Rename(src, dest); err != nil {
		// Cross-device (temp on another fs): fall back to a copy.
		if err := copyDir(src, dest); err != nil {
			fmt.Fprintf(os.Stderr, "install failed: %v\n", err)
			os.Exit(1)
		}
	}
	fmt.Printf("✓ installed %q → %s\n", slug, dest)
}

// copyDir recursively copies src to dst (fallback when os.Rename can't cross fs).
func copyDir(src, dst string) error {
	return filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, info.Mode())
	})
}
