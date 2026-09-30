import type { Hono } from 'hono';
import type { AppEnv } from '../context';

export function registerHealthRoutes(app: Hono<AppEnv>): void {
  app.get('/api/health', (c) => c.json({ ok: true, service: 'todo' }));
}
