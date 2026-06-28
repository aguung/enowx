# enx

enx is an OpenAI-compatible LLM proxy gateway. It exposes a single endpoint that
speaks the OpenAI and Anthropic wire formats, normalizes every request into one
internal representation, and forwards it to the upstream provider you route it
to. It ships as a single binary that serves the API, the management UI, and the
account pool on one port.

- Website: https://enowxlabs.com
- Community: https://discord.gg/enowxlabs

## Installation

### Install script (Linux and macOS)

```sh
curl -fsSL https://raw.githubusercontent.com/enowdev/enowx/main/install.sh | sh
```

This downloads the latest release for your platform, verifies its checksum, and
installs the `enx` binary to `/usr/local/bin`. Override the location with
`ENX_INSTALL_DIR`, or pin a version with `ENX_VERSION=vX.Y.Z`.

### Download a release binary

Prebuilt binaries for Linux, macOS, and Windows (amd64 and arm64) are attached to
every release on the [Releases page](https://github.com/enowdev/enowx/releases).
Download the asset for your platform, rename it to `enx` (or `enx.exe` on
Windows), make it executable, and place it on your `PATH`.

### Build from source

Requires Go 1.26+ and Node 22+.

```sh
git clone https://github.com/enowdev/enowx.git
cd enowx
make build      # builds the web UI, embeds it, and produces bin/enx
./bin/enx
```

## Usage

Start the gateway:

```sh
enx
```

By default it listens on `127.0.0.1:1430`. Open `http://localhost:1430` for the
management UI, where you add provider accounts (keys/tokens) to the pool.

Once an account is added, send a standard OpenAI request:

```sh
curl http://localhost:1430/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

Streaming is supported with `"stream": true` and is returned as OpenAI-style
server-sent events.

### Routing

The `model` field selects the upstream provider:

- A `provider/model` prefix routes explicitly, for example `codebuddy/...` or
  `kiro/...`.
- Known prefixes route automatically (`kiro-...`, `codebuddy-...`).
- Anything else falls back to the OpenAI-compatible upstream.

### Configuration

Configuration is read from the environment and an optional `config.json` in the
runtime directory.

| Variable             | Default            | Description                          |
| -------------------- | ------------------ | ------------------------------------ |
| `ENOWX_PORT`         | `1430`             | Listen port.                         |
| `ENOWX_HOST`         | `127.0.0.1`        | Listen address.                      |
| `ENOWX_RUNTIME_DIR`  | `~/.enowx`         | Data directory (SQLite database).    |
| `ENOWX_LOG_LEVEL`    | `info`             | Log verbosity.                       |

State is stored locally in a pure-Go SQLite database; no external services are
required to run the gateway.

### Commands

```sh
enx            # start the gateway
enx version    # print the version
```

## Endpoints

- `POST /v1/chat/completions` — OpenAI-compatible chat completions.
- `GET /health` — health check.
- `GET /api/*` — management API used by the UI.
- `/` — embedded management UI.

## Providers

enx normalizes inbound OpenAI and Anthropic traffic into a single internal
request. Outbound, each provider re-encodes only what it needs: providers that
already speak OpenAI pass through unchanged, while providers with their own
formats are normalized per provider. Current providers:

- OpenAI-compatible upstreams
- CodeBuddy
- Kiro

## Development

```sh
./dev.sh
```

This runs the backend and frontend on one port (`http://localhost:1430`) with
hot reload and no build step. The Go server proxies the SPA and its hot-reload
channel to an internal Vite dev server.

## Community and support

- Website: https://enowxlabs.com
- Discord: https://discord.gg/enowxlabs

## License

See [LICENSE](LICENSE).
