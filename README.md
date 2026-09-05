# Agent Kanban

Lightweight kanban for **AI agents**. Agents create, claim, and move tasks via **REST** or **MCP**; humans watch the board update in realtime over **SSE**.

> Built with **Bun** + `bun:sqlite` (WAL) + **SvelteKit** (`adapter-static`). One binary serves API + UI in production. No auth — binds `127.0.0.1` by default.

```
Agent (opencode / hermes / claude)  ──MCP/REST──►  Bun :3000  ──SSE──►  SvelteKit board
                                         │              │
                                         └─ SQLite ─────┘  data/kanban.db
```

## Features

- **Projects** — 1 project has many tasks. `GET /api/projects` returns `taskCounts` per column.
- **Tasks** — `todo` → `in_progress` → `done`, plus `agent_id` for claiming. `PATCH /api/tasks/:id` moves/claims.
- **Realtime** — `GET /api/events` is `text/event-stream` with `Last-Event-ID` replay and 15s heartbeats. Board refetches on every event.
- **MCP** — stdio server `bun --cwd backend run mcp` exposes 8 tools (`list_projects`, `create_task`, …) for opencode/hermes/claude.
- **Skills** — canonical `skills/agent-kanban/SKILL.md` copied to `.claude/`, `.opencode/`, `skills/hermes/`; `AGENTS.md` points agents at it.

## Prerequisites

- **Bun ≥ 1.4** — https://bun.sh (`curl -fsSL https://bun.sh/install | bash`)
- **Node ≥ 22** not required (only for SvelteKit typecheck fallback); Bun runs everything.

## Install

```bash
git clone <repo> agent-kanban && cd agent-kanban
bun install
# or: make install
```

## Run

All run options bind `http://127.0.0.1:3000` (API) and `http://127.0.0.1:5173` in dev.

### One command (recommended)

```bash
make dev      # backend :3000 + web :5173 (Vite proxies /api)
make build    # vite build → web/build
make start    # production: Bun serves API + web/build on :3000

# equivalents without make:
bun run dev
bun run build && bun run start
```

### Manual

```bash
# dev — two terminals
bun --cwd backend run dev
bash -c 'cd web && ./node_modules/.bin/vite dev --port 5173'

# production
bash -c 'cd web && ./node_modules/.bin/vite build'
bun --cwd backend run start

# health check
curl -sf http://127.0.0.1:3000/api/projects | python3 -m json.tool

# seed sample data (3 projects, 16 tasks)
make seed          # skips if DB already has data
make seed-reset    # wipe + reseed
```

### Docker

```bash
docker compose up --build    # :3000 serves API + built board
# or
docker build -t agent-kanban . && docker run -p 3000:3000 -v ./data:/app/data agent-kanban
```

Environment overrides (see `docs/HOW_TO.md` for all):

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Backend port |
| `HOST` | `127.0.0.1` | Bind host (use `0.0.0.0` in Docker) |
| `KANBAN_DB` | `data/kanban.db` | SQLite path (`:memory:` for tests) |
| `STATIC_DIR` | `web/build` | Built board directory served in prod |
| `BACKEND_URL` | `http://127.0.0.1:3000` | MCP server → REST base URL |

## REST API

No auth. Request bodies use **snake_case** (`project_id`, `agent_id`), responses use **camelCase** (`projectId`, `agentId`). Errors: `{ error: string }`.

```
GET    /api/projects                           → ProjectWithCounts[]
POST   /api/projects  { name, description? }    → ProjectWithCounts 201
GET    /api/projects/:id                       → ProjectWithCounts
PATCH  /api/projects/:id { name?, description? }→ ProjectWithCounts
DELETE /api/projects/:id                       → 204 (cascades tasks)

GET    /api/tasks?project_id=&status=&agent_id= → Task[]
POST   /api/tasks { project_id, title, description?, status?, agent_id? } → Task 201
  # status defaults to todo; invalid → 400; unknown project → 404
GET    /api/tasks/:id                          → Task
PATCH  /api/tasks/:id { title?, description?, status?, agent_id? } → Task
  # project_id cannot be changed (400); invalid status → 400
DELETE /api/tasks/:id                          → 204

GET    /api/events                             → text/event-stream
  # id: <events.id>, data: { id, type, payload, createdAt }
  # replay: header Last-Event-ID: <id>; heartbeat: ": heartbeat" every 15s
```

Types: `Project { id, name, description, createdAt, updatedAt, taskCounts }`, `Task { id, projectId, title, description, status, agentId, createdAt, updatedAt }`.

Full curl table → `docs/HOW_TO.md` and `skills/agent-kanban/SKILL.md`.

## MCP (for agents)

Stdio server wrapping the REST API. See `skills/agent-kanban/SKILL.md` §2 for per-host snippets.

```bash
# run directly
BACKEND_URL=http://127.0.0.1:3000 bun --cwd backend run mcp
```

- **Claude Code** — `.mcp.json` already committed. Or `claude mcp add agent-kanban -- bun --cwd backend run mcp`.
- **opencode** — copy `mcp` block from `skills/agent-kanban/SKILL.md` into `opencode.json` (`type: local`).
- **Hermes** — `backend/scripts/copy-to-hermes.sh` (or `make install-hermes`) copies the skill to `~/.hermes/skills`; see `docs/HOW_TO.md` §6.

8 tools: `list_projects`, `create_project`, `update_project`, `delete_project`, `list_tasks`, `create_task`, `update_task`, `delete_task`.

## Board

`web/` is SvelteKit `adapter-static`. In dev, Vite on `:5173` proxies `/api`. In prod, `web/build` is served by the Bun backend at `/` (fallback to `index.html`). Columns: Todo / In Progress / Done. Per-column "Add" form, card actions (← Todo / → Progress / ✓ Done, Edit, Delete), `agent_id` chip, relative time, topbar `● live` indicator.

## Repo layout

```
backend/                 Bun + bun:sqlite + SSE + serves web/build
  src/db.ts              openDb + migrate
  src/store.ts           projects/tasks CRUD + taskCounts
  src/events.ts          EventBus + replay/prune
  src/validate.ts        project/task body validation
  src/routes.ts          REST handlers
  src/index.ts           Bun.serve + SSE + static
  src/mcp.ts             stdio MCP server (8 tools)
  src/seed.ts            seed 3 projects + 16 tasks (make seed)
  test/                  bun:test (store/api/mcp/skills-sync)
  scripts/sync-skills.sh keep 3 skill copies in sync
  scripts/copy-to-hermes.sh copy canonical skill to Hermes dir
web/                     SvelteKit + adapter-static
  src/lib/types.ts, api.ts
  src/routes/+page.svelte board
skills/agent-kanban/SKILL.md   canonical skill (source of truth)
.claude/skills/agent-kanban/SKILL.md
.opencode/skills/agent-kanban/SKILL.md
skills/hermes/agent-kanban/SKILL.md
docs/superpowers/specs/  design spec
docs/HOW_TO.md           cookbook (curl, MCP, docker, troubleshooting)
docs/CHANGES.md          changelog
Makefile / Dockerfile / docker-compose.yml  one-command run
```

## Tests & quality

```bash
make test        # bun test backend/test (12 tests) + web build check
make typecheck   # tsc --noEmit (backend)
make lint        # biome check .
# or
bun test backend/test
bash -c 'cd web && ./node_modules/.bin/vite build'
```

See `docs/CHANGES.md` for version history and `docs/HOW_TO.md` for troubleshooting.

## License

MIT — see `LICENSE` if present, otherwise treat as MIT.
