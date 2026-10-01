import type { Database } from 'bun:sqlite';
import { newId } from '../ids';
import { nowIso, daysFromNow } from '../time';
import { generateToken, hashToken } from '../tokens';
import { ApiError } from '../errors';

export const SESSION_DAYS = 30;
export const API_TOKEN_DAYS = 90;

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface IssuedSession {
  token: string;
  expiresAt: string;
}

export interface IssuedApiToken {
  token: string;
  tokenId: string;
  expiresAt: string;
}

export interface Principal {
  user: UserRow;
  kind: 'session' | 'api_token';
  sessionId?: string;
  tokenId?: string;
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface SignInPolicy {
  allowedEmails: string[];
  /** Dev auth already lets anyone in as any email, so the allowlist is moot. */
  allowAnyEmail: boolean;
}

export class AuthService {
  private readonly allowedEmails: Set<string>;

  constructor(
    private readonly db: Database,
    private readonly policy: SignInPolicy,
  ) {
    this.allowedEmails = new Set(policy.allowedEmails.map(normaliseEmail));
  }

  isEmailAllowed(email: string): boolean {
    return this.policy.allowAnyEmail || this.allowedEmails.has(normaliseEmail(email));
  }

  assertEmailAllowed(email: string): void {
    if (!this.isEmailAllowed(email)) {
      throw new ApiError('forbidden', 'This account is not allowed on this server.');
    }
  }

  findUserByEmail(email: string): UserRow | undefined {
    return this.db
      .query('SELECT * FROM users WHERE email = ?')
      .get(normaliseEmail(email)) as UserRow | undefined;
  }

  findUserById(id: string): UserRow | undefined {
    return this.db.query('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  findOrCreateUser(email: string, displayName?: string | null): UserRow {
    const normalised = normaliseEmail(email);
    if (!normalised || !normalised.includes('@')) {
      throw new ApiError('validation_failed', 'A valid email address is required.');
    }
    const existing = this.findUserByEmail(normalised);
    if (existing) {
      if (displayName && !existing.display_name) {
        this.db
          .query('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
          .run(displayName, nowIso(), existing.id);
        return this.findUserById(existing.id)!;
      }
      return existing;
    }
    const now = nowIso();
    const id = newId('usr');
    this.db
      .query(
        'INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, normalised, displayName ?? null, now, now);
    return this.findUserById(id)!;
  }

  createSession(userId: string, label?: string | null): IssuedSession {
    const token = generateToken();
    const now = nowIso();
    const expiresAt = daysFromNow(SESSION_DAYS);
    this.db
      .query(
        `INSERT INTO auth_sessions (id, user_id, token_hash, label, created_at, expires_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(newId('ses'), userId, hashToken(token), label ?? null, now, expiresAt, now);
    return { token, expiresAt };
  }

  createApiToken(userId: string, label?: string | null): IssuedApiToken {
    const token = generateToken();
    const now = nowIso();
    const expiresAt = daysFromNow(API_TOKEN_DAYS);
    const tokenId = newId('tok');
    this.db
      .query(
        `INSERT INTO api_tokens (id, user_id, token_hash, label, created_at, expires_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(tokenId, userId, hashToken(token), label ?? null, now, expiresAt, now);
    return { token, tokenId, expiresAt };
  }

  /** Resolve a bearer token or session cookie value to a principal. */
  resolveToken(raw: string): Principal | null {
    if (!raw) return null;
    const hash = hashToken(raw);
    const now = nowIso();

    const session = this.db
      .query(
        `SELECT s.id AS session_id, s.expires_at, s.revoked_at, u.*
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(hash) as
      | (UserRow & { session_id: string; expires_at: string; revoked_at: string | null })
      | undefined;

    if (session) {
      if (session.revoked_at || session.expires_at <= now) return null;
      // Slide expiry on use
      this.db
        .query('UPDATE auth_sessions SET last_used_at = ?, expires_at = ? WHERE id = ?')
        .run(now, daysFromNow(SESSION_DAYS), session.session_id);
      return {
        user: {
          id: session.id,
          email: session.email,
          display_name: session.display_name,
          created_at: session.created_at,
          updated_at: session.updated_at,
        },
        kind: 'session',
        sessionId: session.session_id,
      };
    }

    const api = this.db
      .query(
        `SELECT t.id AS token_id, t.expires_at, t.revoked_at, u.*
         FROM api_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ?`,
      )
      .get(hash) as
      | (UserRow & { token_id: string; expires_at: string; revoked_at: string | null })
      | undefined;

    if (api) {
      if (api.revoked_at || api.expires_at <= now) return null;
      this.db
        .query('UPDATE api_tokens SET last_used_at = ?, expires_at = ? WHERE id = ?')
        .run(now, daysFromNow(API_TOKEN_DAYS), api.token_id);
      return {
        user: {
          id: api.id,
          email: api.email,
          display_name: api.display_name,
          created_at: api.created_at,
          updated_at: api.updated_at,
        },
        kind: 'api_token',
        tokenId: api.token_id,
      };
    }

    return null;
  }

  listSessions(userId: string): Array<{
    id: string;
    label: string | null;
    kind: 'session' | 'api_token';
    createdAt: string;
    lastUsedAt: string;
    expiresAt: string;
  }> {
    const sessions = this.db
      .query(
        `SELECT id, label, created_at, last_used_at, expires_at FROM auth_sessions
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
         ORDER BY last_used_at DESC`,
      )
      .all(userId, nowIso()) as Array<{
      id: string;
      label: string | null;
      created_at: string;
      last_used_at: string;
      expires_at: string;
    }>;

    const tokens = this.db
      .query(
        `SELECT id, label, created_at, last_used_at, expires_at FROM api_tokens
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
         ORDER BY last_used_at DESC`,
      )
      .all(userId, nowIso()) as Array<{
      id: string;
      label: string | null;
      created_at: string;
      last_used_at: string;
      expires_at: string;
    }>;

    return [
      ...sessions.map((s) => ({
        id: s.id,
        label: s.label,
        kind: 'session' as const,
        createdAt: s.created_at,
        lastUsedAt: s.last_used_at,
        expiresAt: s.expires_at,
      })),
      ...tokens.map((t) => ({
        id: t.id,
        label: t.label,
        kind: 'api_token' as const,
        createdAt: t.created_at,
        lastUsedAt: t.last_used_at,
        expiresAt: t.expires_at,
      })),
    ];
  }

  revokeSession(userId: string, id: string): boolean {
    const now = nowIso();
    const s = this.db
      .query(
        `UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .run(now, id, userId);
    if (s.changes > 0) return true;
    const t = this.db
      .query(
        `UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .run(now, id, userId);
    return t.changes > 0;
  }
}
