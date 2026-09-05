import { openDb, defaultDbPath } from './db.ts';
import { EventBus } from './events.ts';
import { createApp } from './app.ts';
import path from 'node:path';
import { existsSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.KANBAN_DB ?? defaultDbPath();
const STATIC_DIR = process.env.STATIC_DIR ?? path.resolve(import.meta.dir, '../../web/build');

const db = openDb(DB_PATH);
const bus = new EventBus(db);

const app = createApp({ db, bus }, { staticDir: STATIC_DIR });

app.listen({ port: PORT, hostname: HOST }, ({ hostname, port }) => {
  console.log(`agent-kanban backend (Elysia) listening on http://${hostname}:${port} (db: ${DB_PATH})`);
  if (existsSync(STATIC_DIR)) console.log(`serving static from ${STATIC_DIR}`);
});

export { app, db, bus };
