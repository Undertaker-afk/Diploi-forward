# Diploi Forward

Internet-facing forwarder for Diploi internal AI proxy endpoints.

This service exposes OpenAI-compatible and Anthropic-compatible API paths while authenticating to Diploi with:

- `DIPLOI_AI_TOKEN`
- `DIPLOI_AI_API_BASE_URL` (example: `http://core.diploi/ai-core-proxy/v1`)

> `http://core.diploi/ai-core-proxy/v1` is an internal-example URL; replace it with your actual reachable Diploi AI proxy base URL.

It also supports a repo bootstrap endpoint that reads `diploi.yaml` from a GitHub repository.

## Features

- OpenAI-compatible forwarding:
  - `/v1/*`
  - `/openai/v1/*`
- Anthropic-compatible forwarding:
  - `/anthropic/v1/*`
- GitHub repo config discovery:
  - `POST /configure/repo`
- Health and diagnostics:
  - `GET /health`
  - `GET /config`

## Run

```bash
npm install
DIPLOI_AI_TOKEN="<token>" \
DIPLOI_AI_API_BASE_URL="http://core.diploi/ai-core-proxy/v1" \
npm start
```

Server default port: `3000` (override with `PORT`).

## API

### Forward OpenAI-style request

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.3-codex","messages":[{"role":"user","content":"hello"}]}'
```

### Forward Anthropic-style request

```bash
curl -X POST http://localhost:3000/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":128,"messages":[{"role":"user","content":"hello"}]}'
```

### Discover `diploi.yaml` from a GitHub repo

```bash
curl -X POST http://localhost:3000/configure/repo \
  -H "Content-Type: application/json" \
  -d '{"repo":"owner/repo"}'
```

Request fields:

- `repo` (or `githubRepo`): `owner/repo` or `https://github.com/owner/repo`
- `ref` (optional): branch/tag/sha. Defaults to trying `main`, then `master`.

The endpoint reads one of:

- `diploi.yaml`
- `diploi.yml`
- `.diploi/diploi.yaml`
- `.diploi/diploi.yml`

and returns discovered models/providers.

## Notes

- Credentials are always sourced from server environment variables.
- Incoming auth headers are overridden with server-side credentials before forwarding.
