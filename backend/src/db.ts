import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

export type DbType = 'sqlite' | 'mysql';

export interface Db {
  type: DbType;
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: any[]): Promise<T | undefined>;
  run(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowid?: number; insertId?: number }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  raw?: unknown; // underlying Database or Pool
}

function isMysqlEnv(): boolean {
  return !!(process.env.MYSQL_HOST || process.env.MYSQL_URL || process.env.DATABASE_URL);
}

function mysqlConfig() {
  if (process.env.MYSQL_URL || process.env.DATABASE_URL) {
    const url = process.env.MYSQL_URL || process.env.DATABASE_URL!;
    // mysql2 can accept uri string
    return { uri: url };
  }
  return {
    host: process.env.MYSQL_HOST ?? 'db',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'kanban',
    password: process.env.MYSQL_PASSWORD ?? 'kanban',
    database: process.env.MYSQL_DATABASE ?? 'kanban',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  };
}

class SqliteDb implements Db {
  type: DbType = 'sqlite';
  constructor(private db: Database) {}
  async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    return this.db.query<T, any>(sql).all(...params) as T[];
  }
  async queryOne<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    return this.db.query<T, any>(sql).get(...params) as T | undefined;
  }
  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number }> {
    const res = this.db.run(sql, params as any);
    return { changes: res.changes, lastInsertRowid: Number(res.lastInsertRowid) };
  }
  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }
  async close(): Promise<void> {
    this.db.close();
  }
  get raw(): Database { return this.db; }
}

class MysqlDb implements Db {
  type: DbType = 'mysql';
  constructor(private pool: mysql.Pool) {}
  async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    const [rows] = await this.pool.execute(sql, params);
    return rows as T[];
  }
  async queryOne<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }
  async run(sql: string, params: any[] = []): Promise<{ changes: number; insertId?: number }> {
    const [res] = await this.pool.execute(sql, params as any) as unknown as [mysql.ResultSetHeader, unknown];
    return { changes: (res as any).affectedRows, insertId: (res as any).insertId };
  }
  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  get raw(): mysql.Pool { return this.pool; }
}

export async function openDb(dbPath?: string): Promise<Db> {
  const pathArg = dbPath ?? defaultDbPath();

  // :memory: always uses sqlite (for tests)
  if (pathArg === ':memory:') {
    const db = new Database(':memory:');
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    await migrate(new SqliteDb(db));
    return new SqliteDb(db);
  }

  // If MYSQL env is set, use MySQL with retry (for Docker startup)
  if (isMysqlEnv()) {
    const cfg: any = mysqlConfig();
    let pool: mysql.Pool;
    if (cfg.uri) {
      pool = mysql.createPool(cfg.uri);
    } else {
      pool = mysql.createPool(cfg);
    }
    const db = new MysqlDb(pool);
    // wait for MySQL to be ready (Docker healthcheck may still be starting)
    let lastErr: unknown;
    for (let i = 0; i < 10; i++) {
      try {
        await pool.query('SELECT 1');
        break;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    try {
      await pool.query('SELECT 1');
    } catch (e) {
      throw lastErr ?? e;
    }
    await migrate(db);
    return db;
  }

  // Otherwise file-based sqlite (default for local dev without MYSQL)
  // This keeps backwards compat and tests with file path
  if (pathArg !== ':memory:') {
    mkdirSync(path.dirname(pathArg), { recursive: true });
  }
  const sqlite = new Database(pathArg);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const db = new SqliteDb(sqlite);
  await migrate(db);
  return db;
}

async function migrate(db: Db) {
  if (db.type === 'sqlite') {
    await db.exec(`
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
        locked_at   TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        type       TEXT NOT NULL,
        payload    TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_audits (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        from_status TEXT,
        to_status   TEXT NOT NULL,
        agent_id    TEXT,
        changed_at  TEXT NOT NULL,
        note        TEXT
      );
    `);
    // Add locked_at column for existing DBs
    try { await db.exec('ALTER TABLE tasks ADD COLUMN locked_at TEXT'); } catch {}
    // Create task_audits if not exists (for DBs created before this migration)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS task_audits (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        from_status TEXT,
        to_status   TEXT NOT NULL,
        agent_id    TEXT,
        changed_at  TEXT NOT NULL,
        note        TEXT
      );
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id          VARCHAR(16) PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        description TEXT,
        created_at  VARCHAR(64) NOT NULL,
        updated_at  VARCHAR(64) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id          VARCHAR(16) PRIMARY KEY,
        project_id  VARCHAR(16) NOT NULL,
        title       VARCHAR(255) NOT NULL,
        description TEXT,
        status      ENUM('todo','in_progress','done') NOT NULL,
        agent_id    VARCHAR(128),
        locked_at   VARCHAR(64),
        created_at  VARCHAR(64) NOT NULL,
        updated_at  VARCHAR(64) NOT NULL,
        CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    // Add locked_at for existing MySQL DBs
    try { await db.exec('ALTER TABLE tasks ADD COLUMN locked_at VARCHAR(64)'); } catch {}
    await db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        type       VARCHAR(64) NOT NULL,
        payload    JSON NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        INDEX idx_events_id (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS task_audits (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        task_id    VARCHAR(16) NOT NULL,
        from_status VARCHAR(16),
        to_status   VARCHAR(16) NOT NULL,
        agent_id    VARCHAR(128),
        changed_at  VARCHAR(64) NOT NULL,
        note        TEXT,
        INDEX idx_audits_task (task_id),
        CONSTRAINT fk_audits_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }
}

export function defaultDbPath(): string {
  return path.resolve(import.meta.dir, '../../data/kanban.db');
}
