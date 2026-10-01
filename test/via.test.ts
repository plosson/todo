import { describe, expect, test } from 'bun:test';
import { testApp, json, signInDev, signInDevice } from './helpers';

interface Via {
  id: string;
  kind: 'session' | 'api_token';
  label: string | null;
}
interface TodoOut {
  id: string;
  done: boolean;
  doneAt: string | null;
  createdVia: Via | null;
  doneVia: Via | null;
}

/** A human on the PWA (session cookie) and an agent (device token) on the same account. */
async function setup() {
  const { app, services } = testApp();
  const human = await signInDev(app);
  const agentToken = await signInDevice(app, human.cookie, 'agentio on laptop');
  return { app, services, cookie: human.cookie, agentToken };
}

describe('createdVia', () => {
  test('records the browser session', async () => {
    const { app, cookie } = await setup();
    const res = await json(app, 'POST', '/api/todos', { cookie, body: { title: 'From phone' } });
    const todo = res.data as TodoOut;
    expect(todo.createdVia).toMatchObject({ kind: 'session', label: 'dev-auth' });
    expect(todo.createdVia!.id).toStartWith('ses_');
    expect(todo.doneVia).toBeNull();
  });

  test('records the agent token and its label', async () => {
    const { app, agentToken } = await setup();
    const res = await json(app, 'POST', '/api/todos', {
      token: agentToken,
      body: { title: 'From agent' },
    });
    const todo = res.data as TodoOut;
    expect(todo.createdVia).toMatchObject({ kind: 'api_token', label: 'agentio on laptop' });
    expect(todo.createdVia!.id).toStartWith('tok_');
  });

  test('cannot be forged from the request body', async () => {
    const { app, cookie, agentToken } = await setup();
    const forged = 'tok_forged';
    const res = await json(app, 'POST', '/api/todos', {
      token: agentToken,
      body: {
        title: 'Forged',
        createdVia: { id: forged, kind: 'session', label: 'me' },
        created_via: forged,
        doneVia: forged,
        done_via: forged,
      },
    });
    const todo = res.data as TodoOut;
    expect(todo.createdVia!.kind).toBe('api_token');
    expect(todo.createdVia!.id).not.toBe(forged);
    expect(todo.doneVia).toBeNull();

    const patched = await json(app, 'PATCH', `/api/todos/${todo.id}`, {
      cookie,
      body: { createdVia: forged, created_via: forged, doneVia: forged, done_via: forged },
    });
    expect((patched.data as TodoOut).createdVia!.id).toBe(todo.createdVia!.id);
    expect((patched.data as TodoOut).doneVia).toBeNull();
  });

  test('survives revoking the token that created it', async () => {
    const { app, cookie, agentToken } = await setup();
    const created = await json(app, 'POST', '/api/todos', {
      token: agentToken,
      body: { title: 'x' },
    });
    const todo = created.data as TodoOut;
    await json(app, 'DELETE', `/api/auth/sessions/${todo.createdVia!.id}`, { cookie });
    const after = await json(app, 'GET', `/api/todos/${todo.id}`, { cookie });
    expect((after.data as TodoOut).createdVia).toEqual(todo.createdVia);
  });
});

describe('doneVia', () => {
  test('records who checked it off', async () => {
    const { app, cookie, agentToken } = await setup();
    const { id } = (await json(app, 'POST', '/api/todos', { cookie, body: { title: 'x' } }))
      .data as TodoOut;
    const checked = await json(app, 'POST', `/api/todos/${id}/check`, { token: agentToken });
    expect((checked.data as TodoOut).doneVia).toMatchObject({
      kind: 'api_token',
      label: 'agentio on laptop',
    });
  });

  test('checking again does not overwrite the first checker or time', async () => {
    const { app, cookie, agentToken } = await setup();
    const { id } = (await json(app, 'POST', '/api/todos', { cookie, body: { title: 'x' } }))
      .data as TodoOut;
    const first = (await json(app, 'POST', `/api/todos/${id}/check`, { token: agentToken }))
      .data as TodoOut;
    const again = (await json(app, 'POST', `/api/todos/${id}/check`, { cookie })).data as TodoOut;
    const viaPatch = (
      await json(app, 'PATCH', `/api/todos/${id}`, { cookie, body: { done: true } })
    ).data as TodoOut;
    for (const t of [again, viaPatch]) {
      expect(t.doneVia).toEqual(first.doneVia);
      expect(t.doneAt).toBe(first.doneAt);
    }
  });

  test('uncheck clears it, and a new check records the new checker', async () => {
    const { app, cookie, agentToken } = await setup();
    const { id } = (await json(app, 'POST', '/api/todos', { cookie, body: { title: 'x' } }))
      .data as TodoOut;
    await json(app, 'POST', `/api/todos/${id}/check`, { token: agentToken });
    const unchecked = (await json(app, 'POST', `/api/todos/${id}/uncheck`, { cookie }))
      .data as TodoOut;
    expect(unchecked.doneVia).toBeNull();
    expect(unchecked.doneAt).toBeNull();

    const rechecked = (await json(app, 'POST', `/api/todos/${id}/check`, { cookie }))
      .data as TodoOut;
    expect(rechecked.doneVia!.kind).toBe('session');
  });

  test('PATCH done:false clears it; editing the title keeps both', async () => {
    const { app, cookie, agentToken } = await setup();
    const { id } = (await json(app, 'POST', '/api/todos', { token: agentToken, body: { title: 'x' } }))
      .data as TodoOut;
    const checked = (await json(app, 'POST', `/api/todos/${id}/check`, { token: agentToken }))
      .data as TodoOut;

    const renamed = (
      await json(app, 'PATCH', `/api/todos/${id}`, { cookie, body: { title: 'renamed' } })
    ).data as TodoOut;
    expect(renamed.createdVia).toEqual(checked.createdVia);
    expect(renamed.doneVia).toEqual(checked.doneVia);

    const reopened = (
      await json(app, 'PATCH', `/api/todos/${id}`, { cookie, body: { done: false } })
    ).data as TodoOut;
    expect(reopened.doneVia).toBeNull();
    expect(reopened.createdVia).toEqual(checked.createdVia);
  });
});

describe('list', () => {
  test('includes via fields, with and without a tag filter, without duplicate rows', async () => {
    const { app, cookie, agentToken } = await setup();
    await json(app, 'POST', '/api/todos', { cookie, body: { title: 'a', tags: ['x', 'y'] } });
    const b = (
      await json(app, 'POST', '/api/todos', { token: agentToken, body: { title: 'b', tags: ['x'] } })
    ).data as TodoOut;
    await json(app, 'POST', `/api/todos/${b.id}/check`, { cookie });

    const all = (await json(app, 'GET', '/api/todos?status=all', { cookie })).data as {
      todos: TodoOut[];
    };
    expect(all.todos).toHaveLength(2);
    const tagged = (await json(app, 'GET', '/api/todos?status=all&tag=x', { cookie })).data as {
      todos: TodoOut[];
    };
    expect(tagged.todos).toHaveLength(2);
    const listedB = tagged.todos.find((t) => t.id === b.id)!;
    expect(listedB.createdVia!.kind).toBe('api_token');
    expect(listedB.doneVia!.kind).toBe('session');
  });
});
