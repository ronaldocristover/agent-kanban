import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('skills sync', () => {
  it('three distributed copies are byte-identical to canonical', () => {
    const root = path.resolve(import.meta.dir, '../..');
    const canonical = readFileSync(path.join(root, 'skills/agent-kanban/SKILL.md'), 'utf8');
    const copies = [
      path.join(root, '.claude/skills/agent-kanban/SKILL.md'),
      path.join(root, '.opencode/skills/agent-kanban/SKILL.md'),
      path.join(root, 'skills/hermes/agent-kanban/SKILL.md'),
    ];
    for (const p of copies) {
      const content = readFileSync(p, 'utf8');
      expect(content).toBe(canonical);
    }
  });
});
