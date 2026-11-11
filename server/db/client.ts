import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type AppDatabase } from './sqlite.js';
import { migrate } from './migrate.js';

export type { AppDatabase };

let dbInstance: AppDatabase | null = null;

export function openDatabase(dbPath: string): AppDatabase {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      // WAL may be unavailable in some environments; continue with default journal.
    }
  }
  migrate(db);
  return db;
}

export function getDb(dbPath?: string): AppDatabase {
  if (dbInstance) return dbInstance;
  if (!dbPath) throw new Error('Database path required for first initialization');
  dbInstance = openDatabase(dbPath);
  return dbInstance;
}

export function setDb(db: AppDatabase): void {
  dbInstance = db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function createTestDatabase(): AppDatabase {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}
