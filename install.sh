#!/usr/bin/env sh
# enx installer. Downloads the latest release binary for your platform.
#   curl -fsSL https://raw.githubusercontent.com/enowdev/enowx/main/install.sh | sh
set -eu

REPO="enowdev/enowx"
BIN="enx"
# Install per-user by default (~/.local/bin): no sudo to install, and — crucially —
# no sudo to self-update later, since enx can write its own binary there. Override
# with ENX_INSTALL_DIR=... for a system-wide install.
INSTALL_DIR="${ENX_INSTALL_DIR:-$HOME/.local/bin}"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$os" in
  linux) os="linux" ;;
  darwin) os="darwin" ;;
  *) echo "unsupported OS: $os (use the Windows release asset)" >&2; exit 1 ;;
esac
case "$arch" in
  x86_64|amd64) arch="amd64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
esac

asset="${BIN}-${os}-${arch}"
tag="${ENX_VERSION:-}"
if [ -z "$tag" ]; then
  tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' | head -1 | cut -d '"' -f4)"
fi
if [ -z "$tag" ]; then
  echo "could not determine latest release tag" >&2
  exit 1
fi

url="https://github.com/${REPO}/releases/download/${tag}/${asset}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${BIN} ${tag} (${os}/${arch})..."
curl -fsSL "$url" -o "${tmp}/${BIN}"
curl -fsSL "${url}.sha256" -o "${tmp}/${BIN}.sha256" 2>/dev/null || true

if [ -f "${tmp}/${BIN}.sha256" ]; then
  expected="$(cut -d ' ' -f1 "${tmp}/${BIN}.sha256")"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "${tmp}/${BIN}" | cut -d ' ' -f1)"
  else
    actual="$(shasum -a 256 "${tmp}/${BIN}" | cut -d ' ' -f1)"
  fi
  if [ "$expected" != "$actual" ]; then
    echo "checksum mismatch" >&2
    exit 1
  fi
fi

chmod +x "${tmp}/${BIN}"
mkdir -p "$INSTALL_DIR" 2>/dev/null || true
if [ -w "$INSTALL_DIR" ] || mkdir -p "$INSTALL_DIR" 2>/dev/null; then
  mv "${tmp}/${BIN}" "${INSTALL_DIR}/${BIN}"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "${tmp}/${BIN}" "${INSTALL_DIR}/${BIN}"
fi

# On macOS, an unsigned binary that was copied (not code-signed) can be killed by
# Gatekeeper; ad-hoc sign it so it runs.
if [ "$os" = "darwin" ] && command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "${INSTALL_DIR}/${BIN}" 2>/dev/null || true
fi

echo "Installed ${BIN} to ${INSTALL_DIR}/${BIN}"

# Make sure the install dir is on PATH (it often isn't for ~/.local/bin). Add it
# to the user's shell rc so `enx` works in new shells.
case ":$PATH:" in
  *":${INSTALL_DIR}:"*) ;;  # already on PATH
  *)
    added=""
    for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
      [ -f "$rc" ] || continue
      if ! grep -q "${INSTALL_DIR}" "$rc" 2>/dev/null; then
        printf '\n# Added by enx installer\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$rc"
        added="$rc"
        break
      fi
    done
    if [ -n "$added" ]; then
      echo "Added ${INSTALL_DIR} to your PATH in ${added} — open a new terminal (or 'source ${added}')."
    else
      echo "NOTE: add ${INSTALL_DIR} to your PATH: export PATH=\"${INSTALL_DIR}:\$PATH\""
    fi
    ;;
esac

"${INSTALL_DIR}/${BIN}" version
