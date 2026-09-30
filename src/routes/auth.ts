import type { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import type { AppEnv } from '../context';
import { requireUser, currentUser, SESSION_COOKIE } from '../middleware/auth';
import { ApiError } from '../errors';
import {
  buildAuthorisationUrl,
  signState,
  verifyState,
  newNonce,
} from '../auth/google';

const GOOGLE_STATE_COOKIE = 'todo_google_state';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await req.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function safeRedirect(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw;
}

function setSessionCookie(c: Parameters<Parameters<Hono<AppEnv>['post']>[1]>[0], token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
    secure: c.get('services').config.baseUrl.startsWith('https://'),
  });
}

export function registerAuthRoutes(app: Hono<AppEnv>): void {
  app.get('/api/auth/methods', (c) => {
    const { config } = c.get('services');
    return c.json({
      google: config.google !== null,
      dev: config.devAuth,
    });
  });

  app.get('/api/auth/me', requireUser, (c) => {
    const user = currentUser(c);
    return c.json({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      createdAt: user.created_at,
    });
  });

  app.post('/api/auth/logout', (c) => {
    const { auth } = c.get('services');
    const principal = c.get('principal');
    if (principal?.sessionId) auth.revokeSession(principal.user.id, principal.sessionId);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/auth/sessions', requireUser, (c) => {
    const { auth } = c.get('services');
    const user = currentUser(c);
    return c.json({ sessions: auth.listSessions(user.id) });
  });

  app.delete('/api/auth/sessions/:id', requireUser, (c) => {
    const { auth } = c.get('services');
    const user = currentUser(c);
    const ok = auth.revokeSession(user.id, c.req.param('id'));
    if (!ok) throw new ApiError('not_found', 'Session not found.');
    return c.json({ revoked: true });
  });

  /** Dev / test bypass — only when DEV_AUTH is enabled. */
  app.post('/api/auth/dev', async (c) => {
    const { config, auth } = c.get('services');
    if (!config.devAuth) {
      throw new ApiError('forbidden', 'Dev auth is disabled.');
    }
    const body = await readJson(c.req.raw);
    const email =
      typeof body.email === 'string' && body.email.includes('@')
        ? body.email
        : 'dev@localhost';
    const displayName = typeof body.displayName === 'string' ? body.displayName : 'Dev User';
    const user = auth.findOrCreateUser(email, displayName);
    const session = auth.createSession(user.id, 'dev-auth');
    setSessionCookie(c, session.token);
    return c.json({
      ok: true,
      email: user.email,
      token: session.token,
      expiresAt: session.expiresAt,
    });
  });

  app.get('/api/auth/google/start', (c) => {
    const { config } = c.get('services');
    if (!config.google) {
      throw new ApiError('validation_failed', 'Google sign-in is not configured.');
    }
    const redirectTo = safeRedirect(c.req.query('redirectTo'));
    const nonce = newNonce();
    const state = signState(config.sessionSecret, { nonce, redirectTo });
    setCookie(c, GOOGLE_STATE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
      secure: config.baseUrl.startsWith('https://'),
    });
    const redirectUri = `${config.baseUrl}/api/auth/google/callback`;
    const url = buildAuthorisationUrl({
      config: config.google,
      redirectUri,
      state,
    });
    return c.redirect(url, 302);
  });

  app.get('/api/auth/google/callback', async (c) => {
    const { config, auth, google } = c.get('services');
    if (!config.google || !google) {
      throw new ApiError('validation_failed', 'Google sign-in is not configured.');
    }

    const error = c.req.query('error');
    if (error) {
      return c.redirect(`/login?error=${encodeURIComponent(error)}`, 302);
    }

    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) {
      throw new ApiError('validation_failed', 'Missing code or state from Google.');
    }

    const parsed = verifyState(config.sessionSecret, state);
    const cookieNonce = getCookie(c, GOOGLE_STATE_COOKIE);
    deleteCookie(c, GOOGLE_STATE_COOKIE, { path: '/' });
    if (!parsed || !cookieNonce || parsed.nonce !== cookieNonce) {
      throw new ApiError('unauthenticated', 'Google sign-in state mismatch. Try again.');
    }

    const redirectUri = `${config.baseUrl}/api/auth/google/callback`;
    const identity = await google.exchangeCode(code, redirectUri);
    if (!identity.emailVerified) {
      throw new ApiError('unauthenticated', 'Google email is not verified.');
    }

    const user = auth.findOrCreateUser(identity.email, identity.displayName);
    const session = auth.createSession(user.id, 'google');
    setSessionCookie(c, session.token);
    return c.redirect(safeRedirect(parsed.redirectTo), 302);
  });

  /** Simple login page (also used for device approval redirect). */
  app.get('/login', (c) => {
    const { config } = c.get('services');
    const principal = c.get('principal');
    const redirectTo = safeRedirect(c.req.query('redirectTo'));
    if (principal) return c.redirect(redirectTo, 302);

    const error = c.req.query('error');
    const googleBtn = config.google
      ? `<a class="btn primary" href="/api/auth/google/start?redirectTo=${encodeURIComponent(redirectTo)}">Continue with Google</a>`
      : '';
    const devBtn = config.devAuth
      ? `<button type="button" class="btn secondary" id="dev-login">Continue as dev</button>`
      : '';

    return c.html(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Todo</title>
<link rel="stylesheet" href="/styles.css">
</head><body class="auth">
<main class="card">
  <h1>Todo</h1>
  <p class="muted">Sign in to manage your list.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  <div class="stack">${googleBtn}${devBtn}</div>
  ${!config.google && !config.devAuth ? '<p class="muted">No sign-in methods configured. Set GOOGLE_CLIENT_ID/SECRET or DEV_AUTH=1.</p>' : ''}
</main>
<script>
document.getElementById('dev-login')?.addEventListener('click', async () => {
  const res = await fetch('/api/auth/dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'dev@localhost', displayName: 'Dev User' }),
  });
  if (res.ok) location.href = ${JSON.stringify(redirectTo)};
  else alert('Dev login failed');
});
</script>
</body></html>`);
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
