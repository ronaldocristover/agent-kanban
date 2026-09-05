import { openDb, defaultDbPath } from './db.ts';
import { EventBus } from './events.ts';
import { handleApi } from './routes.ts';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.KANBAN_DB ?? defaultDbPath();
const STATIC_DIR = process.env.STATIC_DIR ?? path.resolve(import.meta.dir, '../../web/build');

const db = openDb(DB_PATH);
const bus = new EventBus(db);

function sseHandler(req: Request): Response {
  const lastEventId = Number(req.headers.get('last-event-id') ?? 0);
  let unsubscribe: (() => void) | undefined;
  let interval: Timer | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: { id: number; type: string; payload: unknown; createdAt: string }) => {
        try {
          controller.enqueue(enc.encode(`id: ${e.id}\ndata: ${JSON.stringify({ id: e.id, type: e.type, payload: e.payload, createdAt: e.createdAt })}\n\n`));
        } catch {}
      };
      for (const e of bus.replayAfter(Number.isFinite(lastEventId) ? lastEventId : 0)) send(e);
      unsubscribe = bus.subscribe(send);
      interval = setInterval(() => {
        try {
          controller.enqueue(enc.encode(': heartbeat\n\n'));
        } catch {}
      }, 15000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    },
  });
}

function serveStatic(req: Request): Response | null {
  if (!existsSync(STATIC_DIR)) return null;
  const url = new URL(req.url);
  let filePath = path.join(STATIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  // directory traversal guard
  if (!filePath.startsWith(STATIC_DIR)) return new Response('forbidden', { status: 403 });
  try {
    const stat = statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {}
  try {
    const file = Bun.file(filePath);
    // Bun.file exists check: if file doesn't exist, fall back to index.html for SPA
    // Use statSync for fallback
    try {
      statSync(filePath);
      return new Response(file);
    } catch {
      const fallback = path.join(STATIC_DIR, 'index.html');
      try {
        statSync(fallback);
        return new Response(Bun.file(fallback));
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'access-control-allow-headers': 'content-type, last-event-id',
        },
      });
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      return sseHandler(req);
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        const res = await handleApi(req, { db, bus });
        if (res) {
          res.headers.set('access-control-allow-origin', '*');
          return res;
        }
        return new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        });
      } catch (e) {
        console.error(e);
        return new Response(JSON.stringify({ error: 'internal server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    // Static frontend
    if (req.method === 'GET') {
      const staticRes = serveStatic(req);
      if (staticRes) return staticRes;
    }

    return new Response('not found', { status: 404 });
  },
});

console.log(`agent-kanban backend listening on http://${HOST}:${PORT} (db: ${DB_PATH})`);
if (existsSync(STATIC_DIR)) console.log(`serving static from ${STATIC_DIR}`);

export { server, db, bus };
