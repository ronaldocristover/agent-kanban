---
name: agent-kanban
description: Use the agent-kanban board to track, claim, and move tasks. Connect via MCP tools or REST, follow claim → in_progress → done workflow, and reference task ids in commits.
---

# Agent Kanban Skill

This skill teaches an AI agent how to work with the **agent-kanban** board — a lightweight kanban for AI agents (opencode, hermes, claude code). The board has projects, tasks in three columns (`todo` → `in_progress` → `done`), and an `agent_id` field for claiming.

## 1. Connection

### Health check

```bash
curl -sf http://127.0.0.1:3000/api/projects | python3 -m json.tool
```

If the backend is not running, start it: `bun --cwd backend run dev` (or `bun run start` for the built web UI). Override with env `PORT`, `HOST`, `KANBAN_DB`, `BACKEND_URL` (MCP).

### Preferred: MCP tools (8 tools)

Configure the MCP server (stdio) in your host, then use tools instead of raw HTTP.

| Tool | Params |
|---|---|
| `list_projects` | — |
| `create_project` | `name, description?` |
| `update_project` | `id, name?, description?` |
| `delete_project` | `id` |
| `list_tasks` | `project_id?, status?, agent_id?` |
| `create_task` | `project_id, title, description?, status?` |
| `update_task` | `id, title?, description?, status?, agent_id?` |
| `delete_task` | `id` |

MCP env: `BACKEND_URL` (default `http://127.0.0.1:3000`).

### Fallback: REST (curl)

Base `http://127.0.0.1:3000`. All bodies JSON, all responses JSON; errors `{ error }`.

```bash
# Projects
curl -s http://127.0.0.1:3000/api/projects
curl -s -X POST http://127.0.0.1:3000/api/projects -H 'content-type: application/json' -d '{"name":"My project"}'
curl -s -X PATCH http://127.0.0.1:3000/api/projects/<id> -H 'content-type: application/json' -d '{"name":"New name"}'
curl -s -X DELETE http://127.0.0.1:3000/api/projects/<id> -i | head -5  # 204

# Tasks
curl -s "http://127.0.0.1:3000/api/tasks?project_id=<id>&status=todo"
curl -s -X POST http://127.0.0.1:3000/api/tasks -H 'content-type: application/json' -d '{"project_id":"<pid>","title":"Do thing"}'
curl -s -X PATCH http://127.0.0.1:3000/api/tasks/<id> -H 'content-type: application/json' -d '{"status":"in_progress","agent_id":"opencode-main"}'
curl -s -X DELETE http://127.0.0.1:3000/api/tasks/<id> -i | head -5  # 204

# Realtime (SSE) — optional for monitoring, not needed for mutations
curl -N -H 'Accept: text/event-stream' http://127.0.0.1:3000/api/events
# reconnect with: curl -H 'Last-Event-ID: <last id>' ...
```

Response shapes are camelCase: `Project { id, name, description, createdAt, updatedAt, taskCounts }`, `Task { id, projectId, title, description, status, agentId, createdAt, updatedAt }`. Request bodies use snake_case keys (`project_id`, `agent_id`).

## 2. MCP setup per host

### Claude Code

`.mcp.json` at the repo root (committed) already contains:

```json
{
  "mcpServers": {
    "agent-kanban": {
      "command": "bun",
      "args": ["--cwd", "backend", "run", "mcp"],
      "env": { "BACKEND_URL": "http://127.0.0.1:3000" }
    }
  }
}
```

Or add via CLI: `claude mcp add agent-kanban -- bun --cwd backend run mcp`.

### opencode

`opencode.json` `mcp` block (local file, gitignored — copy the snippet):

```json
{
  "mcp": {
    "agent-kanban": {
      "type": "local",
      "command": ["bun", "--cwd", "backend", "run", "mcp"],
      "enabled": true,
      "environment": { "BACKEND_URL": "http://127.0.0.1:3000" }
    }
  }
}
```

See https://opencode.ai/docs/mcp for the `local` type.

### Hermes

Hermes reads SKILL.md-style skills from its skills dir. Copy `skills/hermes/agent-kanban/SKILL.md` into your hermes skills directory (per your hermes config). MCP stdio JSON:

```json
{
  "mcpServers": {
    "agent-kanban": {
      "command": "bun",
      "args": ["--cwd", "/absolute/path/to/agent-kanban/backend", "run", "mcp"],
      "env": { "BACKEND_URL": "http://127.0.0.1:3000" }
    }
  }
}
```

## 3. Workflow rules

1. **Claim before work.** Pick an unclaimed `todo` task (`agentId === null`) and claim it in one call:
   ```
   update_task(id, { agent_id: "<host>-<role>", status: "in_progress" })
   ```
   Agent id convention: `<host>-<role>`, e.g. `opencode-main`, `claude-worker`, `hermes-worker-1`. Include your session/run id if you run parallel agents.

2. **Keep status truthful.** `in_progress` while you are working. Only move to `done` when the acceptance criteria in the task description are met and changes are committed.

3. **Blocked.** Append a timestamped note to `description` (e.g. `\n\n[2026-09-05 10:15 blocked] waiting on ...`), leave status as-is or hand back by setting `agent_id: null`.

4. **Complete.** Set `status: "done"` after the commit lands. Do not close tasks you did not finish.

## 4. Task conventions

- **One task = one PR-sized unit** that can be reviewed independently.
- **Imperative title**, e.g. "Add SSE replay to board".
- **Description = context + acceptance criteria** so another agent can pick it up cold. Include file paths, edge cases, and a Definition of Done.
- **Create tasks for discovered work** instead of fixing silently — the board is the source of truth.

## 5. Commit etiquette

Reference the task id in the commit body:

```
feat: add SSE Last-Event-ID replay

Kanban-Task: <task-id>
```

Mark the task `done` only after the commit succeeds.

## 6. Error handling

- `404` → the task/project was deleted or moved. Re-list (`list_tasks` / `list_projects`) before retrying. Do not blind-retry mutations.
- `400` → fix the payload (empty title, bad status, `project_id` change on PATCH is rejected).
- Network error → retry once after re-listing.

## 7. Example session

```bash
# list projects, pick one
# list todo tasks in that project
# claim one
curl -s -X PATCH http://127.0.0.1:3000/api/tasks/TID -H 'content-type: application/json' -d '{"agent_id":"opencode-main","status":"in_progress"}'
# ... do work, commit ...
# mark done
curl -s -X PATCH http://127.0.0.1:3000/api/tasks/TID -H 'content-type: application/json' -d '{"status":"done"}'
```
