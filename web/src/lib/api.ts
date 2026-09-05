import type { ProjectWithCounts, Task, KanbanEvent } from './types.ts';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data !== null && 'error' in data
        ? (data as { error: string }).error
        : res.statusText;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  listProjects: () => req<ProjectWithCounts[]>('/api/projects'),
  getProject: (id: string) => req<ProjectWithCounts>(`/api/projects/${encodeURIComponent(id)}`),
  createProject: (name: string, description?: string) =>
    req<ProjectWithCounts>('/api/projects', { method: 'POST', body: JSON.stringify({ name, description }) }),
  updateProject: (id: string, patch: { name?: string; description?: string | null }) =>
    req<ProjectWithCounts>(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteProject: (id: string) => req<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listTasks: (projectId: string) => req<Task[]>(`/api/tasks?project_id=${encodeURIComponent(projectId)}`),
  listAllTasks: (filters?: { project_id?: string; status?: string; agent_id?: string }) => {
    const p = new URLSearchParams();
    if (filters?.project_id) p.set('project_id', filters.project_id);
    if (filters?.status) p.set('status', filters.status);
    if (filters?.agent_id) p.set('agent_id', filters.agent_id);
    const qs = p.toString() ? `?${p}` : '';
    return req<Task[]>(`/api/tasks${qs}`);
  },
  createTask: (input: { project_id: string; title: string; description?: string; status?: string; agent_id?: string }) =>
    req<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }),
  updateTask: (id: string, patch: Record<string, unknown>) =>
    req<Task>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTask: (id: string) => req<void>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
};

export function subscribeEvents(handlers: {
  onEvent: (e: KanbanEvent) => void;
  onStatus: (s: 'open' | 'connecting' | 'error') => void;
}): () => void {
  let es: EventSource | null = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    handlers.onStatus('connecting');
    es = new EventSource('/api/events');
    es.onopen = () => handlers.onStatus('open');
    es.onmessage = (m) => {
      try {
        const data = JSON.parse(m.data) as KanbanEvent;
        handlers.onEvent(data);
      } catch {}
    };
    es.onerror = () => {
      handlers.onStatus('error');
      es?.close();
      setTimeout(connect, 1500);
    };
  };
  connect();
  return () => {
    closed = true;
    es?.close();
  };
}
