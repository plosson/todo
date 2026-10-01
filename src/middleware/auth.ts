import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../context';
import { ApiError } from '../errors';

export const SESSION_COOKIE = 'todo_session';

export const attachPrincipal: MiddlewareHandler<AppEnv> = async (c, next) => {
  const services = c.get('services');
  let token: string | undefined;

  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    token = auth.slice('Bearer '.length).trim();
  } else {
    token = getCookie(c, SESSION_COOKIE);
  }

  const principal = token ? services.auth.resolveToken(token) : null;
  c.set('principal', principal);
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const principal = c.get('principal');
  if (!principal) throw new ApiError('unauthenticated', 'Sign in required.');
  await next();
};

export function currentUser(c: { get: (k: 'principal') => AppEnv['Variables']['principal'] }) {
  const principal = c.get('principal');
  if (!principal) throw new ApiError('unauthenticated', 'Sign in required.');
  return principal.user;
}

/** Id of the session or API token behind this request, for recording who did what. */
export function currentVia(c: { get: (k: 'principal') => AppEnv['Variables']['principal'] }) {
  const principal = c.get('principal');
  return principal?.sessionId ?? principal?.tokenId ?? null;
}
