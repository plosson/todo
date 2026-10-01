import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, openMemoryDatabase } from '../src/db';
import { TodoService } from '../src/todos';

const SRC_DB = join(import.meta.dir, '..', 'src', 'db');
const LATEST = Math.max(
  ...readdirSync(join(SRC_DB, 'migrations')).map((f) => Number(f.slice(0, 3))),
);

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'todo-mig-')), 'todo.db');
}

function userVersion(db: Database): number {
  return (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
}

function todoColumns(db: Database): string[] {
  return (db.query('PRAGMA table_info(todos)').all() as Array<{ name: string }>).map((c) => c.name);
}

/** A database as the first release created it: base schema only, user_version 0. */
function createV0Database(path: string): void {
  const db = new Database(path, { create: true });
  db.exec(readFileSync(join(SRC_DB, 'schema.sql'), 'utf8'));
  db.exec(`INSERT INTO users (id, email, created_at, updated_at)
           VALUES ('usr_1', 'p@example.com', '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z')`);
  db.exec(`INSERT INTO todos (id, owner_id, title, done_at, sort_key, created_at, updated_at)
           VALUES ('tod_old', 'usr_1', 'Old todo', '2026-09-30T01:00:00Z', 1,
                   '2026-09-30T00:00:00Z', '2026-09-30T01:00:00Z')`);
  db.close();
}

describe('migrations', () => {
  test('upgrade an existing v0 database without losing data', () => {
    const path = tempDbPath();
    createV0Database(path);

    const db = openDatabase(path);
    expect(userVersion(db)).toBe(LATEST);
    expect(todoColumns(db)).toContain('created_via');
    expect(todoColumns(db)).toContain('done_via');

    const old = new TodoService(db).get('usr_1', 'tod_old');
    expect(old.title).toBe('Old todo');
    expect(old.doneAt).toBe('2026-09-30T01:00:00Z');
    expect(old.createdVia).toBeNull();
    expect(old.doneVia).toBeNull();
    db.close();
  });

  test('reopening an up-to-date database does not re-run migrations', () => {
    const path = tempDbPath();
    openDatabase(path).close();
    // Re-running 001 would fail with "duplicate column name".
    expect(() => openDatabase(path).close()).not.toThrow();
    const db = openDatabase(path);
    expect(userVersion(db)).toBe(LATEST);
    db.close();
  });

  test('a fresh in-memory database is at the latest version', () => {
    const db = openMemoryDatabase();
    expect(userVersion(db)).toBe(LATEST);
    expect(todoColumns(db)).toContain('created_via');
  });

  test('a database already marked as migrated is left alone', () => {
    const path = tempDbPath();
    createV0Database(path);
    const raw = new Database(path);
    raw.exec('ALTER TABLE todos ADD COLUMN created_via TEXT');
    raw.exec('ALTER TABLE todos ADD COLUMN done_via TEXT');
    raw.exec(`PRAGMA user_version = ${LATEST}`);
    raw.close();
    expect(() => openDatabase(path).close()).not.toThrow();
  });
});
