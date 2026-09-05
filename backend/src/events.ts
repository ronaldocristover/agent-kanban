import type { Db } from './db.ts';

export type KanbanEvent = { id: number; type: string; payload: unknown; createdAt: string };

export class EventBus {
  private clients = new Set<(e: KanbanEvent) => void>();

  constructor(private db: Db) {}

  async emit(type: string, payload: unknown): Promise<KanbanEvent> {
    const createdAt = new Date().toISOString();
    const res = await this.db.run('INSERT INTO events (type, payload, created_at) VALUES (?, ?, ?)', [
      type,
      JSON.stringify(payload),
      createdAt,
    ]);
    const id = res.insertId ?? res.lastInsertRowid ?? 0;
    // MySQL insertId is the new row id; for sqlite lastInsertRowid
    // If both missing (should not), query last id
    let eventId = Number(id);
    if (!eventId) {
      const row = await this.db.queryOne<{ id: number }>('SELECT MAX(id) as id FROM events');
      eventId = row?.id ?? 0;
    }
    const event: KanbanEvent = { id: eventId, type, payload, createdAt };
    for (const send of this.clients) send(event);
    this.pruneIfNeeded().catch(() => {});
    return event;
  }

  subscribe(send: (e: KanbanEvent) => void): () => void {
    this.clients.add(send);
    return () => this.clients.delete(send);
  }

  async replayAfter(lastId: number, limit = 1000): Promise<KanbanEvent[]> {
    const rows = await this.db.query<{ id: number; type: string; payload: string; created_at: string }>(
      'SELECT id, type, payload, created_at FROM events WHERE id > ? ORDER BY id ASC LIMIT ?',
      [lastId, limit],
    );
    return rows.map((r) => {
      let payload: unknown = r.payload;
      try {
        payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
      } catch {}
      return { id: r.id, type: r.type, payload, createdAt: r.created_at };
    });
  }

  private async pruneIfNeeded(): Promise<void> {
    const keep = 1000;
    if (this.db.type === 'mysql') {
      await this.db.exec(`DELETE FROM events WHERE id NOT IN (SELECT id FROM (SELECT id FROM events ORDER BY id DESC LIMIT ${keep}) AS t)`);
    } else {
      await this.db.run('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT ?)', [keep]);
    }
  }
}
