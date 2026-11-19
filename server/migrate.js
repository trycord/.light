import { initDb } from './db.js';

export function runMigrations() {
  return initDb();
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  runMigrations();
  console.log('[trycord-light] migrations complete');
}