# HOW TO — Agent Kanban

Practical cookbook for humans and agents. For the high-level overview, see `README.md`; for the agent skill, see `skills/agent-kanban/SKILL.md`.

## 1. Prerequisites

- **Bun ≥ 1.4**: `curl -fsSL https://bun.sh/install | bash && exec $SHELL`
- Check: `bun --version` → `1.4.x`, `bun --cwd backend run typecheck` → no output (pass).

No Docker, no Postgres, no env file. The DB lives at `data/kanban.db` (gitignored) and is created on first run.

## 2. Install

```bash
git clone <repo> agent-kanban && cd agent-kanban
bun install                 # root + backend + web workspaces
# or
make install
```

## 3. Run

### Dev (two processes)

```bash
make dev
# equivalent:
# bun --cwd backend run dev  (API + SSE on :3000)
# bash -c 'cd web && ./node_modules/.bin/vite dev --port 5173' (board, proxies /api → :3000)
```

Open `http://127.0.0.1:5173` (Vite) — or `http://127.0.0.1:3000` after a `make build` (Bun serves the built board).

### Production

```bash
make build   # vite build → web/build
make start   # Bun serves API + web/build on :3000
# equivalent:
bash -c 'cd web && ./node_modules/.bin/vite build' && bun --cwd backend run start
```

### Docker

```bash
docker compose up --build          # :3000 (HOST=0.0.0.0, KANBAN_DB=/app/data/kanban.db)
docker compose down
# single image:
docker build -t agent-kanban . && docker run -p 3000:3000 -v ./data:/app/data agent-kanban
```

### Health check

```bash
curl -sf http://127.0.0.1:3000/api/projects | python3 -m json.tool
# → [] if empty, or [{ id, name, ..., taskCounts: { todo, in_progress, done, total } }]
```

If `curl: 7 Failed to connect`, the backend is not running — see **Troubleshooting**.

### Environment

| Var | Default | When to change |
|---|---|---|
| `PORT` | `3000` | Another service uses 3000 |
| `HOST` | `127.0.0.1` | `0.0.0.0` for Docker / LAN |
| `KANBAN_DB` | `data/kanban.db` | `:memory:` for tests/ephemeral runs |
| `STATIC_DIR` | `web/build` | Custom built board path |
| `BACKEND_URL` | `http://127.0.0.1:3000` | MCP server → REST base (only for `bun --cwd backend run mcp`) |

Example: `PORT=4000 HOST=0.0.0.0 KANBAN_DB=/tmp/kanban.db bun --cwd backend run dev`

## 4. Use the board (human)

1. Create a project (top bar → name + optional description → **Create project**).
2. Pick it in the dropdown — counts `todo / in_progress / done` appear.
3. In any column, enter title (+ description) → **Add** (creates in that status; default `todo`).
4. On a card: **← Todo / → Progress / ✓ Done** moves it, **Edit** changes title/description/agent, **Delete** removes it.
5. Top-right `● live` means SSE is connected; `○ reconnecting` will auto-retry every ~1.5s and replay missed events via `Last-Event-ID`.

## 5. Use the API (human or agent fallback)

Base `http://127.0.0.1:3000`. No auth. Request bodies **snake_case**, responses **camelCase**. Errors `{ error }`.

### Projects

```bash
# list
curl -s http://127.0.0.1:3000/api/projects | python3 -m json.tool

# create
curl -s -X POST http://127.0.0.1:3000/api/projects \
  -H 'content-type: application/json' \
  -d '{"name":"My project","description":"optional"}' | python3 -m json.tool
# → { id, name, ..., taskCounts: { todo:0, ... } } 201

# get / update / delete
curl -s http://127.0.0.1:3000/api/projects/<id> | python3 -m json.tool
curl -s -X PATCH http://127.0.0.1:3000/api/projects/<id> \
  -H 'content-type: application/json' -d '{"name":"New name"}' | python3 -m json.tool
curl -s -X DELETE http://127.0.0.1:3000/api/projects/<id> -i | head -5  # 204, cascades tasks
```

### Tasks

```bash
# list (filters optional, unknown filter values → [] not error)
curl -s "http://127.0.0.1:3000/api/tasks?project_id=<pid>&status=todo&agent_id=opencode-main" | python3 -m json.tool

# create (status defaults to todo)
curl -s -X POST http://127.0.0.1:3000/api/tasks \
  -H 'content-type: application/json' \
  -d '{"project_id":"<pid>","title":"Do thing","description":"AC: ...","agent_id":"opencode-main"}' | python3 -m json.tool
# → { id, projectId, title, status:"todo", agentId, ... } 201
# 404 if project_id unknown; 400 if title empty or status not in todo/in_progress/done

# get / claim+move / delete
curl -s http://127.0.0.1:3000/api/tasks/<id> | python3 -m json.tool
curl -s -X PATCH http://127.0.0.1:3000/api/tasks/<id> \
  -H 'content-type: application/json' \
  -d '{"agent_id":"opencode-main","status":"in_progress"}' | python3 -m json.tool
# project_id cannot be changed (400); invalid status → 400
curl -s -X DELETE http://127.0.0.1:3000/api/tasks/<id> -i | head -5  # 204
```

