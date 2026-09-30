import type { Database } from 'bun:sqlite';
import { newId } from '../ids';
import { nowIso, minutesFromNow } from '../time';
import { generateToken, hashToken, generateUserCode, normaliseUserCode } from '../tokens';
import { ApiError } from '../errors';
import type { AuthService, IssuedApiToken } from './service';

export const DEVICE_CODE_MINUTES = 10;
export const DEVICE_POLL_INTERVAL_SECONDS = 2;

export interface StartedDeviceLogin {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export type DevicePollResult =
  | { state: 'pending' }
  | { state: 'denied' }
  | { state: 'expired' }
  | { state: 'approved'; token: IssuedApiToken };

interface DeviceCodeRow {
  id: string;
  device_code_hash: string;
  user_code: string;
  label: string | null;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  approved_by_user_id: string | null;
  claimed_at: string | null;
  denied_at: string | null;
}

export class DeviceFlowService {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
    private readonly baseUrl: string,
  ) {}

  start(label?: string | null): StartedDeviceLogin {
    const deviceCode = generateToken();
    const userCode = this.uniqueUserCode();
    this.db
      .query(
        `INSERT INTO device_codes
         (id, device_code_hash, user_code, label, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId('dev'),
        hashToken(deviceCode),
        userCode,
        label ?? null,
        nowIso(),
        minutesFromNow(DEVICE_CODE_MINUTES),
      );

    return {
      deviceCode,
      userCode,
      verificationUrl: `${this.baseUrl}/auth/device?code=${encodeURIComponent(userCode)}`,
      expiresInSeconds: DEVICE_CODE_MINUTES * 60,
      intervalSeconds: DEVICE_POLL_INTERVAL_SECONDS,
    };
  }

  poll(deviceCode: string): DevicePollResult {
    const record = this.db
      .query('SELECT * FROM device_codes WHERE device_code_hash = ?')
      .get(hashToken(deviceCode)) as DeviceCodeRow | undefined;

    if (!record) {
      throw new ApiError(
        'unauthenticated',
        'This sign-in is not one this server knows about. Start the todo sign-in again.',
      );
    }

    if (record.denied_at !== null) return { state: 'denied' };
    if (record.claimed_at !== null) {
      throw new ApiError(
        'unauthenticated',
        'This sign-in has already been completed. Start the todo sign-in again.',
      );
    }
    if (record.expires_at <= nowIso()) return { state: 'expired' };
    if (record.approved_at === null || record.approved_by_user_id === null) {
      return { state: 'pending' };
    }

    const claimed = this.db
      .query(
        `UPDATE device_codes SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL`,
      )
      .run(nowIso(), record.id);
    if (claimed.changes === 0) return { state: 'pending' };

    const token = this.auth.createApiToken(record.approved_by_user_id, record.label);
    return { state: 'approved', token };
  }

  findByUserCode(userCode: string): DeviceCodeRow | undefined {
    return this.db
      .query('SELECT * FROM device_codes WHERE user_code = ?')
      .get(normaliseUserCode(userCode)) as DeviceCodeRow | undefined;
  }

  approve(userCode: string, userId: string): void {
    const record = this.requirePending(userCode);
    this.db
      .query(
        `UPDATE device_codes SET approved_at = ?, approved_by_user_id = ? WHERE id = ?`,
      )
      .run(nowIso(), userId, record.id);
  }

  deny(userCode: string): void {
    const record = this.requirePending(userCode);
    this.db
      .query(`UPDATE device_codes SET denied_at = ? WHERE id = ?`)
      .run(nowIso(), record.id);
  }

  private requirePending(userCode: string): DeviceCodeRow {
    const record = this.findByUserCode(userCode);
    if (!record) {
      throw new ApiError(
        'not_found',
        'That code does not match anything. Check the code your terminal is showing.',
      );
    }
    if (record.expires_at <= nowIso()) {
      throw new ApiError(
        'validation_failed',
        'That code has expired. Start the todo sign-in again to get a new one.',
      );
    }
    if (record.approved_at !== null || record.denied_at !== null) {
      throw new ApiError('validation_failed', 'That code has already been answered.');
    }
    return record;
  }

  private uniqueUserCode(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = generateUserCode();
      if (!this.findByUserCode(candidate)) return candidate;
    }
    throw new ApiError('internal_error', 'Could not allocate a sign-in code. Try again.');
  }
}
