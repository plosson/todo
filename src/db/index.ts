import { Database } from 'bun:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureParentDir } from '../config';

export type Db = Database;

const MIGRATIONS_DIR = join(import.meta.dir, 'migrations');

export function openDatabase(path: string): Database {
  ensureParentDir(path);
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  applySchema(db);
  return db;
}

export function openMemoryDatabase(): Database {
  const db = new Database(':memory:');
  applySchema(db);
  return db;
}

/**
 * schema.sql is the base (version 0). Each migrations/NNN_*.sql file moves the
 * database to version NNN, tracked in PRAGMA user_version, inside a transaction.
 */
function applySchema(db: Database): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(join(import.meta.dir, 'schema.sql'), 'utf8'));

  const current = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (const migration of listMigrations()) {
    if (migration.version <= current) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, migration.file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    })();
  }
}

function listMigrations(): Array<{ version: number; file: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .map((file) => ({ version: Number(file.slice(0, 3)), file }))
    .sort((a, b) => a.version - b.version);
}
