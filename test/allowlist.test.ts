import { describe, expect, test } from 'bun:test';
import type { GoogleIdentity } from '../src/auth/google';
import { testApp, json } from './helpers';

/** App with Google "configured" and a fake token exchange returning `identity`. */
function googleApp(allowedEmails: string[], identity: GoogleIdentity) {
  const ctx = testApp({ devAuth: false, allowedEmails });
  ctx.config.google = { clientId: 'cid', clientSecret: 'csecret' };
  ctx.services.google = { exchangeCode: async () => identity };
  return ctx;
}

async function googleSignIn(app: ReturnType<typeof testApp>['app']) {
  const start = await app.request('/api/auth/google/start');
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const nonceCookie = start.headers.get('set-cookie')!.split(';')[0]!;
  return app.request(`/api/auth/google/callback?code=c&state=${encodeURIComponent(state)}`, {
    headers: { Cookie: nonceCookie },
  });
}

function sessionCookieOf(res: Response): string | undefined {
  return res.headers
    .getSetCookie()
    .find((c) => c.startsWith('todo_session=') && !c.startsWith('todo_session=;'));
}

function userCount(ctx: ReturnType<typeof testApp>): number {
  return (ctx.db.query('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

const verified = (email: string): GoogleIdentity => ({
  email,
  emailVerified: true,
  displayName: null,
});

describe('Google sign-in allowlist', () => {
  test('empty allowlist refuses everyone and creates no user', async () => {
    const ctx = googleApp([], verified('pierre@example.com'));
    const res = await googleSignIn(ctx.app);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toStartWith('/login?error=');
    expect(sessionCookieOf(res)).toBeUndefined();
    expect(userCount(ctx)).toBe(0);
  });

  const refused = [
    'other@example.com',
    'pierre@example.com.evil.com',
    'evil-pierre@example.com',
    'pierre@example.co',
    'pierre+x@example.com',
  ];
  for (const email of refused) {
    test(`refuses lookalike ${JSON.stringify(email)}`, async () => {
      const ctx = googleApp(['pierre@example.com'], verified(email));
      const res = await googleSignIn(ctx.app);
      expect(sessionCookieOf(res)).toBeUndefined();
      expect(userCount(ctx)).toBe(0);
    });
  }

  test('allowed email is matched case-insensitively', async () => {
    const ctx = googleApp(['Pierre@Example.com'], verified('PIERRE@example.COM'));
    const res = await googleSignIn(ctx.app);
    expect(res.headers.get('location')).toBe('/');
    expect(sessionCookieOf(res)).toBeDefined();
  });

  test('allowed but unverified email is still refused', async () => {
    const ctx = googleApp(['pierre@example.com'], {
      email: 'pierre@example.com',
      emailVerified: false,
      displayName: null,
    });
    const res = await googleSignIn(ctx.app);
    expect(sessionCookieOf(res)).toBeUndefined();
  });

  test('existing user removed from the list cannot sign in again', async () => {
    const ctx = googleApp([], verified('pierre@example.com'));
    ctx.services.auth.findOrCreateUser('pierre@example.com');
    const res = await googleSignIn(ctx.app);
    expect(sessionCookieOf(res)).toBeUndefined();
  });

  test('refusal message is escaped on the login page', async () => {
    const ctx = googleApp([], verified('<img src=x onerror=alert(1)>@example.com'));
    const res = await googleSignIn(ctx.app);
    const page = await ctx.app.request(res.headers.get('location')!);
    const html = await page.text();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('device approval allowlist', () => {
  function sessionFor(ctx: ReturnType<typeof testApp>, email: string): string {
    const user = ctx.services.auth.findOrCreateUser(email);
    return `todo_session=${ctx.services.auth.createSession(user.id).token}`;
  }

  test('user not on the list cannot approve, and the CLI gets no token', async () => {
    const ctx = testApp({ devAuth: false, allowedEmails: ['pierre@example.com'] });
    const cookie = sessionFor(ctx, 'removed@example.com');
    const start = await json(ctx.app, 'POST', '/api/auth/device', { body: {} });
    const { userCode, deviceCode } = start.data as { userCode: string; deviceCode: string };

    const approve = await json(ctx.app, 'POST', '/api/auth/device/approve', {
      cookie,
      body: { userCode, approve: true },
    });
    expect(approve.status).toBe(403);

    const poll = await json(ctx.app, 'POST', '/api/auth/device/token', { body: { deviceCode } });
    expect(poll.status).toBe(202);
    expect((poll.data as { token?: string }).token).toBeUndefined();
  });

  test('user on the list can approve', async () => {
    const ctx = testApp({ devAuth: false, allowedEmails: ['pierre@example.com'] });
    const cookie = sessionFor(ctx, 'Pierre@Example.com');
    const start = await json(ctx.app, 'POST', '/api/auth/device', { body: {} });
    const { userCode } = start.data as { userCode: string };
    const approve = await json(ctx.app, 'POST', '/api/auth/device/approve', {
      cookie,
      body: { userCode, approve: true },
    });
    expect(approve.status).toBe(200);
  });
});
