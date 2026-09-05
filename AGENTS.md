# AGENTS.md — agent-kanban

This repo **is** the agent-kanban board. Any agent (opencode, hermes, Claude Code) working in this repo must track its work on the board.

## Board

- **Where:** `http://127.0.0.1:3000` — `GET /api/projects` is the health check (→ `[]` if empty).
- **If it's down:** `bash -c 'cd backend && bun run dev'` (dev, API only) or `bash -c 'cd web && ./node_modules/.bin/vite build' && bash -c 'cd backend && bun run start'` (prod, serves `web/build` on `:3000`). See `README.md` and `docs/HOW_TO.md`.

## Skill (read this first)

- **Canonical:** `skills/agent-kanban/SKILL.md`
- **Claude Code:** `.claude/skills/agent-kanban/SKILL.md`
- **opencode:** `.opencode/skills/agent-kanban/SKILL.md`
- **Hermes:** `skills/hermes/agent-kanban/SKILL.md`

All three are byte-identical copies of the canonical file — `backend/scripts/sync-skills.sh` keeps them in sync (verified by `backend/test/skills-sync.test.ts`).

The skill covers: MCP vs REST, per-host setup, claim workflow, task conventions, commit etiquette (`Kanban-Task: <id>`), and error handling. **Do not guess** — follow the skill.

## Workflow (summary)

1. **Pick** a `todo` task (`GET /api/tasks?status=todo` or MCP `list_tasks`).
2. **Claim** it before coding: `PATCH /api/tasks/:id { "agent_id": "<host>-<role>", "status": "in_progress" }` (or MCP `update_task`).
3. **Work** — keep `status` truthful. If blocked, append a timestamped note to `description` and optionally clear `agent_id` to hand it back.
4. **Commit** with `Kanban-Task: <id>` in the body.
5. **Close** only after the commit lands: `PATCH /api/tasks/:id { "status": "done" }`.

## REST vs MCP

- **Preferred:** MCP tools (`list_tasks`, `update_task`, etc.) — configured via `.mcp.json` (Claude Code) or `opencode.json` `mcp` block (see `skills/agent-kanban/SKILL.md` §2). Env `BACKEND_URL` overrides the backend URL (default `http://127.0.0.1:3000`).
- **Fallback:** REST at `http://127.0.0.1:3000` — curl table is in `skills/agent-kanban/SKILL.md` §1 and `docs/HOW_TO.md`.

Request bodies use `snake_case` (`project_id`, `agent_id`); responses use `camelCase` (`projectId`, `agentId`).

## Task conventions

- One task = one reviewable unit. Title is imperative; description holds context + acceptance criteria so another agent can pick it up cold.
- Create tasks for discovered work instead of fixing silently.
- The board is the source of truth — don't keep tasks in `TODO.md` or issue comments.

## Before you push

- `make test` (or `bun test backend/test`) — store + API + MCP + skill-sync.
- `make typecheck` / `bash -c 'cd web && ./node_modules/.bin/vite build'` for the board.

## Reference

- Spec: `docs/superpowers/specs/2026-09-05-agent-kanban-design.md`
- How-to: `docs/HOW_TO.md` (curl cookbook, Docker, troubleshooting)
- Changes: `docs/CHANGES.md`
