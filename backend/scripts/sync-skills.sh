#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/skills/agent-kanban/SKILL.md"
cp "$SRC" "$ROOT/.claude/skills/agent-kanban/SKILL.md"
cp "$SRC" "$ROOT/.opencode/skills/agent-kanban/SKILL.md"
cp "$SRC" "$ROOT/skills/hermes/agent-kanban/SKILL.md"
echo "skills synced from $SRC"
