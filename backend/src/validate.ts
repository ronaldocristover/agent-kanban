import { STATUSES, type Status } from './store.ts';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateProjectBody(
  body: unknown,
  partial: boolean,
): ValidationResult<{ name?: string; description?: string | null }> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = body as Record<string, unknown>;
  const out: { name?: string; description?: string | null } = {};

  if ('name' in obj) {
    if (typeof obj.name !== 'string' || obj.name.trim() === '') {
      return { ok: false, error: 'name must be a non-empty string' };
    }
    out.name = obj.name.trim();
  } else if (!partial) {
    return { ok: false, error: 'name is required' };
  }

  if ('description' in obj) {
    if (obj.description !== null && typeof obj.description !== 'string') {
      return { ok: false, error: 'description must be a string or null' };
    }
    out.description = (obj.description as string | null) ?? null;
  }

  if (!partial && out.name === undefined) {
    return { ok: false, error: 'name is required' };
  }
  if (partial && out.name === undefined && out.description === undefined) {
    return { ok: false, error: 'at least one of name, description must be provided' };
  }
  return { ok: true, value: out };
}

export function validateTaskBody(
  body: unknown,
  partial: boolean,
): ValidationResult<{
  project_id?: string;
  title?: string;
  description?: string | null;
  status?: Status;
  agent_id?: string | null;
}> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = body as Record<string, unknown>;
  const out: {
    project_id?: string;
    title?: string;
    description?: string | null;
    status?: Status;
    agent_id?: string | null;
  } = {};

  if ('project_id' in obj) {
    if (typeof obj.project_id !== 'string' || (obj.project_id as string).trim() === '') {
      return { ok: false, error: 'project_id must be a non-empty string' };
    }
    out.project_id = (obj.project_id as string).trim();
  } else if (!partial) {
    return { ok: false, error: 'project_id is required' };
  }

  if ('title' in obj) {
    if (typeof obj.title !== 'string' || (obj.title as string).trim() === '') {
      return { ok: false, error: 'title must be a non-empty string' };
    }
    out.title = (obj.title as string).trim();
  } else if (!partial) {
    return { ok: false, error: 'title is required' };
  }

  if ('description' in obj) {
    if (obj.description !== null && typeof obj.description !== 'string') {
      return { ok: false, error: 'description must be a string or null' };
    }
    out.description = (obj.description as string | null) ?? null;
  }

  if ('status' in obj) {
    if (typeof obj.status !== 'string' || !(STATUSES as readonly string[]).includes(obj.status as string)) {
      return { ok: false, error: `status must be one of: ${STATUSES.join(', ')}` };
    }
    out.status = obj.status as Status;
  }

  if ('agent_id' in obj) {
    if (obj.agent_id !== null && typeof obj.agent_id !== 'string') {
      return { ok: false, error: 'agent_id must be a string or null' };
    }
    out.agent_id = (obj.agent_id as string | null) ?? null;
    if (typeof out.agent_id === 'string') out.agent_id = out.agent_id.trim() || null;
  }

  return { ok: true, value: out };
}
