# Agent Kanban — Design

Date: 2026-09-05
Status: Approved (pending implementation)

## Purpose

A lightweight kanban system consumed by AI agents (opencode, hermes) and monitored by a human in a browser. Agents create, update, and delete tasks over a REST API and MCP tools; the human watches task state change in realtime on a board.

Non-goals: authentication, multi-user, custom columns, cloud deployment.

## Architecture

**Approach A — Bun API core + SvelteKit static frontend.**

Three units:

1. `backend/` — Bun + TypeScript server on `127.0.0.1:3000` (port overridable via `PORT`).
   - REST API under `/api`.
   - SSE stream at `/api/events`.
   - SQLite persistence via `bun:sqlite` (file `data/kanban.db`).
   - In production serves the built SvelteKit output as static files, so one process exposes both UI and API.
2. `web/` — SvelteKit frontend, `adapter-static`, prerendered, client-only monitor. Dev mode: Vite dev server on `:5173` proxying `/api` to `:3000`.
3. `backend/src/mcp.ts` — stdio MCP server (`bun run mcp`) wrapping the REST API. Configured in opencode/hermes via the standard MCP config block; env `BACKEND_URL` defaults to `http://127.0.0.1:3000`.

Rationale: the agent-facing API and the human-facing UI stay independent; production is a single process and port; stdio MCP is the transport opencode/hermes expect.

## Data model

SQLite, single database file, WAL mode. All timestamps are `created_at` / `updated_at` ISO-8601 strings maintained by the backend (nobody sends timestamps).

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,            -- nanoid
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,            -- nanoid
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL CHECK (status IN ('todo','in_progress','done')),
  agent_id    TEXT,                        -- which agent owns/claims the task
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,               -- e.g. 'task.created', 'task.updated', 'task.deleted', 'project.*'
  payload    TEXT NOT NULL,               -- JSON snapshot of the entity after the change
  created_at TEXT NOT NULL
);
```

- Fixed statuses: `todo`, `in_progress`, `done`.
- `agent_id` is a free-form string supplied by the calling agent (e.g. `opencode-main`); no agent registry.
- Events persist so SSE clients can replay missed updates via `Last-Event-ID`.
- Old events may be pruned opportunistically (keep last ~1000); not critical.

## REST API

No auth. Server binds `127.0.0.1` by default (`HOST` env to override). Errors: JSON `{ error: string }` with status 400 (validation), 404 (unknown id), and 404 for create-with-unknown-parent (FK miss). Success responses are the entity JSON (camelCase where applicable).

### Projects

```
GET    /api/projects            -> Project[] with task counts (todo/in_progress/done/total)
POST   /api/projects            { name: string, description?: string } -> Project
GET    /api/projects/:id        -> Project (with task counts)
PATCH  /api/projects/:id        { name?, description? } -> Project
DELETE /api/projects/:id        -> 204 (deletes tasks via cascade, emits project.deleted)
```

### Tasks

```
GET    /api/tasks               query: project_id?, status?, agent_id? -> Task[]
POST   /api/tasks               { project_id, title, description?, status?, agent_id? } -> Task
                               (status optional, defaults to 'todo'; invalid status -> 400)
