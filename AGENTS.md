# AGENTS.md — agent-kanban

This repo is the **agent-kanban** board itself. Agents working in this repo should use the kanban to track their own work.

- **Skill:** `skills/agent-kanban/SKILL.md` (canonical). Per-host copies: `.claude/skills/agent-kanban/SKILL.md`, `.opencode/skills/agent-kanban/SKILL.md`, `skills/hermes/agent-kanban/SKILL.md`.
- **Workflow:** claim a `todo` task (`agent_id` + `in_progress`) before starting, keep status truthful, mark `done` only after the commit lands. See the skill for commit etiquette (`Kanban-Task: <id>`).
- **Connection:** REST at `http://127.0.0.1:3000` (`GET /api/projects` health check) or MCP tools (`list_tasks`, `update_task`, etc.). Env `BACKEND_URL` overrides the MCP backend URL.

If the backend is not running, start it: `bun --cwd backend run dev` (dev) or `bun --cwd backend run start` (production, serves the built web UI).
