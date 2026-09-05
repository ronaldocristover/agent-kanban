#!/usr/bin/env bash
set -euo pipefail

# Copy canonical agent-kanban skill to a Hermes agent skills directory.
# Usage:
#   backend/scripts/copy-to-hermes.sh                         # → $HOME/.hermes/skills/agent-kanban/SKILL.md
#   backend/scripts/copy-to-hermes.sh /path/to/hermes/skills  # → <path>/agent-kanban/SKILL.md
#   HERMES_SKILLS_DIR=/custom/path backend/scripts/copy-to-hermes.sh
#   HERMES_DIR=/custom/hermes backend/scripts/copy-to-hermes.sh
#
# Resolves destination in order:
#   1) first CLI arg
#   2) $HERMES_SKILLS_DIR
#   3) $HERMES_DIR/skills
#   4) $HOME/.hermes/skills
#   5) $HOME/.config/hermes/skills (fallback if .hermes does not exist)

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/skills/agent-kanban/SKILL.md"

if [[ ! -f "$SRC" ]]; then
  echo "error: canonical skill not found at $SRC" >&2
  exit 1
fi

DEST_BASE=""
if [[ $# -ge 1 && -n "${1:-}" ]]; then
  DEST_BASE="$1"
elif [[ -n "${HERMES_SKILLS_DIR:-}" ]]; then
  DEST_BASE="$HERMES_SKILLS_DIR"
elif [[ -n "${HERMES_DIR:-}" ]]; then
  DEST_BASE="$HERMES_DIR/skills"
elif [[ -d "$HOME/.hermes" ]]; then
  DEST_BASE="$HOME/.hermes/skills"
else
  DEST_BASE="$HOME/.config/hermes/skills"
fi

# Normalize: if DEST_BASE ends with /agent-kanban or /SKILL.md, strip to skills root
if [[ "$DEST_BASE" == */SKILL.md ]]; then
  DEST_BASE="$(dirname "$(dirname "$DEST_BASE")")"
elif [[ "$DEST_BASE" == */agent-kanban ]]; then
  DEST_BASE="$(dirname "$DEST_BASE")"
fi

DEST_DIR="$DEST_BASE/agent-kanban"
DEST_FILE="$DEST_DIR/SKILL.md"

mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST_FILE"

# Verify byte-identical
if cmp -s "$SRC" "$DEST_FILE"; then
  echo "✓ copied $SRC → $DEST_FILE"
else
  echo "error: copy verification failed" >&2
  exit 1
fi

echo "Hermes skills dir: $DEST_BASE"
echo "Hint: set HERMES_SKILLS_DIR or pass dest as arg to override."
