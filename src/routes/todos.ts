import type { Hono } from 'hono';
import type { AppEnv } from '../context';
import { requireUser, currentUser, currentVia } from '../middleware/auth';
import { ApiError } from '../errors';

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await req.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function registerTodoRoutes(app: Hono<AppEnv>): void {
  app.get('/api/todos', requireUser, (c) => {
    const { todos } = c.get('services');
    const user = currentUser(c);
    const tag = c.req.query('tag') ?? undefined;
    const statusRaw = c.req.query('status') ?? 'open';
    const status =
      statusRaw === 'done' || statusRaw === 'all' || statusRaw === 'open' ? statusRaw : 'open';
    const limitRaw = c.req.query('limit');
    if (limitRaw !== undefined && !/^\d{1,6}$/.test(limitRaw)) {
      throw new ApiError('validation_failed', 'limit must be a whole number.');
    }
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
    return c.json({ todos: todos.list(user.id, { tag, status, limit }) });
  });

  app.post('/api/todos', requireUser, async (c) => {
    const { todos } = c.get('services');
    const user = currentUser(c);
    const body = await readJson(c.req.raw);
    if (typeof body.title !== 'string') {
      throw new ApiError('validation_failed', 'title is required.');
    }
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((t): t is string => typeof t === 'string')
      : undefined;
    const notes = typeof body.notes === 'string' ? body.notes : undefined;
    const created = todos.create(user.id, { title: body.title, tags, notes }, currentVia(c));
    return c.json(created, 201);
  });

  app.get('/api/todos/:id', requireUser, (c) => {
    const { todos } = c.get('services');
    const user = currentUser(c);
    return c.json(todos.get(user.id, c.req.param('id')));
  });

  app.patch('/api/todos/:id', requireUser, async (c) => {
    const { todos } = c.get('services');
    const user = currentUser(c);
    const body = await readJson(c.req.raw);
    const patch: {
      title?: string;
      notes?: string | null;
      tags?: string[];
      done?: boolean;
    } = {};
    if (typeof body.title === 'string') patch.title = body.title;
    if (body.notes === null || typeof body.notes === 'string') patch.notes = body.notes as string | null;
    if (Array.isArray(body.tags)) {
      patch.tags = body.tags.filter((t): t is string => typeof t === 'string');
    }
    if (typeof body.done === 'boolean') patch.done = body.done;
    return c.json(todos.update(user.id, c.req.param('id'), patch, currentVia(c)));
  });

  app.post('/api/todos/:id/check', requireUser, (c) => {
    const { todos } = c.get('services');
    const user = currentUser(c);
    return c.json(todos.check(user.id, c.req.param('id'), currentVia(c)));
  });

  app.post('/api/todos/:id/uncheck', requireUser, (c) => {
    const { todos } = c.get('services');
    const user = currentUser(c);
    return c.json(todos.uncheck(user.id, c.req.param('id'), currentVia(c)));
  });

  app.delete('/api/todos/:id', requireUser, (c) => {
    const { todos } = c.get('services');
    const user = currentUser(c);
    todos.remove(user.id, c.req.param('id'));
    return c.json({ deleted: true });
  });

  app.get('/api/tags', requireUser, (c) => {
    const { todos } = c.get('services');
    const user = currentUser(c);
    return c.json({ tags: todos.listTags(user.id) });
  });

  app.delete('/api/tags/:name', requireUser, (c) => {
    const { todos } = c.get('services');
    const user = currentUser(c);
    todos.deleteTag(user.id, c.req.param('name'));
    return c.json({ deleted: true });
  });
}
