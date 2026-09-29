import { defineConfig } from 'drizzle-kit';

/**
 * Configuración de Drizzle Kit para SQLite local (better-sqlite3).
 * - schema:   definición de tablas TypeScript
 * - out:      carpeta donde se generan las migraciones SQL (se versiona)
 * - url:      archivo SQLite local en la raíz del proyecto
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: './sqlite.db',
  },
});
