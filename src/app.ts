import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, AppServices } from './context';
import { ApiError } from './errors';
import { attachPrincipal } from './middleware/auth';
import { registerHealthRoutes } from './routes/health';
import { registerAuthRoutes } from './routes/auth';
import { registerDeviceRoutes } from './routes/device';
import { registerTodoRoutes } from './routes/todos';
import { join } from 'node:path';

export function createApp(services: AppServices): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('services', services);
    await next();
  });
  app.use('*', attachPrincipal);

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerDeviceRoutes(app);
  registerTodoRoutes(app);

  // PWA static assets from /public. Unversioned URLs, so caches (browser and
  // Cloudflare) must revalidate every time or a deploy shows a stale mix.
  const publicDir = join(import.meta.dir, '..', 'public');
  const PUBLIC_FILES: Array<[route: string, file: string, headers: Record<string, string>]> = [
    ['/', 'index.html', { 'Content-Type': 'text/html; charset=utf-8' }],
    ['/sessions', 'sessions.html', { 'Content-Type': 'text/html; charset=utf-8' }],
    ['/app.js', 'app.js', { 'Content-Type': 'application/javascript' }],
    ['/styles.css', 'styles.css', { 'Content-Type': 'text/css' }],
    ['/icon.svg', 'icon.svg', { 'Content-Type': 'image/svg+xml' }],
    ['/manifest.webmanifest', 'manifest.webmanifest', { 'Content-Type': 'application/manifest+json' }],
    [
      '/sw.js',
      'sw.js',
      { 'Content-Type': 'application/javascript', 'Service-Worker-Allowed': '/' },
    ],
  ];
  for (const [route, file, headers] of PUBLIC_FILES) {
    app.get(route, () =>
      new Response(Bun.file(join(publicDir, file)), {
        headers: { ...headers, 'Cache-Control': 'no-cache' },
      }),
    );
  }

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.code, message: err.message }, err.status as 400);
    }
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    console.error(err);
    return c.json({ error: 'internal_error', message: 'Something went wrong.' }, 500);
  });

  return app;
}
