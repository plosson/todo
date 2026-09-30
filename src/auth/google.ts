import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { GoogleConfig } from '../config';
import { ApiError } from '../errors';

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
  displayName: string | null;
}

export interface GoogleClient {
  exchangeCode(code: string, redirectUri: string): Promise<GoogleIdentity>;
}

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export function createGoogleClient(config: GoogleConfig): GoogleClient {
  return {
    async exchangeCode(code, redirectUri) {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!response.ok) {
        throw new ApiError('unauthenticated', 'Google would not complete the sign-in. Try again.');
      }

      const body = (await response.json()) as { id_token?: string };
      if (!body.id_token) {
        throw new ApiError('unauthenticated', 'Google did not return an identity token.');
      }

      const claims = decodeIdTokenPayload(body.id_token);
      if (!claims.email) {
        throw new ApiError(
          'unauthenticated',
          'Google did not share an email address, which is what this instance signs you in with.',
        );
      }

      return {
        email: claims.email,
        emailVerified: claims.email_verified === true || claims.email_verified === 'true',
        displayName: claims.name ?? null,
      };
    },
  };
}

interface IdTokenClaims {
  email?: string;
  email_verified?: boolean | string;
  name?: string;
}

function decodeIdTokenPayload(idToken: string): IdTokenClaims {
  const payload = idToken.split('.')[1];
  if (!payload) throw new ApiError('unauthenticated', 'Google returned a malformed token.');
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as IdTokenClaims;
  } catch {
    throw new ApiError('unauthenticated', 'Google returned a token we could not read.');
  }
}

export function buildAuthorisationUrl(input: {
  config: GoogleConfig;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', input.config.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', input.state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export function signState(secret: string, payload: { nonce: string; redirectTo: string }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(
  secret: string,
  state: string,
): { nonce: string; redirectTo: string } | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  try {
    if (
      expected.length !== sig.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      nonce: string;
      redirectTo: string;
    };
  } catch {
    return null;
  }
}

export function newNonce(): string {
  return randomBytes(16).toString('base64url');
}
