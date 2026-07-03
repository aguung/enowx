#!/usr/bin/env bash
# Cross-compile the restore-legacy plugin into prebuilt binaries and assemble a
# "bin"-runtime plugin folder (dist/) ready to install + publish to the
# marketplace, so users run it without a Go toolchain.
set -euo pipefail
cd "$(dirname "$0")"

APP="restore-legacy"
OUT="dist"
rm -rf "$OUT"
mkdir -p "$OUT/bin" "$OUT/public"

# Targets: the os/arch pairs the vast majority of users are on. (Kept under the
# 30 MB marketplace bundle cap; niche targets like linux/arm64 use the go source.)
TARGETS=("darwin/arm64" "darwin/amd64" "linux/amd64" "windows/amd64")
for t in "${TARGETS[@]}"; do
  os="${t%/*}"; arch="${t#*/}"
  name="${APP}-${os}-${arch}"
  [ "$os" = "windows" ] && name="${name}.exe"
  echo "building $name"
  CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags="-s -w" -o "$OUT/bin/$name" .
done

# UI + a bin-runtime manifest (entry uses {os}/{arch} placeholders).
cp -r public/* "$OUT/public/"
cat > "$OUT/plugin.json" <<'JSON'
{
  "id": "restore-legacy",
  "name": "Restore Old Account",
  "description": "Bring your provider accounts (and donation total) over from the previous enowx into this app. Runs locally; your credentials never leave your machine.",
  "icon": "DownloadCloud",
  "runtime": "bin",
  "entry": "bin/restore-legacy-{os}-{arch}",
  "ui": "public/index.html"
}
JSON

echo "done → $OUT/ (install this folder, then publish)"
