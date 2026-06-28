#!/usr/bin/env sh
# enx installer. Downloads the latest release binary for your platform.
#   curl -fsSL https://raw.githubusercontent.com/enowdev/enowx/main/install.sh | sh
set -eu

REPO="enowdev/enowx"
BIN="enx"
INSTALL_DIR="${ENX_INSTALL_DIR:-/usr/local/bin}"

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
if [ -w "$INSTALL_DIR" ]; then
  mv "${tmp}/${BIN}" "${INSTALL_DIR}/${BIN}"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "${tmp}/${BIN}" "${INSTALL_DIR}/${BIN}"
fi

echo "Installed ${BIN} to ${INSTALL_DIR}/${BIN}"
"${INSTALL_DIR}/${BIN}" version
