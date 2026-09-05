export type Status = 'todo' | 'in_progress' | 'done';

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
  createdAt: string;
  updatedAt: string;
};

export type KanbanEvent = { id: number; type: string; payload: unknown; createdAt: string };
