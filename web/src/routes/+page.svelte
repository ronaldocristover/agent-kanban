<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError, subscribeEvents } from '$lib/api';
  import type { ProjectWithCounts, Task, TaskAudit, KanbanEvent } from '$lib/types';

  let projects = $state<ProjectWithCounts[]>([]);
  let selectedId = $state<string | null>(null);
  let tasks = $state<Task[]>([]);
  let connection = $state<'open' | 'connecting' | 'error'>('connecting');
  let connDetail = $state('');
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

  // audit & lock
  let historyByTask: Record<string, TaskAudit[]> = $state({});
  let historyLoading: Record<string, boolean> = $state({});
  let expandedHistory: Record<string, boolean> = $state({});

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

  function handleTaskError(e: unknown) {
    const msg = (e as Error).message ?? 'unknown error';
    if (e instanceof ApiError && e.status === 409) {
      // Backend: "task already locked by <agent>" → normalize to "Task locked by <agent>"
      const m = msg.match(/locked by\s+(.+)/i);
      error = m ? `Task locked by ${m[1].trim()}` : `Task locked — ${msg}`;
    } else if (/locked by/i.test(msg)) {
      const m = msg.match(/locked by\s+(.+)/i);
      error = m ? `Task locked by ${m[1].trim()}` : msg;
    } else {
      error = msg;
    }
  }

  async function moveTask(task: Task, to: 'todo' | 'in_progress' | 'done') {
    try {
      await api.updateTask(task.id, { status: to });
      await refreshTasks(); await refreshProjects();
    } catch (e) { handleTaskError(e); }
  }

  async function deleteTask(id: string) {
    try {
      await api.deleteTask(id);
      await refreshTasks(); await refreshProjects();
    } catch (e) { handleTaskError(e); }
  }

  function startEdit(task: Task) {
    editingId = task.id; editTitle = task.title; editDesc = task.description ?? ''; editAgent = task.agentId ?? '';
    // auto-load audit timeline when editing
    loadHistory(task.id);
    expandedHistory[task.id] = true;
  }

  async function saveEdit() {
    if (!editingId) return;
    try {
      await api.updateTask(editingId, { title: editTitle.trim(), description: editDesc.trim() || null, agent_id: editAgent.trim() || null });
      editingId = null;
      await refreshTasks();
    } catch (e) { handleTaskError(e); }
  }

  async function loadHistory(taskId: string) {
    if (historyLoading[taskId]) return;
    historyLoading[taskId] = true;
    try {
      const h = await api.getTaskHistory(taskId);
      historyByTask[taskId] = h;
    } catch (e) {
      // keep existing, but surface as error if not 404
      if (!(e instanceof ApiError && e.status === 404)) handleTaskError(e);
    } finally {
      historyLoading[taskId] = false;
    }
  }

  async function toggleHistory(taskId: string) {
    const next = !expandedHistory[taskId];
    expandedHistory[taskId] = next;
    if (next) await loadHistory(taskId);
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
      onStatus: (s, detail) => { connection = s; connDetail = detail ?? ''; },
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
      <span style="font-size:10px;color:#94a3b8;margin-left:6px">{connDetail}</span>
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
        <section class="column {col.key}">
          <h2>{col.label} <span class="badge">{col.tasks.length}</span></h2>
          <div class="new-task">
            <input placeholder="New task title" bind:value={newTaskTitle[col.key]} onkeydown={(e) => e.key==='Enter' && createTask(col.key as any)} />
            <textarea rows="3" placeholder="Description (optional)" bind:value={newTaskDesc[col.key]}></textarea>
            <button onclick={() => createTask(col.key as any)} disabled={!newTaskTitle[col.key].trim()}>Add</button>
          </div>
          <div class="cards">
            {#each col.tasks as task (task.id)}
              <article class="card" onclick={() => toggleHistory(task.id)} role="button" tabindex="0" onkeydown={(e) => e.key==='Enter' && toggleHistory(task.id)}>
                {#if editingId === task.id}
                  <input bind:value={editTitle} onclick={(e) => e.stopPropagation()} />
                  <textarea rows="4" bind:value={editDesc} placeholder="Description" onclick={(e) => e.stopPropagation()}></textarea>
                  <input bind:value={editAgent} placeholder="agent_id" onclick={(e) => e.stopPropagation()} />
                  <div class="card-actions">
                    <button onclick={(e) => { e.stopPropagation(); saveEdit(); }}>Save</button>
                    <button onclick={(e) => { e.stopPropagation(); editingId = null; }}>Cancel</button>
                  </div>
                  {#if historyLoading[task.id]}
                    <div class="timeline loading">Loading history…</div>
                  {:else if historyByTask[task.id]?.length}
                    <ul class="timeline">
                      {#each historyByTask[task.id] as a (a.id)}
                        <li class="timeline-item">
                          <span class="from">{a.fromStatus ?? '∅'}</span>
                          <span class="arrow">→</span>
                          <span class="to">{a.toStatus}</span>
                          {#if a.agentId}<span class="chip small">{a.agentId}</span>{/if}
                          <span class="time">{fmtTime(a.changedAt)}</span>
                          {#if a.note}<span class="note">{a.note}</span>{/if}
                        </li>
                      {/each}
                    </ul>
                  {:else if expandedHistory[task.id]}
                    <div class="timeline empty-tl">No history yet</div>
                  {/if}
                {:else}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="card-title" onclick={(e) => { e.stopPropagation(); startEdit(task); }} role="button" tabindex="0" onkeydown={(e) => (e.key==='Enter' || e.key===' ') && startEdit(task)}>{task.title}</div>
                  {#if task.description}
                    <div class="card-desc">{task.description}</div>
                  {/if}
                  <div class="card-meta">
                    {#if task.agentId}
                      <span class="chip lock">🔒 locked by {task.agentId}{#if task.lockedAt} since {fmtTime(task.lockedAt)}{/if}</span>
                    {:else}
                      <span class="chip unlock">unlocked</span>
                    {/if}
                    <span class="time">{fmtTime(task.updatedAt)}</span>
                  </div>
                  <div class="card-actions">
                    {#if task.status !== 'todo'}<button onclick={(e) => { e.stopPropagation(); moveTask(task, 'todo'); }}>← Todo</button>{/if}
                    {#if task.status !== 'in_progress'}<button onclick={(e) => { e.stopPropagation(); moveTask(task, 'in_progress'); }}>→ Progress</button>{/if}
                    {#if task.status !== 'done'}<button onclick={(e) => { e.stopPropagation(); moveTask(task, 'done'); }}>✓ Done</button>{/if}
                    {#if task.status === 'done'}<button onclick={(e) => { e.stopPropagation(); moveTask(task, 'todo'); }}>↺ Reopen</button>{/if}
                    <button onclick={(e) => { e.stopPropagation(); startEdit(task); }}>Edit</button>
                    <button class="danger" onclick={(e) => { e.stopPropagation(); deleteTask(task.id); }}>Delete</button>
                    <button class="ghost" onclick={(e) => { e.stopPropagation(); toggleHistory(task.id); }}>{expandedHistory[task.id] ? 'Hide history' : 'History'}</button>
                  </div>
                  {#if expandedHistory[task.id]}
                    {#if historyLoading[task.id]}
                      <div class="timeline loading">Loading history…</div>
                    {:else if historyByTask[task.id]?.length}
                      <ul class="timeline">
                        {#each historyByTask[task.id] as a (a.id)}
                          <li class="timeline-item">
                            <span class="from">{a.fromStatus ?? '∅'}</span>
                            <span class="arrow">→</span>
                            <span class="to">{a.toStatus}</span>
                            {#if a.agentId}<span class="chip small">{a.agentId}</span>{/if}
                            <span class="time">{fmtTime(a.changedAt)}</span>
                            {#if a.note}<span class="note">{a.note}</span>{/if}
                          </li>
                        {/each}
                      </ul>
                    {:else}
                      <div class="timeline empty-tl">No history yet</div>
                    {/if}
                  {/if}
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
  .column.todo h2 { color: #64748b; }
  .column.in_progress h2 { color: #ea580c; }
  .column.done h2 { color: #16a34a; }
  .badge { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 999px; padding: 0 6px; font-size: 11px; }
  .new-task { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
  .new-task input, .new-task textarea { padding: 6px 8px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 13px; font-family: inherit; resize: vertical; }
  .new-task textarea { min-height: 64px; }
  .cards { display: flex; flex-direction: column; gap: 8px; }
  .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; background: #fff; }
  .card-title { font-weight: 600; font-size: 13px; }
  .card-desc { font-size: 13px; color: #334155; margin-top: 6px; white-space: pre-wrap; line-height: 1.5; max-height: 160px; overflow-y: auto; padding: 6px 8px; background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 6px; }
  .card-meta { display: flex; gap: 6px; align-items: center; margin-top: 6px; font-size: 11px; color: #64748b; }
  .chip { background: #e0e7ff; color: #3730a3; padding: 1px 6px; border-radius: 999px; border: 1px solid #c7d2fe; }
  .time { margin-left: auto; }
  .card-actions { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
  .card-actions button { font-size: 11px; padding: 3px 6px; }
  .card input, .card textarea { width: 100%; box-sizing: border-box; padding: 8px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 13px; margin-top: 6px; font-family: inherit; }
  .card textarea { min-height: 88px; resize: vertical; line-height: 1.5; }
  .chip.lock { background: #fef3c7; color: #92400e; border-color: #fbbf24; }
  .chip.unlock { background: #f1f5f9; color: #64748b; border-color: #cbd5e1; }
  .chip.small { font-size: 10px; padding: 0 5px; }
  button.ghost { background: #f8fafc; border-color: #e2e8f0; color: #334155; }
  .timeline { margin: 8px 0 0; padding: 6px 0 0 0; list-style: none; border-top: 1px dashed #e2e8f0; font-size: 12px; }
  .timeline.loading, .timeline.empty-tl { color: #94a3b8; font-size: 12px; padding: 6px 0; border-top: 1px dashed #e2e8f0; margin-top: 8px; }
  .timeline-item { display: flex; gap: 6px; align-items: center; padding: 3px 0; border-bottom: 1px solid #f1f5f9; flex-wrap: wrap; }
  .timeline-item .from, .timeline-item .to { font-weight: 600; font-size: 11px; padding: 1px 5px; border-radius: 999px; background: #f1f5f9; border: 1px solid #e2e8f0; }
  .timeline-item .to { background: #e0e7ff; border-color: #c7d2fe; color: #3730a3; }
  .timeline-item .arrow { color: #64748b; }
  .timeline-item .note { color: #64748b; font-style: italic; }
  .empty, .empty-col { color: #94a3b8; font-size: 13px; }
</style>
