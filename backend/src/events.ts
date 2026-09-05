import type { Database } from 'bun:sqlite';

export type KanbanEvent = { id: number; type: string; payload: unknown; createdAt: string };

export class EventBus {
  private clients = new Set<(e: KanbanEvent) => void>();

  constructor(private db: Database) {}

  emit(type: string, payload: unknown): KanbanEvent {
    const createdAt = new Date().toISOString();
    const result = this.db.run('INSERT INTO events (type, payload, created_at) VALUES (?, ?, ?)', [
      type,
      JSON.stringify(payload),
      createdAt,
    ]);
    const event: KanbanEvent = { id: Number(result.lastInsertRowid), type, payload, createdAt };
    for (const send of this.clients) send(event);
    this.pruneIfNeeded();
    return event;
  }

  subscribe(send: (e: KanbanEvent) => void): () => void {
    this.clients.add(send);
    return () => this.clients.delete(send);
  }

  replayAfter(lastId: number, limit = 1000): KanbanEvent[] {
    const rows = this.db
      .query<{ id: number; type: string; payload: string; created_at: string }, [number, number]>(
        'SELECT id, type, payload, created_at FROM events WHERE id > ? ORDER BY id ASC LIMIT ?',
      )
      .all(lastId, limit);
    return rows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload), createdAt: r.created_at }));
  }

  private pruneIfNeeded() {
    const keep = 1000;
    this.db.run(
      'DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT ?)',
      [keep],
    );
  }
}
