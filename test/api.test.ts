import { describe, expect, test } from 'bun:test';
import { testApp, json, signInDev } from './helpers';

describe('todos API', () => {
  test('health', async () => {
    const { app } = testApp();
    const res = await json(app, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect((res.data as { ok: boolean }).ok).toBe(true);
  });

  test('requires auth', async () => {
    const { app } = testApp();
    const res = await json(app, 'GET', '/api/todos');
    expect(res.status).toBe(401);
  });

  test('create list check filter delete', async () => {
    const { app } = testApp();
    const { token } = await signInDev(app);

    const created = await json(app, 'POST', '/api/todos', {
      token,
      body: { title: 'Buy milk', tags: ['errands', 'home'] },
    });
    expect(created.status).toBe(201);
    const todo = created.data as { id: string; title: string; tags: string[]; done: boolean };
    expect(todo.title).toBe('Buy milk');
    expect(todo.tags).toEqual(['errands', 'home']);
    expect(todo.done).toBe(false);
    expect(todo.id.startsWith('tod_')).toBe(true);

    const listOpen = await json(app, 'GET', '/api/todos?status=open', { token });
    expect(listOpen.status).toBe(200);
    expect((listOpen.data as { todos: unknown[] }).todos).toHaveLength(1);

    const byTag = await json(app, 'GET', '/api/todos?tag=errands&status=open', { token });
    expect((byTag.data as { todos: unknown[] }).todos).toHaveLength(1);

    const noTag = await json(app, 'GET', '/api/todos?tag=agentio&status=open', { token });
    expect((noTag.data as { todos: unknown[] }).todos).toHaveLength(0);

    const checked = await json(app, 'POST', `/api/todos/${todo.id}/check`, { token });
    expect(checked.status).toBe(200);
    expect((checked.data as { done: boolean }).done).toBe(true);

    const listDone = await json(app, 'GET', '/api/todos?status=done', { token });
    expect((listDone.data as { todos: unknown[] }).todos).toHaveLength(1);

    const listOpen2 = await json(app, 'GET', '/api/todos?status=open', { token });
    expect((listOpen2.data as { todos: unknown[] }).todos).toHaveLength(0);

    await json(app, 'POST', `/api/todos/${todo.id}/uncheck`, { token });
    const patched = await json(app, 'PATCH', `/api/todos/${todo.id}`, {
      token,
      body: { title: 'Buy oat milk', tags: ['errands'] },
    });
    expect((patched.data as { title: string; tags: string[] }).title).toBe('Buy oat milk');
    expect((patched.data as { tags: string[] }).tags).toEqual(['errands']);

    const tags = await json(app, 'GET', '/api/tags', { token });
    expect((tags.data as { tags: Array<{ name: string }> }).tags.map((t) => t.name)).toContain(
      'errands',
    );

    const del = await json(app, 'DELETE', `/api/todos/${todo.id}`, { token });
    expect(del.status).toBe(200);
    const gone = await json(app, 'GET', `/api/todos/${todo.id}`, { token });
    expect(gone.status).toBe(404);
  });

  test('isolation between users', async () => {
    const { app } = testApp();
    const a = await signInDev(app, 'a@example.com');
    const b = await signInDev(app, 'b@example.com');
    const created = await json(app, 'POST', '/api/todos', {
      token: a.token,
      body: { title: 'Secret' },
    });
    const id = (created.data as { id: string }).id;
    const other = await json(app, 'GET', `/api/todos/${id}`, { token: b.token });
    expect(other.status).toBe(404);
  });
});

describe('list limit', () => {
  const bad = ['abc', '', '-1', '1.5', '1e3', ' 5', '5 ', '0x10', 'NaN', 'Infinity', '9999999', '١٢'];
  for (const raw of bad) {
    test(`rejects limit=${JSON.stringify(raw)} with 400, not 500`, async () => {
      const { app } = testApp();
      const { token } = await signInDev(app);
      const res = await json(app, 'GET', `/api/todos?limit=${encodeURIComponent(raw)}`, { token });
      expect(res.status).toBe(400);
      expect((res.data as { error: string }).error).toBe('validation_failed');
    });
  }

  test('limit is clamped to the 1..500 range', async () => {
    const { app } = testApp();
    const { token } = await signInDev(app);
    for (let i = 0; i < 3; i += 1) {
      await json(app, 'POST', '/api/todos', { token, body: { title: `t${i}` } });
    }
    const zero = await json(app, 'GET', '/api/todos?limit=0', { token });
    expect((zero.data as { todos: unknown[] }).todos).toHaveLength(1);
    const two = await json(app, 'GET', '/api/todos?limit=2', { token });
    expect((two.data as { todos: unknown[] }).todos).toHaveLength(2);
    const huge = await json(app, 'GET', '/api/todos?limit=999999', { token });
    expect((huge.data as { todos: unknown[] }).todos).toHaveLength(3);
  });
});
