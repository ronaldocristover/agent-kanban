import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
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
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';

export type AppCtx = { db: Database; bus: EventBus };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
function err(message: string, status: number): Response {
  return json({ error: message }, status);
}

export function createApp(ctx: AppCtx, opts?: { staticDir?: string }) {
  const staticDir = opts?.staticDir ?? path.resolve(import.meta.dir, '../../web/build');

  const app = new Elysia()
    .use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['content-type', 'last-event-id'] }))
    .onError(({ error }) => {
      console.error(error);
      return json({ error: 'internal server error' }, 500);
    })

    // SSE
    .get('/api/events', ({ request }) => {
      const req = request as Request;
      const lastEventId = Number(req.headers.get('last-event-id') ?? 0);
      let unsubscribe: (() => void) | undefined;
      let interval: Timer | undefined;
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const send = (e: { id: number; type: string; payload: unknown; createdAt: string }) => {
            try {
              controller.enqueue(enc.encode(`id: ${e.id}\ndata: ${JSON.stringify({ id: e.id, type: e.type, payload: e.payload, createdAt: e.createdAt })}\n\n`));
            } catch {}
          };
          for (const e of ctx.bus.replayAfter(Number.isFinite(lastEventId) ? lastEventId : 0)) send(e);
          unsubscribe = ctx.bus.subscribe(send);
          interval = setInterval(() => {
            try { controller.enqueue(enc.encode(': heartbeat\n\n')); } catch {}
          }, 15000);
        },
        cancel() {
          if (unsubscribe) unsubscribe();
          if (interval) clearInterval(interval);
        },
      });
      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'access-control-allow-origin': '*',
        },
      });
    })

    // Projects
    .get('/api/projects', () => json(listProjects(ctx.db)))
    .post('/api/projects', async ({ request }) => {
      const body = await parseBody(request);
      if (body === null) return err('invalid JSON', 400);
      const v = validateProjectBody(body, false);
      if (!v.ok) return err(v.error, 400);
      const project = createProject(ctx.db, { name: v.value.name!, description: v.value.description });
      const withCounts = { ...project, taskCounts: { todo: 0, in_progress: 0, done: 0, total: 0 } as const };
      ctx.bus.emit('project.created', project);
      return json(withCounts, 201);
    })
    .get('/api/projects/:id', ({ params }) => {
      const id = decodeURIComponent(params.id);
      const p = getProject(ctx.db, id);
      if (!p) return err('project not found', 404);
      return json({ ...p, taskCounts: getTaskCounts(ctx.db, id) });
    })
    .patch('/api/projects/:id', async ({ params, request }) => {
      const id = decodeURIComponent(params.id);
      const body = await parseBody(request);
      if (body === null) return err('invalid JSON', 400);
      const v = validateProjectBody(body, true);
      if (!v.ok) return err(v.error, 400);
      const updated = updateProject(ctx.db, id, v.value);
      if (!updated) return err('project not found', 404);
      ctx.bus.emit('project.updated', { ...updated, taskCounts: getTaskCounts(ctx.db, id) });
      return json({ ...updated, taskCounts: getTaskCounts(ctx.db, id) });
    })
    .delete('/api/projects/:id', ({ params }) => {
      const id = decodeURIComponent(params.id);
      const ok = deleteProject(ctx.db, id);
      if (!ok) return err('project not found', 404);
      ctx.bus.emit('project.deleted', { id });
      return new Response(null, { status: 204 });
    })

    // Tasks
    .get('/api/tasks', ({ request }) => {
      const url = new URL(request.url);
      const projectId = url.searchParams.get('project_id') ?? undefined;
      const status = url.searchParams.get('status') ?? undefined;
      const agentId = url.searchParams.has('agent_id') ? (url.searchParams.get('agent_id') as string) : undefined;
      return json(listTasks(ctx.db, { projectId, status, agentId }));
    })
    .post('/api/tasks', async ({ request }) => {
      const body = await parseBody(request);
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
    })
    .get('/api/tasks/:id', ({ params }) => {
      const id = decodeURIComponent(params.id);
      const t = getTask(ctx.db, id);
      if (!t) return err('task not found', 404);
      return json(t);
    })
    .patch('/api/tasks/:id', async ({ params, request }) => {
      const id = decodeURIComponent(params.id);
      const body = await parseBody(request);
      if (body === null) return err('invalid JSON', 400);
      const v = validateTaskBody(body, true);
      if (!v.ok) return err(v.error, 400);
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
    })
    .delete('/api/tasks/:id', ({ params }) => {
      const id = decodeURIComponent(params.id);
      const ok = deleteTask(ctx.db, id);
      if (!ok) return err('task not found', 404);
      ctx.bus.emit('task.deleted', { id });
      return new Response(null, { status: 204 });
    })

    // Fallback for unknown /api routes
    .all('/api/*', () => err('not found', 404))

    // Static frontend (catch-all for GET, after API)
    .get('/*', ({ request }) => {
      if (!existsSync(staticDir)) return new Response('not found', { status: 404 });
      const url = new URL(request.url);
      // don't handle /api/* here (already handled above, but double guard)
      if (url.pathname.startsWith('/api/')) return new Response('not found', { status: 404 });
      let filePath = path.join(staticDir, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      if (!filePath.startsWith(staticDir)) return new Response('forbidden', { status: 403 });
      try {
        const stat = statSync(filePath);
        if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
      } catch {}
      try {
        statSync(filePath);
        return new Response(Bun.file(filePath));
      } catch {
        const fallback = path.join(staticDir, 'index.html');
        try {
          statSync(fallback);
          return new Response(Bun.file(fallback));
        } catch {
          return new Response('not found', { status: 404 });
        }
      }
    });

  return app;
}

async function parseBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return null; }
}
