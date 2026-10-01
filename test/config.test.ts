import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config';
import { testApp, json } from './helpers';

const KEYS = ['DEV_AUTH', 'NODE_ENV', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'DATA_DIR'];

describe('DEV_AUTH is opt-in only', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'todo-config-'));
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const off: Array<[string, Record<string, string>]> = [
    ['unset, no Google, NODE_ENV unset', {}],
    ['DEV_AUTH=0 without Google (docker-compose default)', { DEV_AUTH: '0' }],
    ['DEV_AUTH=false', { DEV_AUTH: 'false' }],
    ['DEV_AUTH=yes', { DEV_AUTH: 'yes' }],
    ['DEV_AUTH=TRUE (wrong case)', { DEV_AUTH: 'TRUE' }],
    ['DEV_AUTH=" 1"', { DEV_AUTH: ' 1' }],
    ['DEV_AUTH empty', { DEV_AUTH: '' }],
    ['NODE_ENV=test', { NODE_ENV: 'test' }],
    ['NODE_ENV=development without Google', { NODE_ENV: 'development' }],
  ];

  for (const [label, envs] of off) {
    test(`off: ${label}`, () => {
      Object.assign(process.env, envs);
      expect(loadConfig().devAuth).toBe(false);
    });
  }

  test('on only with DEV_AUTH=1 or true', () => {
    process.env.DEV_AUTH = '1';
    expect(loadConfig().devAuth).toBe(true);
    process.env.DEV_AUTH = 'true';
    expect(loadConfig().devAuth).toBe(true);
  });
});

describe('ALLOWED_EMAILS parsing', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.ALLOWED_EMAILS;
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'todo-config-'));
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOWED_EMAILS;
    else process.env.ALLOWED_EMAILS = saved;
  });

  test('unset means nobody', () => {
    delete process.env.ALLOWED_EMAILS;
    expect(loadConfig().allowedEmails).toEqual([]);
  });

  test('only separators means nobody', () => {
    process.env.ALLOWED_EMAILS = ' , ,\n,';
    expect(loadConfig().allowedEmails).toEqual([]);
  });

  test('commas, spaces and newlines, lowercased', () => {
    process.env.ALLOWED_EMAILS = ' A@x.com,b@X.com\n  c@x.com ,';
    expect(loadConfig().allowedEmails).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });
});

describe('/api/auth/dev when dev auth is off', () => {
  test('refuses to sign in as an arbitrary email', async () => {
    const { app } = testApp({ devAuth: false });
    const res = await json(app, 'POST', '/api/auth/dev', { body: { email: 'victim@gmail.com' } });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((res.data as { token?: string }).token).toBeUndefined();
  });

  test('methods endpoint does not advertise dev sign-in', async () => {
    const { app } = testApp({ devAuth: false });
    const res = await json(app, 'GET', '/api/auth/methods');
    expect((res.data as { dev: boolean }).dev).toBe(false);
  });

  test('login page has no dev button', async () => {
    const { app } = testApp({ devAuth: false });
    const html = await (await app.request('/login')).text();
    expect(html).not.toContain('Continue as dev');
  });
});
