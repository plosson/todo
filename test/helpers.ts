import { openMemoryDatabase } from '../src/db';
import { loadConfig } from '../src/config';
import { createServices } from '../src/context';
import { createApp } from '../src/app';
import type { Hono } from 'hono';
import type { AppEnv } from '../src/context';

export function testApp(
  overrides: { baseUrl?: string; devAuth?: boolean; allowedEmails?: string[] } = {},
) {
  const db = openMemoryDatabase();
  const config = loadConfig({
    baseUrl: overrides.baseUrl ?? 'http://localhost:8787',
    databasePath: ':memory:',
    sessionSecret: 'test-secret-not-for-production',
    google: null,
    devAuth: overrides.devAuth ?? true,
    allowedEmails: overrides.allowedEmails ?? [],
    port: 8787,
    dataDir: '/tmp/todo-test',
  });
  const services = createServices(config, db);
  const app = createApp(services);
  return { app, services, db, config };
}

export async function json(
  app: Hono<AppEnv>,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string; cookie?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.Cookie = opts.cookie;
  const res = await app.request(path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers, res };
}

export async function signInDev(app: Hono<AppEnv>, email = 'pierre@example.com') {
  const res = await json(app, 'POST', '/api/auth/dev', {
    body: { email, displayName: 'Pierre' },
  });
  if (res.status !== 200) throw new Error(`dev auth failed: ${res.status}`);
  const token = (res.data as { token: string }).token;
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { token, cookie: setCookie.split(';')[0]!, email };
}

/** Run the device flow end to end and return the issued API token, as AgentIO would. */
export async function signInDevice(app: Hono<AppEnv>, cookie: string, label: string) {
  const start = await json(app, 'POST', '/api/auth/device', { body: { label } });
  const { deviceCode, userCode } = start.data as { deviceCode: string; userCode: string };
  await json(app, 'POST', '/api/auth/device/approve', { cookie, body: { userCode, approve: true } });
  const res = await json(app, 'POST', '/api/auth/device/token', { body: { deviceCode } });
  if (res.status !== 200) throw new Error(`device sign-in failed: ${res.status}`);
  return (res.data as { token: string }).token;
}
