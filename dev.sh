#!/usr/bin/env bash
# Dev mode, one port, hot-reload, no build step:
#   - Go server (air, -tags dev) listens on :1430, serves /api + /v1 and proxies
#     everything else (SPA + HMR) to the internal Vite server on :5174.
#   - Open http://localhost:1430
set -euo pipefail
cd "$(dirname "$0")"

export ENOWX_PORT="${ENOWX_PORT:-1430}"
export ENOWX_VITE_PORT="${ENOWX_VITE_PORT:-5174}"
# Dev talks to the staging cloud; the built-in default is production.
export ENOWX_SYNC_SERVER="${ENOWX_SYNC_SERVER:-https://api-dev.enowxlabs.com}"

command -v air >/dev/null 2>&1 || { echo "installing air…"; go install github.com/air-verse/air@latest; }

# Install frontend deps if missing (or if package.json changed since last install).
if [ ! -d web/node_modules ] || [ web/package.json -nt web/node_modules ]; then
  echo "installing web deps…"
  ( cd web && npm install )
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "▶ enowx dev on http://localhost:${ENOWX_PORT} (Go proxies → Vite :${ENOWX_VITE_PORT})"
( air ) &
( cd web && npm run dev ) &
wait
