import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL ?? './sqlite.db';

/**
 * Patrón globalThis para evitar múltiples conexiones con HMR de Next.js
 * (ver sqlite-best-practices: previene `database is locked`).
 */
const globalForDb = globalThis as unknown as {
  sqlite: Database.Database | undefined;
  drizzle: ReturnType<typeof drizzle<typeof schema>> | undefined;
};

function createSqlite(): Database.Database {
  const sqlite = new Database(DATABASE_URL);

  sqlite.pragma('journal_mode = WAL'); // mejor concurrencia de lectura
  sqlite.pragma('foreign_keys = ON'); // FK no se aplican por defecto en SQLite
  sqlite.pragma('busy_timeout = 5000'); // tolera contención de escritura sin SQLITE_BUSY
  sqlite.pragma('synchronous = NORMAL'); // seguro con WAL, más rápido que FULL

  return sqlite;
}

export const sqlite: Database.Database =
  globalForDb.sqlite ?? createSqlite();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.sqlite = sqlite;
}

export const db = globalForDb.drizzle ?? drizzle(sqlite, { schema });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.drizzle = db;
}
