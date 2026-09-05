import { describe, it, expect } from 'bun:test';
import { openDb } from '../src/db.ts';
import { createProject, listProjects, getProject, updateProject, deleteProject, createTask, listTasks, getTask, updateTask, deleteTask, getTaskCounts } from '../src/store.ts';

function freshDb() {
  return openDb(':memory:');
}

describe('store: projects', () => {
  it('creates and lists projects with counts', () => {
    const db = freshDb();
    const p = createProject(db, { name: 'P1' });
    expect(p.name).toBe('P1');
    const all = listProjects(db);
    expect(all.length).toBe(1);
    expect(all[0].taskCounts.total).toBe(0);
  });

  it('updates project', () => {
    const db = freshDb();
    const p = createProject(db, { name: 'A' });
    const u = updateProject(db, p.id, { name: 'B', description: 'desc' });
    expect(u?.name).toBe('B');
    expect(u?.description).toBe('desc');
    expect(getProject(db, p.id)?.name).toBe('B');
  });

  it('deletes project and cascades tasks', () => {
    const db = freshDb();
    const p = createProject(db, { name: 'X' });
    createTask(db, { projectId: p.id, title: 't1' })!;
    expect(listTasks(db, { projectId: p.id }).length).toBe(1);
    expect(deleteProject(db, p.id)).toBe(true);
    expect(listProjects(db).length).toBe(0);
    expect(listTasks(db, { projectId: p.id }).length).toBe(0);
  });
});

describe('store: tasks', () => {
  it('creates task defaults to todo and filters', () => {
    const db = freshDb();
    const p = createProject(db, { name: 'P' });
    const t1 = createTask(db, { projectId: p.id, title: 'a', agentId: 'agent-1' })!;
    const t2 = createTask(db, { projectId: p.id, title: 'b', status: 'done' })!;
    expect(t1.status).toBe('todo');
    expect(t2.status).toBe('done');
    expect(listTasks(db, { status: 'todo' }).length).toBe(1);
    expect(listTasks(db, { agentId: 'agent-1' }).length).toBe(1);
    expect(getTaskCounts(db, p.id).todo).toBe(1);
    expect(getTaskCounts(db, p.id).done).toBe(1);
  });

  it('create with unknown project returns undefined', () => {
    const db = freshDb();
    expect(createTask(db, { projectId: 'nope', title: 'x' })).toBeUndefined();
  });

  it('updates and deletes task', () => {
    const db = freshDb();
    const p = createProject(db, { name: 'P' });
    const t = createTask(db, { projectId: p.id, title: 't' })!;
    const u = updateTask(db, t.id, { status: 'in_progress', agentId: 'bob' })!;
    expect(u.status).toBe('in_progress');
    expect(u.agentId).toBe('bob');
    expect(deleteTask(db, t.id)).toBe(true);
    expect(getTask(db, t.id)).toBeUndefined();
  });
});
