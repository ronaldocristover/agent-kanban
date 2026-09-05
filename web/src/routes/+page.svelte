<script lang="ts">
  import { onMount } from 'svelte';
  import { api, subscribeEvents } from '$lib/api';
  import type { ProjectWithCounts, Task, KanbanEvent } from '$lib/types';

  let projects = $state<ProjectWithCounts[]>([]);
  let selectedId = $state<string | null>(null);
  let tasks = $state<Task[]>([]);
  let connection = $state<'open' | 'connecting' | 'error'>('connecting');
  let error = $state<string | null>(null);

  // forms
  let newProjectName = $state('');
  let newProjectDesc = $state('');
  let newTaskTitle: Record<string, string> = $state({ todo: '', in_progress: '', done: '' });
  let newTaskDesc: Record<string, string> = $state({ todo: '', in_progress: '', done: '' });
  let editingId = $state<string | null>(null);
  let editTitle = $state('');
  let editDesc = $state('');
  let editAgent = $state('');

  const selected = $derived(projects.find((p) => p.id === selectedId) ?? null);
  const todoTasks = $derived(tasks.filter((t) => t.status === 'todo'));
  const inProgressTasks = $derived(tasks.filter((t) => t.status === 'in_progress'));
  const doneTasks = $derived(tasks.filter((t) => t.status === 'done'));

  async function refreshProjects() {
    try {
      projects = await api.listProjects();
      if (!selectedId && projects.length) selectedId = projects[0].id;
      if (selectedId && !projects.find((p) => p.id === selectedId)) {
        selectedId = projects[0]?.id ?? null;
      }
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function refreshTasks() {
    if (!selectedId) { tasks = []; return; }
    try {
      tasks = await api.listTasks(selectedId);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function selectProject(id: string) {
    selectedId = id;
    await refreshTasks();
  }

  async function createProject() {
    if (!newProjectName.trim()) return;
    try {
      const p = await api.createProject(newProjectName.trim(), newProjectDesc.trim() || undefined);
      newProjectName = ''; newProjectDesc = '';
      await refreshProjects();
      selectedId = p.id;
      await refreshTasks();
    } catch (e) { error = (e as Error).message; }
  }

  async function deleteProject(id: string) {
    if (!confirm('Delete project and all its tasks?')) return;
    try {
      await api.deleteProject(id);
      await refreshProjects();
      await refreshTasks();
    } catch (e) { error = (e as Error).message; }
  }

  async function createTask(status: 'todo' | 'in_progress' | 'done') {
    if (!selectedId || !newTaskTitle[status].trim()) return;
    try {
      await api.createTask({ project_id: selectedId, title: newTaskTitle[status].trim(), description: newTaskDesc[status].trim() || undefined, status });
      newTaskTitle[status] = ''; newTaskDesc[status] = '';
      await refreshTasks(); await refreshProjects();
    } catch (e) { error = (e as Error).message; }
  }

  async function moveTask(task: Task, to: 'todo' | 'in_progress' | 'done') {
    try {
      await api.updateTask(task.id, { status: to });
      await refreshTasks(); await refreshProjects();
    } catch (e) { error = (e as Error).message; }
  }

  async function deleteTask(id: string) {
    try {
      await api.deleteTask(id);
      await refreshTasks(); await refreshProjects();
    } catch (e) { error = (e as Error).message; }
  }

  function startEdit(task: Task) {
    editingId = task.id; editTitle = task.title; editDesc = task.description ?? ''; editAgent = task.agentId ?? '';
  }

  async function saveEdit() {
    if (!editingId) return;
    try {
      await api.updateTask(editingId, { title: editTitle.trim(), description: editDesc.trim() || null, agent_id: editAgent.trim() || null });
      editingId = null;
      await refreshTasks();
    } catch (e) { error = (e as Error).message; }
  }

  function fmtTime(iso: string) {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
    return d.toLocaleDateString();
  }

  onMount(() => {
    refreshProjects().then(refreshTasks);
    const close = subscribeEvents({
      onStatus: (s) => (connection = s),
      onEvent: async () => {
        await refreshProjects();
        await refreshTasks();
      }
    });
    return close;
  });
</script>

<svelte:head>
  <title>Agent Kanban</title>
</svelte:head>

<div class="app">
  <header class="topbar">
    <h1>Agent Kanban</h1>
    <div class="conn" class:ok={connection==='open'} class:bad={connection!=='open'}>
      {connection === 'open' ? '● live' : connection === 'connecting' ? '○ connecting' : '○ reconnecting'}
    </div>
  </header>

  {#if error}
    <div class="banner error" role="alert">
      {error} <button onclick={() => error = null}>✕</button>
    </div>
  {/if}

  <section class="projects">
    <div class="project-bar">
      <select onchange={(e) => selectProject((e.target as HTMLSelectElement).value)} value={selectedId ?? ''}>
        {#each projects as p}
          <option value={p.id}>{p.name} ({p.taskCounts.total})</option>
        {/each}
        {#if !projects.length}
          <option value="" disabled>No projects</option>
        {/if}
      </select>
      {#if selected}
        <span class="counts">todo {selected.taskCounts.todo} · in_progress {selected.taskCounts.in_progress} · done {selected.taskCounts.done}</span>
        <button class="danger" onclick={() => deleteProject(selected.id)}>Delete project</button>
      {/if}
    </div>
    <div class="new-project">
      <input placeholder="New project name" bind:value={newProjectName} onkeydown={(e) => e.key==='Enter' && createProject()} />
      <input placeholder="Description (optional)" bind:value={newProjectDesc} onkeydown={(e) => e.key==='Enter' && createProject()} />
      <button onclick={createProject} disabled={!newProjectName.trim()}>Create project</button>
    </div>
  </section>

  {#if !selected}
    <p class="empty">Create a project to get started.</p>
  {:else}
    <main class="board">
      {#each [
        { key: 'todo', label: 'Todo', tasks: todoTasks },
        { key: 'in_progress', label: 'In Progress', tasks: inProgressTasks },
        { key: 'done', label: 'Done', tasks: doneTasks }
      ] as col}
        <section class="column">
          <h2>{col.label} <span class="badge">{col.tasks.length}</span></h2>
          <div class="new-task">
            <input placeholder="New task title" bind:value={newTaskTitle[col.key]} onkeydown={(e) => e.key==='Enter' && createTask(col.key as any)} />
            <input placeholder="Description (optional)" bind:value={newTaskDesc[col.key]} onkeydown={(e) => e.key==='Enter' && createTask(col.key as any)} />
            <button onclick={() => createTask(col.key as any)} disabled={!newTaskTitle[col.key].trim()}>Add</button>
          </div>
          <div class="cards">
            {#each col.tasks as task (task.id)}
              <article class="card">
                {#if editingId === task.id}
                  <input bind:value={editTitle} />
                  <textarea rows="2" bind:value={editDesc} placeholder="Description"></textarea>
                  <input bind:value={editAgent} placeholder="agent_id" />
                  <div class="card-actions">
                    <button onclick={saveEdit}>Save</button>
                    <button onclick={() => editingId = null}>Cancel</button>
                  </div>
                {:else}
                  <div class="card-title">{task.title}</div>
                  {#if task.description}
                    <div class="card-desc">{task.description}</div>
                  {/if}
                  <div class="card-meta">
                    {#if task.agentId}<span class="chip">{task.agentId}</span>{/if}
                    <span class="time">{fmtTime(task.updatedAt)}</span>
                  </div>
                  <div class="card-actions">
                    {#if task.status !== 'todo'}<button onclick={() => moveTask(task, 'todo')}>← Todo</button>{/if}
                    {#if task.status !== 'in_progress'}<button onclick={() => moveTask(task, 'in_progress')}>→ Progress</button>{/if}
                    {#if task.status !== 'done'}<button onclick={() => moveTask(task, 'done')}>✓ Done</button>{/if}
                    {#if task.status === 'done'}<button onclick={() => moveTask(task, 'todo')}>↺ Reopen</button>{/if}
                    <button onclick={() => startEdit(task)}>Edit</button>
                    <button class="danger" onclick={() => deleteTask(task.id)}>Delete</button>
                  </div>
                {/if}
              </article>
            {/each}
            {#if !col.tasks.length}<p class="empty-col">empty</p>{/if}
          </div>
        </section>
      {/each}
    </main>
  {/if}
</div>

<style>
  :global(body) { margin: 0; font-family: ui-sans-system, system-ui, sans-serif; background: #f8fafc; color: #0f172a; }
  .app { max-width: 1280px; margin: 0 auto; padding: 16px; }
  .topbar { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 16px; }
  .topbar h1 { margin: 0; font-size: 20px; }
  .conn { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #fee2e2; color: #991b1b; }
  .conn.ok { background: #dcfce7; color: #166534; }
  .banner { display: flex; justify-content: space-between; align-items: center; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; }
  .projects { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; margin-bottom: 16px; }
  .project-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .project-bar select { min-width: 220px; padding: 6px 8px; border-radius: 8px; border: 1px solid #cbd5e1; }
  .counts { font-size: 12px; color: #64748b; }
  .new-project { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .new-project input { flex: 1; min-width: 160px; padding: 6px 8px; border-radius: 8px; border: 1px solid #cbd5e1; }
  button { padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: white; cursor: pointer; font-size: 13px; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.danger { border-color: #fca5a5; color: #991b1b; }
  .board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  @media (max-width: 900px) { .board { grid-template-columns: 1fr; } }
  .column { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; min-height: 240px; }
  .column h2 { margin: 0 0 10px; font-size: 14px; display: flex; gap: 6px; align-items: center; }
  .badge { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 999px; padding: 0 6px; font-size: 11px; }
  .new-task { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
  .new-task input { padding: 6px 8px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 13px; }
  .cards { display: flex; flex-direction: column; gap: 8px; }
  .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; background: #fff; }
  .card-title { font-weight: 600; font-size: 13px; }
  .card-desc { font-size: 12px; color: #475569; margin-top: 4px; white-space: pre-wrap; }
  .card-meta { display: flex; gap: 6px; align-items: center; margin-top: 6px; font-size: 11px; color: #64748b; }
  .chip { background: #e0e7ff; color: #3730a3; padding: 1px 6px; border-radius: 999px; border: 1px solid #c7d2fe; }
  .time { margin-left: auto; }
  .card-actions { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
  .card-actions button { font-size: 11px; padding: 3px 6px; }
  .card input, .card textarea { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 13px; margin-top: 6px; }
  .empty, .empty-col { color: #94a3b8; font-size: 13px; }
</style>
