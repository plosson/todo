import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const PORT = Number(process.env.TODO_E2E_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = resolve(import.meta.dirname, '..');

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE,
    headless: true,
  },
  webServer: {
    // Fresh database every run, so runs do not see each other's todos.
    command: `rm -f ${ROOT}/.data/e2e.db ${ROOT}/.data/e2e.db-wal ${ROOT}/.data/e2e.db-shm && DEV_AUTH=1 PORT=${PORT} BASE_URL=${BASE} DATABASE_PATH=${ROOT}/.data/e2e.db bun run ${ROOT}/src/index.ts`,
    url: `${BASE}/api/health`,
    cwd: ROOT,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
