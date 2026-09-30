import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureParentDir } from '../config';

export type Db = Database;

export function openDatabase(path: string): Database {
  ensureParentDir(path);
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  const schemaPath = join(import.meta.dir, 'schema.sql');
  db.exec(readFileSync(schemaPath, 'utf8'));
  return db;
}

export function openMemoryDatabase(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const schemaPath = join(import.meta.dir, 'schema.sql');
  db.exec(readFileSync(schemaPath, 'utf8'));
  return db;
}
