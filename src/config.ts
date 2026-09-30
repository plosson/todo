import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export interface Config {
  port: number;
  baseUrl: string;
  databasePath: string;
  sessionSecret: string;
  google: GoogleConfig | null;
  /** When true, /api/auth/dev and the PWA "Continue as dev" button work. */
  devAuth: boolean;
  dataDir: string;
}

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v;
}

function loadOrCreateSecret(dataDir: string): string {
  const fromEnv = env('SESSION_SECRET');
  if (fromEnv) return fromEnv;
  const path = resolve(dataDir, 'secret');
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  mkdirSync(dataDir, { recursive: true });
  const secret = randomBytes(32).toString('base64url');
  writeFileSync(path, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = resolve(env('DATA_DIR', '.data')!);
  mkdirSync(dataDir, { recursive: true });

  const port = Number(env('PORT', '8787'));
  const baseUrl = (env('BASE_URL', `http://localhost:${port}`) ?? `http://localhost:${port}`).replace(/\/$/, '');
  const databasePath = resolve(env('DATABASE_PATH', resolve(dataDir, 'todo.db'))!);

  const clientId = env('GOOGLE_CLIENT_ID');
  const clientSecret = env('GOOGLE_CLIENT_SECRET');
  const google =
    clientId && clientSecret ? { clientId, clientSecret } : null;

  const nodeEnv = env('NODE_ENV', 'development');
  const devAuthFlag = env('DEV_AUTH');
  const devAuth =
    overrides.devAuth ??
    (devAuthFlag === '1' ||
      devAuthFlag === 'true' ||
      nodeEnv === 'test' ||
      (!google && nodeEnv !== 'production'));

  return {
    port,
    baseUrl,
    databasePath,
    sessionSecret: loadOrCreateSecret(dataDir),
    google,
    devAuth,
    dataDir,
    ...overrides,
  };
}

export function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}
