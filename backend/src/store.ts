import { nanoid } from 'nanoid';
import type { Db } from './db.ts';

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
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskAudit = {
  id: number;
  taskId: string;
  fromStatus: Status | null;
  toStatus: Status;
  agentId: string | null;
  changedAt: string;
  note: string | null;
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
  locked_at: string | null;
  created_at: string;
  updated_at: string;
};

type AuditRow = {
  id: number;
  task_id: string;
  from_status: Status | null;
  to_status: Status;
  agent_id: string | null;
  changed_at: string;
  note: string | null;
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
    lockedAt: r.locked_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toAudit(r: AuditRow): TaskAudit {
  return {
    id: r.id,
    taskId: r.task_id,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    agentId: r.agent_id,
    changedAt: r.changed_at,
    note: r.note,
  };
}

async function addAudit(db: Db, taskId: string, fromStatus: Status | null, toStatus: Status, agentId: string | null, note?: string | null): Promise<void> {
  const t = now();
  await db.run('INSERT INTO task_audits (task_id, from_status, to_status, agent_id, changed_at, note) VALUES (?, ?, ?, ?, ?, ?)', [
    taskId,
    fromStatus,
    toStatus,
    agentId,
    t,
    note ?? null,
  ]);
}

// Projects

export async function createProject(db: Db, input: { name: string; description?: string | null }): Promise<Project> {
  const t = now();
  const id = nanoid(12);
  await db.run('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    input.name,
    input.description ?? null,
    t,
    t,
  ]);
  return { id, name: input.name, description: input.description ?? null, createdAt: t, updatedAt: t };
}

export async function getProject(db: Db, id: string): Promise<Project | undefined> {
  const row = await db.queryOne<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id]);
  return row ? toProject(row) : undefined;
}

export async function getTaskCounts(db: Db, projectId: string): Promise<TaskCounts> {
  const rows = await db.query<{ status: Status; n: number }>('SELECT status, COUNT(*) AS n FROM tasks WHERE project_id = ? GROUP BY status', [projectId]);
  const counts: TaskCounts = { todo: 0, in_progress: 0, done: 0, total: 0 };
  for (const r of rows) {
    counts[r.status] = Number(r.n);
    counts.total += Number(r.n);
  }
  return counts;
}

export async function listProjects(db: Db): Promise<ProjectWithCounts[]> {
  const rows = await db.query<ProjectRow>('SELECT * FROM projects ORDER BY created_at ASC');
  const result: ProjectWithCounts[] = [];
  for (const r of rows) {
    result.push({ ...toProject(r), taskCounts: await getTaskCounts(db, r.id) });
  }
  return result;
}

