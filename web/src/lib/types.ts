export type Status = 'todo' | 'in_progress' | 'done' | 'rejected';

export type Project = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskCounts = { todo: number; in_progress: number; done: number; rejected: number; total: number };

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

export type KanbanEvent = { id: number; type: string; payload: unknown; createdAt: string };
