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

  // PWA static assets from /public
  const publicDir = join(import.meta.dir, '..', 'public');

  app.get('/manifest.webmanifest', async (c) => {
    const file = Bun.file(join(publicDir, 'manifest.webmanifest'));
    return new Response(file, {
      headers: { 'Content-Type': 'application/manifest+json' },
    });
  });

  app.get('/sw.js', async (c) => {
    const file = Bun.file(join(publicDir, 'sw.js'));
    return new Response(file, {
      headers: {
        'Content-Type': 'application/javascript',
        'Service-Worker-Allowed': '/',
      },
    });
  });

  app.get('/styles.css', async (c) => {
    return new Response(Bun.file(join(publicDir, 'styles.css')), {
      headers: { 'Content-Type': 'text/css' },
    });
  });

  app.get('/app.js', async (c) => {
    return new Response(Bun.file(join(publicDir, 'app.js')), {
      headers: { 'Content-Type': 'application/javascript' },
    });
  });

  app.get('/icon.svg', async (c) => {
    return new Response(Bun.file(join(publicDir, 'icon.svg')), {
      headers: { 'Content-Type': 'image/svg+xml' },
    });
  });

  app.get('/', async (c) => {
    return new Response(Bun.file(join(publicDir, 'index.html')), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  });

  app.get('/sessions', async (c) => {
    return new Response(Bun.file(join(publicDir, 'sessions.html')), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  });

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
