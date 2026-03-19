# GitLab Pipeline Status

Real-time web dashboard for GitLab pipeline status. Shows projects, branches, and pipeline results with live updates via Server-Sent Events.

## Features

- **Real-time updates** via SSE — no polling from the browser
- **Group support** — monitor entire GitLab groups or individual projects
- **Multi-server** — monitor multiple GitLab instances simultaneously
- **Multi-token fallback** — configure backup tokens with health warnings
- **Project filtering** — exclude projects by name or path
- **Merge request info** — shows MR status and approvals per branch
- **Dark mode** — automatic based on system preference

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **Backend:** [Hono](https://hono.dev) (API JSON + SSE)
- **Frontend:** [Preact](https://preactjs.com) + htm (ESM, no build step)
- **Real-time:** Server-Sent Events (SSE)

## Quick Start

```bash
# Clone and configure
git clone https://github.com/genuinefafa/gitlab-pipeline-status-single.git
cd gitlab-pipeline-status-single
cp config.example.yaml config.yaml
# Edit config.yaml with your GitLab tokens

# Run with Bun
bun install
bun run dev

# Or with Docker
docker compose up -d
```

Open **http://localhost:3000**

## Configuration

Copy `config.example.yaml` to `config.yaml`:

```yaml
refreshInterval: 30

excludeProjects:
  - "general"

servers:
  - name: "GitLab"
    url: "https://gitlab.com"
    tokens:
      - value: "glpat-xxx"
        name: "Primary"
        expiresAt: "2025-12-31"
      - value: "glpat-yyy"
        name: "Backup"
    groups:
      - path: "my-org/apps"
        includeSubgroups: true
    projects:
      - path: "my-org/critical-service"
```

### Options

| Field | Description |
|-------|-------------|
| `refreshInterval` | Seconds between polling cycles (default: 30) |
| `excludeProjects` | Project names/paths to hide (case-insensitive partial match) |
| `servers[].name` | Display name |
| `servers[].url` | GitLab instance URL |
| `servers[].token` | Single token (legacy, still supported) |
| `servers[].tokens` | Array of tokens with fallback (recommended) |
| `servers[].projects` | Individual projects by `path` |
| `servers[].groups` | Groups by `path`, with optional `includeSubgroups` |

### Getting a GitLab Token

1. Go to **User Settings → Access Tokens**
2. Create a token with `read_api` scope
3. Add it to `config.yaml`

### Token Health

Configure multiple tokens per server for automatic failover. The UI shows token health status, and `/api/token-status` returns detailed info.

| Status | Meaning |
|--------|---------|
| valid | Active, not near expiry |
| expiring | ≤ 7 days remaining |
| expired | Past expiry date |
| invalid | Revoked or unreachable |

## Development

```bash
bun install
bun run dev       # Dev server with hot reload
```

### Type checking

```bash
bash scripts/typecheck.sh
```

## Project Structure

```
src/
  index.ts           # Hono server setup
  config.ts          # YAML config loader
  gitlab.ts          # GitLab API client
  cache.ts           # In-memory cache with TTL
  poller.ts          # Background polling loop
  sse-manager.ts     # SSE client management
  token-manager.ts   # Token validation and fallback
  logger.ts          # Structured logging
  types.ts           # TypeScript interfaces
  routes/
    api.ts           # REST API endpoints
    events.ts        # SSE stream + subscriptions
    health.ts        # Health check endpoints
public/
  index.html         # Main SPA shell
  app.js             # Preact frontend (ESM)
  about.html         # About page
  style.css          # Styles + dark mode
  favicon.svg
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/projects` | All projects with branches and pipelines |
| `GET /api/token-status` | Token health for all servers |
| `GET /api/version` | Build version info |
| `GET /api/events?clientId=x` | SSE stream |
| `POST /api/subscribe` | Subscribe/unsubscribe to branch updates |
| `GET /api/health` | Health check |

## Docker

```bash
docker compose up -d          # Start
docker compose logs -f        # Logs
docker compose up -d --build  # Rebuild after changes
```

## License

MIT
