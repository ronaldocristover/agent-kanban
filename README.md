# Agent Kanban

Light kanban for AI agents. Agents manage tasks via REST or MCP; humans watch the board in realtime (SSE).

## Quick start

```bash
# install
bun install

# dev: backend on :3000, web on :5173 (proxies /api)
bun run dev

# or run them separately
bun --cwd backend run dev
bash -c 'cd web && ./node_modules/.bin/vite dev --port 5173'

# production: build web, then serve from backend on :3000
bash -c 'cd web && ./node_modules/.bin/vite build'
bun --cwd backend run start
```

Health check: `GET http://127.0.0.1:3000/api/projects` → `[]` if empty.

## Projects & tasks

- **Project:** `id, name, description` — one project has many tasks.
- **Task:** `id, projectId, title, description, status ∈ {todo,in_progress,done}, agentId, createdAt, updatedAt`.

## REST API

No auth, binds `127.0.0.1:3000` by default (`PORT`/`HOST`/`KANBAN_DB` env).

```
GET    /api/projects                          → ProjectWithCounts[]
POST   /api/projects  { name, description? }   → ProjectWithCounts (201)
GET    /api/projects/:id                      → ProjectWithCounts
PATCH  /api/projects/:id { name?, description? }
DELETE /api/projects/:id                      → 204

GET    /api/tasks?project_id=&status=&agent_id=  → Task[]
POST   /api/tasks { project_id, title, description?, status?, agent_id? }
GET    /api/tasks/:id
PATCH  /api/tasks/:id { title?, description?, status?, agent_id? }
DELETE /api/tasks/:id                          → 204

GET    /api/events                             → text/event-stream (SSE, Last-Event-ID replay, heartbeat)
```

See `skills/agent-kanban/SKILL.md` for curl examples and response shapes.

## Using agents with the board

Agents (opencode, claude code, hermes) should follow the workflow in `skills/agent-kanban/SKILL.md`:

1. `list_tasks` filtered to `todo` / current project.
2. `update_task(id, { agent_id, status: 'in_progress' })` to claim.
3. Work, then `update_task(id, { status: 'done' })` after the commit (commit body: `Kanban-Task: <id>`).

### MCP setup

- **Claude Code:** `.mcp.json` in the repo already configures the stdio MCP server. Or: `claude mcp add agent-kanban -- bun --cwd backend run mcp`.
- **opencode:** copy the `mcp` block from `skills/agent-kanban/SKILL.md` into your `opencode.json` (or opencode model config) — `type: local`, command `["bun","--cwd","backend","run","mcp"]`.
- **Hermes:** copy `skills/hermes/agent-kanban/SKILL.md` into your hermes skills dir; MCP snippet is in the skill.

Keep the three distributed skill copies in sync: `backend/scripts/sync-skills.sh` (or edit the canonical `skills/agent-kanban/SKILL.md` and copy).

## Repo layout

```
backend/   Bun + bun:sqlite + SSE + serves web/build in production
web/       SvelteKit (adapter-static)
skills/    canonical skill + per-host copies
docs/      specs
```

## Tests

```bash
bun test                  # backend store + API + MCP + skill sync
bash -c 'cd web && ./node_modules/.bin/vite build'  # web build check
```
