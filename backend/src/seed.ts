import { openDb, defaultDbPath } from './db.ts';
import { createProject, createTask, listProjects } from './store.ts';
import { EventBus } from './events.ts';

const DB_PATH = process.env.KANBAN_DB ?? defaultDbPath();
const RESET = process.argv.includes('--reset') || process.argv.includes('--force');

const db = await openDb(DB_PATH);
const dbLabel = (db.type === 'mysql' ? `mysql://${process.env.MYSQL_HOST ?? 'db'}:${process.env.MYSQL_PORT ?? 3306}/${process.env.MYSQL_DATABASE ?? 'kanban'}` : DB_PATH);
const bus = new EventBus(db);

const existing = await listProjects(db);
if (existing.length > 0 && !RESET) {
  console.log(`DB already has ${existing.length} project(s) at ${dbLabel}. Use --reset to reseed.`);
  console.log(existing.map((p) => ` - ${p.name} (${p.id}) ${p.taskCounts.total} tasks`).join('\n'));
  process.exit(0);
}

if (RESET && existing.length > 0) {
  console.log(`Resetting DB at ${dbLabel} (${existing.length} projects)...`);
  await db.exec('DELETE FROM tasks');
  await db.exec('DELETE FROM projects');
  await db.exec('DELETE FROM events');
} else if (RESET) {
  // also wipe even if empty to be clean
  await db.exec('DELETE FROM tasks');
  await db.exec('DELETE FROM projects');
  await db.exec('DELETE FROM events');
}

type SeedTask = { title: string; description?: string; status?: 'todo' | 'in_progress' | 'done'; agentId?: string | null };

const seeds: { name: string; description: string; tasks: SeedTask[] }[] = [
  {
    name: 'Agent Kanban',
    description: 'Board itself — track implementation, docs, and integration work.',
    tasks: [
      { title: 'Implement REST CRUD for projects & tasks', description: 'Backend Bun + Elysia + MySQL. AC: all 10 endpoints + validation 400/404.\nKanban-Task: seed', status: 'done', agentId: 'opencode-main' },
      { title: 'Add SSE realtime to board', description: 'GET /api/events with Last-Event-ID replay + heartbeat. Frontend EventSource refetch.', status: 'done', agentId: 'opencode-main' },
      { title: 'Wire SvelteKit board with 3 columns', description: 'Columns todo/in_progress/done. Card actions: move, edit, delete. agent_id chip.', status: 'done', agentId: 'claude-code' },
      { title: 'Ship MCP stdio server (8 tools)', description: 'tools: list/create/update/delete for projects & tasks. BACKEND_URL env.', status: 'done', agentId: 'hermes-worker-1' },
      { title: 'Write agent skill + per-host copies', description: 'Canonical SKILL.md + .claude/.opencode/hermes. Keep in sync via sync-skills.sh.', status: 'in_progress', agentId: 'opencode-main' },
      { title: 'Add seed data & polish docs', description: 'Seed script, HOW_TO, CHANGES, Makefile, Docker. AC: make seed && curl lists seeded data.', status: 'todo' },
      { title: 'Add task ordering / drag & drop', description: 'Future: position column for ordering. Out of scope for 0.1.0.', status: 'todo' },
    ],
  },
  {
    name: 'Demo Board',
    description: 'Sample project for trying the board and API.',
    tasks: [
      { title: 'Design kanban columns', description: 'Decide on todo / in_progress / done vs custom columns.', status: 'done', agentId: 'human' },
      { title: 'Create first task via API', description: 'curl POST /api/tasks { project_id, title }. See docs/HOW_TO.md.', status: 'in_progress', agentId: 'hermes-worker-1' },
      { title: 'Claim a task as an agent', description: 'PATCH /api/tasks/:id { agent_id, status: "in_progress" }. Claim before coding.', status: 'todo' },
      { title: 'Move task to done after commit', description: 'Commit body: Kanban-Task: <id>. Then PATCH status=done.', status: 'todo' },
      { title: 'Test SSE with curl', description: 'curl -N http://127.0.0.1:3000/api/events and create a task in another terminal.', status: 'todo', agentId: null },
      { title: 'Try MCP tools from opencode', description: 'In opencode: list_projects → create_task → update_task. See skills/agent-kanban/SKILL.md.', status: 'todo', agentId: null },
    ],
  },
  {
    name: 'Backlog',
    description: 'Ideas and future work.',
    tasks: [
      { title: 'Auth for LAN exposure', description: 'Bearer token or basic auth when HOST=0.0.0.0. Out of scope for local use.', status: 'todo' },
      { title: 'Priority & labels', description: 'Fields: priority (low/med/high), labels: string[].', status: 'todo' },
      { title: 'Remote MCP over HTTP', description: 'Streamable HTTP transport in addition to stdio.', status: 'todo' },
    ],
  },
];

let projectsCreated = 0;
let tasksCreated = 0;

for (const s of seeds) {
  const project = await createProject(db, { name: s.name, description: s.description });
  await bus.emit('project.created', project);
  projectsCreated++;
  console.log(`+ project "${project.name}" ${project.id}`);
  for (const t of s.tasks) {
    const task = await createTask(db, {
      projectId: project.id,
      title: t.title,
      description: t.description,
      status: t.status,
      agentId: t.agentId,
    });
    if (task) {
      await bus.emit('task.created', task);
      tasksCreated++;
      console.log(`  - [${task.status}] ${task.title} ${task.agentId ? `(${task.agentId})` : ''}`);
    }
  }
}

console.log(`\nSeeded ${projectsCreated} projects, ${tasksCreated} tasks → ${dbLabel} (${db.type})`);
console.log('Verify: curl -s http://127.0.0.1:3000/api/projects | python3 -m json.tool');
await db.close();
