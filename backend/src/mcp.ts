import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${BACKEND_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return { ok: true };
  const body = await res.text();
  let data: unknown;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = body;
  }
  if (!res.ok) {
    const msg = typeof data === 'object' && data !== null && 'error' in data ? (data as { error: string }).error : res.statusText;
    throw new Error(msg);
  }
  return data;
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true as const };
}
function okResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export function createMcpServer() {
  const server = new McpServer({ name: 'agent-kanban', version: '0.1.0' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: any = server;

  s.registerTool(
    'list_projects',
    { description: 'List all projects with task counts' },
    async () => {
      try {
        const data = await api('/api/projects');
        return okResult(data);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  s.registerTool(
    'create_project',
    {
      description: 'Create a new project',
      inputSchema: { name: z.string().min(1), description: z.string().optional() },
    },
    async ({  name, description  }: any) => {
      try {
        const data = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name, description }) });
        return okResult(data);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  s.registerTool(
    'update_project',
    {
      description: 'Update a project (partial)',
      inputSchema: { id: z.string(), name: z.string().optional(), description: z.string().nullable().optional() },
    },
    async ({  id, name, description  }: any) => {
      try {
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (description !== undefined) body.description = description;
        const data = await api(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
        return okResult(data);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  s.registerTool(
    'delete_project',
    { description: 'Delete a project and its tasks', inputSchema: { id: z.string() } },
    async ({  id  }: any) => {
      try {
        await api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return okResult({ deleted: id });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  s.registerTool(
    'list_tasks',
    {
      description: 'List tasks with optional filters',
      inputSchema: {
        project_id: z.string().optional(),
        status: z.enum(['todo', 'in_progress', 'done', 'rejected']).optional(),
        agent_id: z.string().optional(),
      },
    },
    async ({  project_id, status, agent_id  }: any) => {
      try {
        const params = new URLSearchParams();
        if (project_id) params.set('project_id', project_id);
        if (status) params.set('status', status);
        if (agent_id) params.set('agent_id', agent_id);
        const qs = params.toString() ? `?${params}` : '';
        const data = await api(`/api/tasks${qs}`);
        return okResult(data);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  s.registerTool(
    'create_task',
    {
      description: 'Create a task in a project (defaults to todo)',
      inputSchema: {
        project_id: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(['todo', 'in_progress', 'done', 'rejected']).optional(),
      },
    },
    async ({  project_id, title, description, status  }: any) => {
      try {
        const data = await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({ project_id, title, description, status }),
        });
        return okResult(data);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  s.registerTool(
    'update_task',
    {
      description: 'Update a task (claim, move status, edit)',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        status: z.enum(['todo', 'in_progress', 'done', 'rejected']).optional(),
        agent_id: z.string().nullable().optional(),
      },
    },
    async ({  id, title, description, status, agent_id  }: any) => {
      try {
        const body: Record<string, unknown> = {};
        if (title !== undefined) body.title = title;
        if (description !== undefined) body.description = description;
        if (status !== undefined) body.status = status;
        if (agent_id !== undefined) body.agent_id = agent_id;
        const data = await api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
        return okResult(data);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  s.registerTool(
    'delete_task',
    { description: 'Delete a task', inputSchema: { id: z.string() } },
    async ({  id  }: any) => {
      try {
        await api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return okResult({ deleted: id });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  return server;
}

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('agent-kanban MCP server running (backend: ' + BACKEND_URL + ')');
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
