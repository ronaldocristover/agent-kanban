import type { Database } from 'bun:sqlite';
import type { EventBus } from './events.ts';
import {
  createProject,
  deleteProject,
  getProject,
  getTaskCounts,
  listProjects,
  updateProject,
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
} from './store.ts';
import { validateProjectBody, validateTaskBody } from './validate.ts';

export type AppCtx = { db: Database; bus: EventBus };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function err(message: string, status: number): Response {
  return json({ error: message }, status);
}

async function parseBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function handleApi(req: Request, ctx: AppCtx): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // --- Projects ---

  if (path === '/api/projects' && method === 'GET') {
    return json(listProjects(ctx.db));
  }

  if (path === '/api/projects' && method === 'POST') {
    const body = await parseBody(req);
    if (body === null) return err('invalid JSON', 400);
    const v = validateProjectBody(body, false);
    if (!v.ok) return err(v.error, 400);
    const project = createProject(ctx.db, { name: v.value.name!, description: v.value.description });
    const withCounts = { ...project, taskCounts: { todo: 0, in_progress: 0, done: 0, total: 0 } as const };
    ctx.bus.emit('project.created', project);
    return json(withCounts, 201);
  }

  const projectIdMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (projectIdMatch) {
    const id = decodeURIComponent(projectIdMatch[1]);
    if (method === 'GET') {
      const p = getProject(ctx.db, id);
      if (!p) return err('project not found', 404);
      return json({ ...p, taskCounts: getTaskCounts(ctx.db, id) });
    }
    if (method === 'PATCH') {
      const body = await parseBody(req);
      if (body === null) return err('invalid JSON', 400);
      const v = validateProjectBody(body, true);
      if (!v.ok) return err(v.error, 400);
      const updated = updateProject(ctx.db, id, v.value);
      if (!updated) return err('project not found', 404);
      ctx.bus.emit('project.updated', { ...updated, taskCounts: getTaskCounts(ctx.db, id) });
      return json({ ...updated, taskCounts: getTaskCounts(ctx.db, id) });
    }
    if (method === 'DELETE') {
      const ok = deleteProject(ctx.db, id);
      if (!ok) return err('project not found', 404);
      ctx.bus.emit('project.deleted', { id });
      return new Response(null, { status: 204 });
    }
  }

  // --- Tasks ---

  if (path === '/api/tasks' && method === 'GET') {
    const projectId = url.searchParams.get('project_id') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;
    const agentId = url.searchParams.has('agent_id') ? (url.searchParams.get('agent_id') as string) : undefined;
    return json(listTasks(ctx.db, { projectId, status, agentId }));
  }

  if (path === '/api/tasks' && method === 'POST') {
    const body = await parseBody(req);
    if (body === null) return err('invalid JSON', 400);
    const v = validateTaskBody(body, false);
    if (!v.ok) return err(v.error, 400);
    const task = createTask(ctx.db, {
      projectId: v.value.project_id!,
      title: v.value.title!,
      description: v.value.description,
      status: v.value.status,
      agentId: v.value.agent_id,
    });
    if (!task) return err('project not found', 404);
    ctx.bus.emit('task.created', task);
    return json(task, 201);
  }

  const taskIdMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskIdMatch) {
    const id = decodeURIComponent(taskIdMatch[1]);
    if (method === 'GET') {
      const t = getTask(ctx.db, id);
      if (!t) return err('task not found', 404);
      return json(t);
    }
    if (method === 'PATCH') {
      const body = await parseBody(req);
      if (body === null) return err('invalid JSON', 400);
      const v = validateTaskBody(body, true);
      if (!v.ok) return err(v.error, 400);
      // PATCH must not require project_id; strip it if present (agents shouldn't reassign project)
      if ('project_id' in (body as Record<string, unknown>)) {
        return err('project_id cannot be changed', 400);
      }
      const patch: { title?: string; description?: string | null; status?: import('./store.ts').Status; agentId?: string | null } = {};
      if (v.value.title !== undefined) patch.title = v.value.title;
      if ('description' in v.value) patch.description = v.value.description ?? null;
      if (v.value.status !== undefined) patch.status = v.value.status;
      if ('agent_id' in v.value) patch.agentId = v.value.agent_id ?? null;
      if (Object.keys(patch).length === 0) return err('no fields to update', 400);
      const updated = updateTask(ctx.db, id, patch);
      if (!updated) return err('task not found', 404);
      ctx.bus.emit('task.updated', updated);
      return json(updated);
    }
    if (method === 'DELETE') {
      const ok = deleteTask(ctx.db, id);
      if (!ok) return err('task not found', 404);
      const t = { id } as unknown;
      ctx.bus.emit('task.deleted', { id });
      return new Response(null, { status: 204 });
    }
  }

  return null;
}