### SSE

```bash
# stream
curl -N -H 'Accept: text/event-stream' http://127.0.0.1:3000/api/events
# → id: 3
#   data: {"id":3,"type":"task.created","payload":{...},"createdAt":"..."}

# reconnect with replay
curl -N -H 'Accept: text/event-stream' -H 'Last-Event-ID: 3' http://127.0.0.1:3000/api/events
# heartbeats: ": heartbeat" every 15s
```

The board does `new EventSource('/api/events')` and refetches `GET /api/projects` + `GET /api/tasks?project_id=...` on every event — simple and race-free.

## 6. Use MCP (agents — preferred)

Stdio server `backend/src/mcp.ts` wraps the REST API. See `skills/agent-kanban/SKILL.md §2` for copy-paste snippets.

### Claude Code

`.mcp.json` is already committed. Verify with `claude mcp list` or add explicitly:

```bash
claude mcp add agent-kanban -- bun --cwd backend run mcp
```

Tools: `list_projects`, `create_project`, `update_project`, `delete_project`, `list_tasks`, `create_task`, `update_task`, `delete_task`.

### opencode

`opencode.json` is gitignored (it contains your `bariska` key). Add the `mcp` block from `skills/agent-kanban/SKILL.md §2`:

```json
{ "mcp": { "agent-kanban": { "type": "local", "command": ["bun","--cwd","backend","run","mcp"], "enabled": true, "environment": { "BACKEND_URL": "http://127.0.0.1:3000" } } } }
```

Restart opencode; `list_tasks` etc. appear as tools.

### Hermes

Copy `skills/hermes/agent-kanban/SKILL.md` into your hermes skills dir (per your hermes config). MCP snippet in the skill uses an absolute path — replace `/absolute/path/to/agent-kanban`.

### Agent workflow (all hosts)

1. `list_tasks({ status: "todo" })` → pick one.
2. `update_task({ id, agent_id: "<host>-<role>", status: "in_progress" })` — claim before coding.
3. Work. Keep status truthful. If blocked, `update_task({ id, description: old + "\n\n[2026-09-05 blocked] ..." })` and optionally `agent_id: null` to hand back.
4. Commit with `Kanban-Task: <id>` in the body.
5. `update_task({ id, status: "done" })` only after the commit lands.

Task conventions and error handling → `skills/agent-kanban/SKILL.md` §4–§6.

## 7. Dev tasks

```bash
make test        # bun test backend/test (store/api/mcp/skills-sync) — 12 tests
make typecheck   # tsc --noEmit (backend)
make lint        # biome check .
bash -c 'cd web && ./node_modules/.bin/vite build'  # web build (previews adapter-static)
backend/scripts/sync-skills.sh  # re-copy canonical skill to 3 hosts after editing skills/agent-kanban/SKILL.md
```

CI-friendly: `bun test backend/test && bunx tsc --noEmit --project backend/tsconfig.json && bash -c 'cd web && ./node_modules/.bin/vite build'`.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `curl: 7 Failed to connect` | Backend not running — `bun --cwd backend run dev` or `make dev`. Check `PORT`/`HOST`. |
| `GET /api/projects` → `400` / `404` | Check request: POST project needs `{ name }`; POST task needs `{ project_id, title }`. 404 on task create = unknown `project_id`. |
| Board shows `○ reconnecting` forever | Backend down or CORS/SSE blocked. Try `curl -N http://127.0.0.1:3000/api/events` directly. |
| `vite build` → `No Svelte configuration found` | Run from `web/`: `bash -c 'cd web && ./node_modules/.bin/vite build'` (not from repo root). |
| `bun test` → `bun-types` errors | `bun install` from repo root; backend `tsconfig.json` includes `bun-types`. |
| Skill copies drift | `backend/scripts/sync-skills.sh`; `bun test backend/test` fails `skills-sync` if drifted. |
| DB is empty after restart | Check `KANBAN_DB` path and that `data/` is not deleted. Use `ls -la data/` and `sqlite3 data/kanban.db "select * from projects;"`. |
| Port already in use | `lsof -i :3000` / `kill`, or `PORT=3001 bun --cwd backend run dev`. |
| Docker board is blank | Ensure `web/build` was built before `docker compose up --build` (`make build`); or build inside Dockerfile (see `Dockerfile`). |

## 9. Reference

- Spec: `docs/superpowers/specs/2026-09-05-agent-kanban-design.md`
- Changes: `docs/CHANGES.md`
- Skill: `skills/agent-kanban/SKILL.md`