GET    /api/tasks/:id           -> Task
PATCH  /api/tasks/:id           { title?, description?, status?, agent_id? } -> Task (partial update / claim / move)
DELETE /api/tasks/:id           -> 204
```

Validation: `title` non-empty when provided; `status` must be one of the three fixed values; unknown filter values return empty lists (not errors) except invalid `status` value in a PATCH, which is 400.

### Events (SSE)

```
GET /api/events
```

- `text/event-stream`; each mutation writes an `events` row and broadcasts to connected clients.
- Event data: `{ id: number, type: string, payload: <entity JSON>, createdAt: string }`.
- SSE `id:` field = `events.id`, enabling `Last-Event-ID` replay on reconnect (replays everything after the last seen id, capped at ~1000).
- Heartbeat comment every 15s to keep connections alive.
- Frontend strategy: on any event, refetch the current view (simple and robust; no client-side patching).

## MCP server

`@modelcontextprotocol/sdk`, stdio transport, 8 tools. Each tool calls the REST API and returns compact JSON. Tool errors surface REST error bodies.

| Tool | Input | Behavior |
|---|---|---|
| `list_projects` | — | projects with task counts |
| `create_project` | `name, description?` | create |
| `update_project` | `id, name?, description?` | partial update |
| `delete_project` | `id` | delete + cascade |
| `list_tasks` | `project_id?, status?, agent_id?` | filtered list |
| `create_task` | `project_id, title, description?, status?` | create (`todo` default) |
| `update_task` | `id, title?, description?, status?, agent_id?` | partial update / claim / move |
| `delete_task` | `id` | delete |

## Frontend

Single SvelteKit page (client-rendered on top of prerendered shell):

- Project selector in header; create/delete project.
- Board with 3 columns: todo / in_progress / done. Task cards show title, `agent_id` chip, relative updated time.
- Create task via inline form in a column; edit via card menu (edit title/description/agent, change status via dropdown or arrow buttons, delete).
- Realtime via `EventSource('/api/events')` + refetch on event; browser auto-reconnects, server replays missed events.
- Styling: minimal custom CSS; no component library.

## Agent skills & usage docs

The repo ships a canonical skill that teaches any agent how to connect to and work through the kanban, distributed in each host's native skill format.

**Single source of truth:** `skills/agent-kanban/SKILL.md` (SKILL.md format: YAML frontmatter with `name` + `description`, then markdown body). Distributed copies live at:

- `.claude/skills/agent-kanban/SKILL.md` — Claude Code
- `.opencode/skills/agent-kanban/SKILL.md` — opencode
- `skills/hermes/agent-kanban/SKILL.md` — hermes (same format; copied into the hermes skills dir per its config)

Copies are kept in sync by `backend/scripts/sync-skills.sh` (cp from canonical); a bun test asserts the copies are byte-identical to the canonical file to catch drift.

**Skill content (full conventions):**

1. *Connection* — health check (`GET /api/projects`), env `BACKEND_URL`; prefer MCP tools; REST fallback table with `curl` examples for all 8 operations + SSE note.
2. *MCP setup snippets* — per host: Claude Code (`.mcp.json` / `claude mcp add`), opencode (`mcp` block in opencode.json, local stdio type), hermes (stdio MCP JSON snippet). Formats verified against current host docs during implementation.
3. *Workflow rules* —
   - Claim before work: `update_task(id, { agent_id: <your-id>, status: 'in_progress' })`; agent id convention `<host>-<role>` e.g. `opencode-main`, `hermes-worker-1`.
   - Keep status truthful while working; `done` only when acceptance criteria in the description are met.
   - Blocked: append a note to `description` (timestamped), leave status as-is or hand back by clearing `agent_id`.
4. *Task conventions* — one task = one PR-sized unit; imperative title; description carries context + acceptance criteria so another agent can pick it up cold; agents create tasks for discovered work instead of silently fixing.
5. *Commit etiquette* — reference the task id in the commit message body (`Kanban-Task: <id>`); mark the task `done` only after the commit lands.
6. *Error handling* — 404 → re-list before retrying (task may be deleted); never blind-retry mutations.

**Discovery:** root `AGENTS.md` points every agent working in this repo at the skill; README has a human-facing "Using agents with the board" section linking the same doc.



```
agent-kanban/
  backend/
    src/
      index.ts        # server entry: REST + SSE + static serving
      mcp.ts          # MCP stdio entry
      db.ts           # sqlite setup, migrations
      store.ts        # data access functions
      routes.ts       # REST handlers
      events.ts       # event bus + SSE registry
    scripts/
      sync-skills.sh  # copy canonical skill to the 3 host locations
    test/
    package.json
  web/
    src/routes/...
    package.json      # sveltekit, adapter-static
  skills/
    agent-kanban/SKILL.md      # canonical skill (single source of truth)
    hermes/agent-kanban/SKILL.md
  .claude/skills/agent-kanban/SKILL.md
  .opencode/skills/agent-kanban/SKILL.md
  AGENTS.md           # points agents at the kanban skill
  README.md
  docs/superpowers/specs/
  package.json        # root: workspaces, scripts (dev, build, test)
  opencode.json       # existing config (unchanged)
```

Root scripts: `dev` (backend + web concurrently), `build`, `start` (production backend serving built UI), `test`.

## Error handling

- Backend: validate at route boundary; one shared error-JSON helper; unexpected errors → 500 `{ error }` (no stack traces in responses).
- MCP: REST failures become tool errors with the upstream message.
- Frontend: fetch failures show a toast/banner; SSE drop shows a "reconnecting" indicator until EventSource reopens.

## Testing

- **Store unit tests** (bun test, in-memory SQLite): CRUD, filters, cascade delete, validation at store level.
- **HTTP integration tests** (bun test): spin up the server on a random port, drive CRUD flows with `fetch`; assert status codes, payloads, 400/404 paths, and that mutations emit SSE events (capture via a test client).
- **MCP tests**: mock `fetch`; assert each tool hits the right endpoint with the right body and maps errors; one smoke integration test against the real server.
- **Skill sync test**: assert the three distributed SKILL.md copies are byte-identical to `skills/agent-kanban/SKILL.md`.
- **Verification**: `bun test` (all packages), biome lint + typecheck, `bun run build` for web, manual SSE check in dev.

## Future (out of scope)

- Task ordering within columns (drag reordering).
- Priority, labels, due dates.
- Auth / LAN exposure.
- Remote (HTTP) MCP transport.
