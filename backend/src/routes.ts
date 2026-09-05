// Deprecated — use app.ts createApp instead. Kept for backward compat.
import { createApp, type AppCtx } from './app.ts';
export type { AppCtx } from './app.ts';

export async function handleApi(req: Request, ctx: AppCtx): Promise<Response | null> {
  const app = createApp(ctx);
  const res = await app.handle(req);
  // Elysia responds 404 for unknown /api routes; original handleApi returned null for non-api.
  // Preserve original contract: return null for non-api paths so caller can try static.
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/')) return null;
  // For /api/* unknown, Elysia returns 404 JSON; keep it as Response (original returned null only for non-api).
  // If response is 404 and not part of /api, caller expects null — but all /api/* are handled above.
  return res;
}
export { createApp } from './app.ts';
