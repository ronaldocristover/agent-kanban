import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDb(dbPath: string): Database {
  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL CHECK (status IN ('todo','in_progress','done')),
      agent_id    TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL,
      payload    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function defaultDbPath(): string {
  return path.resolve(import.meta.dir, '../../data/kanban.db');
}
