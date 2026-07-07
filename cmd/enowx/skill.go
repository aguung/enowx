package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const skillRepo = "https://github.com/enowdev/enowX-Skill.git"

// skillCmd handles `enx skill install|list|remove|update <slug> [-g]`.
//
//	enx skill install <slug>       install into ./.agents/skill/<slug> (project)
//	enx skill install <slug> -g    install into ~/.agents/skill/<slug> (global)
//	enx skill list                 list installed skills
//	enx skill remove <slug>        uninstall a skill
//	enx skill update <slug>        reinstall to the latest version
func skillCmd(args []string) {
	sub := ""
	if len(args) > 0 {
		sub = args[0]
		args = args[1:]
	}
	switch sub {
	case "install", "add":
		skillInstall(args)
	case "list":
		skillList()
	case "remove", "rm", "uninstall":
		skillRemove(args)
	case "update", "upgrade":
		skillUpdate(args)
	default:
		fmt.Fprintln(os.Stderr, "usage: enx skill install <slug> [-g]")
		fmt.Fprintln(os.Stderr, "       enx skill list")
		fmt.Fprintln(os.Stderr, "       enx skill remove <slug>")
		fmt.Fprintln(os.Stderr, "       enx skill update <slug>")
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
	if !validSkillSlug(slug) {
		fmt.Fprintf(os.Stderr, "invalid skill name %q\n", slug)
		os.Exit(1)
	}

	// git is required for the sparse checkout.
	if _, err := exec.LookPath("git"); err != nil {
		fmt.Fprintln(os.Stderr, "git is required to install skills — please install git and retry")
		os.Exit(1)
	}

	// Destination: ~/.agents/skill/<slug> (global) or ./.agents/skill/<slug>.
	base := skillBase(global)
	scope := "this project"
	if global {
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

// skillList prints all installed skills (global + project).
func skillList() {
	type entry struct {
		slug  string
		scope string
		path  string
	}
	var entries []entry
	dirs := []struct {
		label string
		dir   string
	}{
		{"global", filepath.Join(skillBase(true), "skill")},
		{"project", filepath.Join(skillBase(false), "skill")},
	}
	for _, d := range dirs {
		items, err := os.ReadDir(d.dir)
		if err != nil {
			continue
		}
		for _, e := range items {
			if e.IsDir() {
				entries = append(entries, entry{
					slug:  e.Name(),
					scope: d.label,
					path:  filepath.Join(d.dir, e.Name()),
				})
			}
		}
	}
	if len(entries) == 0 {
		fmt.Println("no skills installed")
		return
	}
	fmt.Printf("%-24s %-8s %s\n", "slug", "scope", "path")
	fmt.Println(strings.Repeat("-", 72))
	for _, e := range entries {
		fmt.Printf("%-24s %-8s %s\n", e.slug, e.scope, e.path)
	}
}

// skillRemove uninstalls a skill by slug.
func skillRemove(args []string) {
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
		fmt.Fprintln(os.Stderr, "usage: enx skill remove <slug> [-g]")
		os.Exit(1)
	}
	if !validSkillSlug(slug) {
		fmt.Fprintf(os.Stderr, "invalid skill name %q\n", slug)
		os.Exit(1)
	}
	base := skillBase(global)
	dest := filepath.Join(base, "skill", slug)
	if _, err := os.Stat(dest); err != nil {
		if global {
			fmt.Fprintf(os.Stderr, "skill %q is not installed globally\n", slug)
			os.Exit(1)
		}
		// Try global as fallback.
		globalDest := filepath.Join(skillBase(true), "skill", slug)
		if _, err2 := os.Stat(globalDest); err2 == nil {
			dest = globalDest
			global = true
		} else {
			fmt.Fprintf(os.Stderr, "skill %q is not installed\n", slug)
			os.Exit(1)
		}
	}
	scope := "project"
	if global {
		scope = "global"
	}
	if err := os.RemoveAll(dest); err != nil {
		fmt.Fprintf(os.Stderr, "remove failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("✓ removed %q (%s)\n", slug, scope)
}

// skillUpdate reinstalls a skill (remove + install).
func skillUpdate(args []string) {
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
		fmt.Fprintln(os.Stderr, "usage: enx skill update <slug> [-g]")
		os.Exit(1)
	}
	if !validSkillSlug(slug) {
		fmt.Fprintf(os.Stderr, "invalid skill name %q\n", slug)
		os.Exit(1)
	}
	// Check that git is available.
	if _, err := exec.LookPath("git"); err != nil {
		fmt.Fprintln(os.Stderr, "git is required to update skills")
		os.Exit(1)
	}
	// Remove existing.
	base := skillBase(global)
	dest := filepath.Join(base, "skill", slug)
	if _, err := os.Stat(dest); err == nil {
		_ = os.RemoveAll(dest)
	}
	// Reinstall.
	skillInstall(args)
}

// validSkillSlug reports whether a slug is a safe single path segment (letters,
// digits, dot, underscore, hyphen) — so it can't escape the skill directory. It
// mirrors the community skill naming and guards remove/update's RemoveAll.
func validSkillSlug(slug string) bool {
	if slug == "" || slug == "." || slug == ".." {
		return false
	}
	for _, r := range slug {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '-', r == '_', r == '.':
		default:
			return false
		}
	}
	return true
}

// skillBase returns the base agents directory for global or project scope.
func skillBase(global bool) string {
	if global {
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintf(os.Stderr, "cannot resolve home directory: %v\n", err)
			os.Exit(1)
		}
		return filepath.Join(home, ".agents")
	}
	return ".agents"
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
