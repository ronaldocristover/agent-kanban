import { describe, it, expect } from 'bun:test';
import { openDb } from '../src/db.ts';
import { createProject, listProjects, getProject, updateProject, deleteProject, createTask, listTasks, getTask, updateTask, deleteTask, getTaskCounts } from '../src/store.ts';

async function freshDb() {
  return openDb(':memory:');
}

describe('store: projects', () => {
  it('creates and lists projects with counts', async () => {
    const db = await freshDb();
    const p = await createProject(db, { name: 'P1' });
    expect(p.name).toBe('P1');
    const all = await listProjects(db);
    expect(all.length).toBe(1);
    expect(all[0].taskCounts.total).toBe(0);
    await db.close();
  });

  it('updates project', async () => {
    const db = await freshDb();
    const p = await createProject(db, { name: 'A' });
    const u = await updateProject(db, p.id, { name: 'B', description: 'desc' });
    expect(u?.name).toBe('B');
    expect(u?.description).toBe('desc');
    expect((await getProject(db, p.id))?.name).toBe('B');
    await db.close();
  });

  it('deletes project and cascades tasks', async () => {
    const db = await freshDb();
    const p = await createProject(db, { name: 'X' });
    await createTask(db, { projectId: p.id, title: 't1' });
    expect((await listTasks(db, { projectId: p.id })).length).toBe(1);
    expect(await deleteProject(db, p.id)).toBe(true);
    expect((await listProjects(db)).length).toBe(0);
    expect((await listTasks(db, { projectId: p.id })).length).toBe(0);
    await db.close();
  });
});

describe('store: tasks', () => {
  it('creates task defaults to todo and filters', async () => {
    const db = await freshDb();
    const p = await createProject(db, { name: 'P' });
    const t1 = (await createTask(db, { projectId: p.id, title: 'a', agentId: 'agent-1' }))!;
    const t2 = (await createTask(db, { projectId: p.id, title: 'b', status: 'done' }))!;
    expect(t1.status).toBe('todo');
    expect(t2.status).toBe('done');
    expect((await listTasks(db, { status: 'todo' })).length).toBe(1);
    expect((await listTasks(db, { agentId: 'agent-1' })).length).toBe(1);
    expect((await getTaskCounts(db, p.id)).todo).toBe(1);
    expect((await getTaskCounts(db, p.id)).done).toBe(1);
    await db.close();
  });

  it('create with unknown project returns undefined', async () => {
    const db = await freshDb();
    expect(await createTask(db, { projectId: 'nope', title: 'x' })).toBeUndefined();
    await db.close();
  });

  it('updates and deletes task', async () => {
    const db = await freshDb();
    const p = await createProject(db, { name: 'P' });
    const t = (await createTask(db, { projectId: p.id, title: 't' }))!;
    const u = (await updateTask(db, t.id, { status: 'in_progress', agentId: 'bob' }))!;
    expect(u.status).toBe('in_progress');
    expect(u.agentId).toBe('bob');
    expect(await deleteTask(db, t.id)).toBe(true);
    expect(await getTask(db, t.id)).toBeUndefined();
    await db.close();
  });
});
