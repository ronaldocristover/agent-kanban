import { describe, it, expect } from 'bun:test';
import { openDb } from '../src/db.ts';
import { EventBus } from '../src/events.ts';
import { createApp } from '../src/app.ts';

async function makeApp() {
  const db = await openDb(':memory:');
  const bus = new EventBus(db);
  const app = createApp({ db, bus });
  const fetch = (req: Request) => app.handle(req);
  return { db, bus, fetch, app };
}

async function json(req: Request, appFetch: (r: Request) => Promise<Response>) {
  const res = await appFetch(req);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return { res, body };
}

describe('api', () => {
  it('projects CRUD + validation', async () => {
    const { fetch: appFetch, db } = await makeApp();
    // POST without name -> 400
    let r = await json(new Request('http://test/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }), appFetch);
    expect(r.res.status).toBe(400);

    // create
    r = await json(new Request('http://test/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P1' }) }), appFetch);
    expect(r.res.status).toBe(201);
    const id = r.body.id as string;

    // get
    r = await json(new Request(`http://test/api/projects/${id}`), appFetch);
    expect(r.res.status).toBe(200);
    expect(r.body.taskCounts).toBeDefined();

    // patch
    r = await json(new Request(`http://test/api/projects/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P2' }) }), appFetch);
    expect(r.res.status).toBe(200);
    expect(r.body.name).toBe('P2');

    // delete + 404 after
    let res = await appFetch(new Request(`http://test/api/projects/${id}`, { method: 'DELETE' }));
    expect(res.status).toBe(204);
    r = await json(new Request(`http://test/api/projects/${id}`), appFetch);
    expect(r.res.status).toBe(404);
    await db.close();
  });

  it('tasks CRUD, filters, and validation', async () => {
    const { fetch: appFetch, db } = await makeApp();
    const pr = await json(new Request('http://test/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Proj' }) }), appFetch);
    const pid = pr.body.id as string;

    // create task with unknown project -> 404
    let r = await json(new Request('http://test/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project_id: 'nope', title: 'x' }) }), appFetch);
    expect(r.res.status).toBe(404);

    // create two tasks (first unlocked, second done)
    r = await json(new Request('http://test/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project_id: pid, title: 't1' }) }), appFetch);
    expect(r.res.status).toBe(201);
    const tid = r.body.id as string;
    expect(r.body.status).toBe('todo');
    expect(r.body.lockedAt).toBeNull();

    await json(new Request('http://test/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project_id: pid, title: 't2', status: 'done' }) }), appFetch);

    // list filtered
    r = await json(new Request(`http://test/api/tasks?project_id=${pid}&status=done`), appFetch);
    expect(r.body.length).toBe(1);

    r = await json(new Request(`http://test/api/tasks?status=todo`), appFetch);
    expect(r.body.length).toBe(1);

    // unknown filter -> empty list, not error
    r = await json(new Request(`http://test/api/tasks?status=bad`), appFetch);
    expect(r.body.length).toBe(0);

    // PATCH invalid status -> 400
    r = await json(new Request(`http://test/api/tasks/${tid}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'bad' }) }), appFetch);
    expect(r.res.status).toBe(400);

    // PATCH project_id change -> 400
    r = await json(new Request(`http://test/api/tasks/${tid}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project_id: pid }) }), appFetch);
    expect(r.res.status).toBe(400);

    // claim + move
    r = await json(new Request(`http://test/api/tasks/${tid}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'in_progress', agent_id: 'bob' }) }), appFetch);
    expect(r.res.status).toBe(200);
    expect(r.body.status).toBe('in_progress');
    expect(r.body.agentId).toBe('bob');
    await db.close();
  });

  it('events emitted for SSE replay', async () => {
    const { bus, db } = await makeApp();
    await bus.emit('project.created', { id: 'x' });
    const replayed = await bus.replayAfter(0);
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed[0].type).toBe('project.created');
    // subscribe
    let seen: unknown = null;
    const unsub = bus.subscribe((e) => (seen = e.type));
    await bus.emit('task.created', { id: 't' });
    expect(seen).toBe('task.created');
    unsub();
    await db.close();
  });
});
