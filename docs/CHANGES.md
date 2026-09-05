# CHANGES — agent-kanban

All notable changes. Format inspired by Keep a Changelog. Dates are UTC.

## [0.1.0] — 2026-09-05

Initial release. Implements `docs/superpowers/specs/2026-09-05-agent-kanban-design.md`.

### Added

- **Backend** (`backend/`, Bun + `bun:sqlite`):
  - REST — `GET/POST/PATCH/DELETE /api/projects` (with `taskCounts`), `GET/POST/PATCH/DELETE /api/tasks` (`project_id`/`status`/`agent_id` filters, `status` in `todo/in_progress/done`), `GET /api/events` SSE with `Last-Event-ID` replay and heartbeats. Validation at boundary (`backend/src/validate.ts`), snake_case requests / camelCase responses, `127.0.0.1:3000` by default.
  - Store — `backend/src/store.ts` (projects/tasks CRUD, `taskCounts`, cascade delete), `backend/src/db.ts` (WAL, FK, `data/kanban.db`), `backend/src/events.ts` (EventBus, prune last 1000).
  - Static — `backend/src/index.ts` serves `web/build` in production.
- **MCP** (`backend/src/mcp.ts`): stdio server via `@modelcontextprotocol/sdk` with 8 tools — `list_projects`, `create_project`, `update_project`, `delete_project`, `list_tasks`, `create_task`, `update_task`, `delete_task` — wrapping REST (`BACKEND_URL`).
- **Frontend** (`web/`, SvelteKit `adapter-static`, Svelte 5 runes): single board page (`web/src/routes/+page.svelte`), project selector, 3 columns, inline add, card move/edit/delete, `agent_id` chip, `EventSource` realtime with `subscribeEvents` (`web/src/lib/api.ts`), Vite proxy `/api → :3000` (`web/vite.config.ts`), `svelte.config.js`.
- **Skills** (`skills/agent-kanban/SKILL.md` canonical): connection (MCP-first + REST curl table), per-host setup (Claude Code `.mcp.json`, opencode `opencode.json` local, hermes), claim workflow (`agent_id` + `in_progress` → `done`), task/commit conventions (`Kanban-Task: <id>`), error handling. Copies `.claude/skills/agent-kanban/`, `.opencode/skills/agent-kanban/`, `skills/hermes/agent-kanban/` kept in sync by `backend/scripts/sync-skills.sh`.
- **Docs** (`AGENTS.md`, `README.md`, `docs/HOW_TO.md`, `docs/CHANGES.md`, `.mcp.json`), `Makefile` (`install/dev/build/start/test/typecheck/lint`), `Dockerfile` + `docker-compose.yml`.
- **Tests** (`backend/test/`): `store.test.ts`, `api.test.ts`, `mcp.test.ts`, `skills-sync.test.ts` — 12 tests, `bun test backend/test`.

### Notes

- No auth; binds localhost. Production via `make build && make start` or `docker compose up --build`.
- `opencode.json` remains gitignored (contains secrets); MCP snippet is documented in the skill.

## [Unreleased]

- Planned (out of scope for 0.1.0): task ordering/drag, priority/labels, auth, remote MCP transport.
