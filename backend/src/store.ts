import type { Database } from 'bun:sqlite';
import { nanoid } from 'nanoid';

export type Status = 'todo' | 'in_progress' | 'done';
export const STATUSES: readonly Status[] = ['todo', 'in_progress', 'done'] as const;

export type Project = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskCounts = { todo: number; in_progress: number; done: number; total: number };

export type ProjectWithCounts = Project & { taskCounts: TaskCounts };

export type Task = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: Status;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: Status;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
};

const now = () => new Date().toISOString();

function toProject(r: ProjectRow): Project {
  return { id: r.id, name: r.name, description: r.description, createdAt: r.created_at, updatedAt: r.updated_at };
}

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    description: r.description,
    status: r.status,
    agentId: r.agent_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Projects

export function createProject(db: Database, input: { name: string; description?: string | null }): Project {
  const t = now();
  const id = nanoid(12);
  db.run('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    input.name,
    input.description ?? null,
    t,
    t,
  ]);
  return { id, name: input.name, description: input.description ?? null, createdAt: t, updatedAt: t };
}

export function getProject(db: Database, id: string): Project | undefined {
  const row = db.query<ProjectRow, [string]>('SELECT * FROM projects WHERE id = ?').get(id);
  return row ? toProject(row) : undefined;
}

export function getTaskCounts(db: Database, projectId: string): TaskCounts {
  const rows = db
    .query<{ status: Status; n: number }, [string]>(
      'SELECT status, COUNT(*) AS n FROM tasks WHERE project_id = ? GROUP BY status',
    )
    .all(projectId);
  const counts: TaskCounts = { todo: 0, in_progress: 0, done: 0, total: 0 };
  for (const r of rows) {
    counts[r.status] = r.n;
    counts.total += r.n;
  }
  return counts;
}

export function listProjects(db: Database): ProjectWithCounts[] {
  const rows = db.query<ProjectRow, []>('SELECT * FROM projects ORDER BY created_at ASC').all();
  return rows.map((r) => ({ ...toProject(r), taskCounts: getTaskCounts(db, r.id) }));
}

export function updateProject(
  db: Database,
  id: string,
  patch: { name?: string; description?: string | null },
): Project | undefined {
  const existing = getProject(db, id);
  if (!existing) return undefined;
  const name = patch.name ?? existing.name;
  const description = patch.description !== undefined ? patch.description : existing.description;
  const t = now();
  db.run('UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?', [name, description, t, id]);
  return { ...existing, name, description, updatedAt: t };
}

export function deleteProject(db: Database, id: string): boolean {
  const res = db.run('DELETE FROM projects WHERE id = ?', [id]);
  return res.changes > 0;
}

// Tasks

export function createTask(
  db: Database,
  input: { projectId: string; title: string; description?: string | null; status?: Status; agentId?: string | null },
): Task | undefined {
  const project = getProject(db, input.projectId);
  if (!project) return undefined;
  const t = now();
  const id = nanoid(12);
  const status: Status = input.status ?? 'todo';
  db.run(
    'INSERT INTO tasks (id, project_id, title, description, status, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.projectId, input.title, input.description ?? null, status, input.agentId ?? null, t, t],
  );
  return {
    id,
    projectId: input.projectId,
    title: input.title,
    description: input.description ?? null,
    status,
    agentId: input.agentId ?? null,
    createdAt: t,
    updatedAt: t,
  };
}

export function getTask(db: Database, id: string): Task | undefined {
  const row = db.query<TaskRow, [string]>('SELECT * FROM tasks WHERE id = ?').get(id);
  return row ? toTask(row) : undefined;
}

export function listTasks(
  db: Database,
  filters: { projectId?: string; status?: string; agentId?: string },
): Task[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.projectId) {
    where.push('project_id = ?');
    params.push(filters.projectId);
  }
  if (filters.status) {
    where.push('status = ?');
    params.push(filters.status);
  }
  if (filters.agentId !== undefined) {
    where.push('agent_id = ?');
    params.push(filters.agentId);
  }
  const sql = `SELECT * FROM tasks${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at ASC`;
  // bun:sqlite typing: spread params
  const rows = (db.query<TaskRow, any>(sql) as any).all(...params);
  return (rows as TaskRow[]).map(toTask);
}

export function updateTask(
  db: Database,
  id: string,
  patch: { title?: string; description?: string | null; status?: Status; agentId?: string | null },
): Task | undefined {
  const existing = getTask(db, id);
  if (!existing) return undefined;
  const title = patch.title ?? existing.title;
  const description = patch.description !== undefined ? patch.description : existing.description;
  const status = patch.status ?? existing.status;
  const agentId = patch.agentId !== undefined ? patch.agentId : existing.agentId;
  const t = now();
  db.run('UPDATE tasks SET title = ?, description = ?, status = ?, agent_id = ?, updated_at = ? WHERE id = ?', [
    title,
    description,
    status,
    agentId,
    t,
    id,
  ]);
  return { ...existing, title, description, status, agentId, updatedAt: t };
}

export function deleteTask(db: Database, id: string): boolean {
  const res = db.run('DELETE FROM tasks WHERE id = ?', [id]);
  return res.changes > 0;
}