export async function updateProject(
  db: Db,
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<Project | undefined> {
  const existing = await getProject(db, id);
  if (!existing) return undefined;
  const name = patch.name ?? existing.name;
  const description = patch.description !== undefined ? patch.description : existing.description;
  const t = now();
  await db.run('UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?', [name, description, t, id]);
  return { ...existing, name, description, updatedAt: t };
}

export async function deleteProject(db: Db, id: string): Promise<boolean> {
  const res = await db.run('DELETE FROM projects WHERE id = ?', [id]);
  return res.changes > 0;
}

// Tasks

export async function createTask(
  db: Db,
  input: { projectId: string; title: string; description?: string | null; status?: Status; agentId?: string | null },
): Promise<Task | undefined> {
  const project = await getProject(db, input.projectId);
  if (!project) return undefined;
  const t = now();
  const id = nanoid(12);
  const status: Status = input.status ?? 'todo';
  const lockedAt = input.agentId ? t : null;
  await db.run(
    'INSERT INTO tasks (id, project_id, title, description, status, agent_id, locked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.projectId, input.title, input.description ?? null, status, input.agentId ?? null, lockedAt, t, t],
  );
  const task: Task = {
    id,
    projectId: input.projectId,
    title: input.title,
    description: input.description ?? null,
    status,
    agentId: input.agentId ?? null,
    lockedAt,
    createdAt: t,
    updatedAt: t,
  };
  await addAudit(db, id, null, status, task.agentId);
  return task;
}

export async function getTask(db: Db, id: string): Promise<Task | undefined> {
  const row = await db.queryOne<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
  return row ? toTask(row) : undefined;
}

export async function listTasks(
  db: Db,
  filters: { projectId?: string; status?: string; agentId?: string },
): Promise<Task[]> {
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
  const rows = await db.query<TaskRow>(sql, params);
  return rows.map(toTask);
}

export class ConflictError extends Error {
  code = 'CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export async function updateTask(
  db: Db,
  id: string,
  patch: { title?: string; description?: string | null; status?: Status; agentId?: string | null },
): Promise<Task | undefined> {
  const existing = await getTask(db, id);
  if (!existing) return undefined;

  // Locking: if trying to claim (set agent_id to non-null) and task already locked by another agent, conflict
  if (patch.agentId !== undefined && patch.agentId !== null) {
    if (existing.agentId !== null && existing.agentId !== patch.agentId) {
      throw new ConflictError(`task already locked by ${existing.agentId}`);
    }
  }

  const title = patch.title ?? existing.title;
  const description = patch.description !== undefined ? patch.description : existing.description;
  const status = patch.status ?? existing.status;
  const agentId = patch.agentId !== undefined ? patch.agentId : existing.agentId;

  // Determine locked_at
  let lockedAt: string | null = existing.lockedAt;
  if (patch.agentId !== undefined) {
    if (patch.agentId === null) lockedAt = null;
    else if (patch.agentId !== existing.agentId) lockedAt = now();
    // if same agent, keep existing lockedAt
  }

  const t = now();

  // Atomic update for locking case: if claiming, use conditional WHERE to prevent race
  if (patch.agentId !== undefined && patch.agentId !== null && existing.agentId === null) {
    // Claim: only succeed if still unlocked
    const res = await db.run(
      'UPDATE tasks SET title = ?, description = ?, status = ?, agent_id = ?, locked_at = ?, updated_at = ? WHERE id = ? AND agent_id IS NULL',
      [title, description, status, agentId, lockedAt, t, id],
    );
    if (res.changes === 0) {
      // Someone else claimed in the meantime — re-read to give accurate error
      const current = await getTask(db, id);
      throw new ConflictError(`task already locked by ${current?.agentId ?? 'another agent'}`);
    }
  } else if (patch.agentId !== undefined && patch.agentId !== null && existing.agentId !== null && patch.agentId !== existing.agentId) {
    // Already handled above, but keep for safety (should have thrown)
    throw new ConflictError(`task already locked by ${existing.agentId}`);
  } else {
    await db.run('UPDATE tasks SET title = ?, description = ?, status = ?, agent_id = ?, locked_at = ?, updated_at = ? WHERE id = ?', [
      title,
      description,
      status,
      agentId,
      lockedAt,
      t,
      id,
    ]);
  }

  // Audit: if status changed, record
  if (status !== existing.status) {
    await addAudit(db, id, existing.status, status, agentId);
  }

  return { ...existing, title, description, status, agentId, lockedAt, updatedAt: t };
}

export async function deleteTask(db: Db, id: string): Promise<boolean> {
  const res = await db.run('DELETE FROM tasks WHERE id = ?', [id]);
  return res.changes > 0;
}

export async function getTaskHistory(db: Db, taskId: string): Promise<TaskAudit[]> {
  const rows = await db.query<AuditRow>('SELECT * FROM task_audits WHERE task_id = ? ORDER BY changed_at ASC, id ASC', [taskId]);
  return rows.map(toAudit);
}

export async function listAudits(db: Db, filters: { taskId?: string; projectId?: string }): Promise<TaskAudit[]> {
  if (filters.projectId && !filters.taskId) {
    // Join to filter by project
    const rows = await db.query<AuditRow>(
      'SELECT a.* FROM task_audits a JOIN tasks t ON a.task_id = t.id WHERE t.project_id = ? ORDER BY a.changed_at ASC, a.id ASC',
      [filters.projectId],
    );
    return rows.map(toAudit);
  }
  if (filters.taskId) {
    return getTaskHistory(db, filters.taskId);
  }
  const rows = await db.query<AuditRow>('SELECT * FROM task_audits ORDER BY changed_at ASC, id ASC LIMIT 500');
  return rows.map(toAudit);
}
