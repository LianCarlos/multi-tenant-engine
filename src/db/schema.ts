import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Esquema multi-tenant para SQLite (Drizzle ORM + better-sqlite3).
 *
 * Decisiones de diseño:
 * - IDs: INTEGER PRIMARY KEY AUTOINCREMENT (rowid garantizado por SQLite).
 * - Fechas: INTEGER con epoch en milisegundos y default en runtime Date.now().
 * - Precios: INTEGER en centavos (evita imprecisiones de REAL para dinero).
 * - onDelete de FKs: 'cascade' — al borrar un tenant se eliminan sus usuarios
 *   y productos, evitando datos huérfanos entre tenants.
 * - Índice único compuesto (tenantId, email) en users: un email solo puede
 *   repetirse entre tenants distintos, pero no dentro del mismo tenant.
 * - Índice único compuesto (tenantId, sku) en products: el SKU es único
 *   por tenant.
 */

export const tenants = sqliteTable('tenants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  // epoch ms: default dinámico en SQL (unixepoch) + default en runtime del ORM (Date.now)
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
    .$defaultFn(() => Date.now()),
});

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('member'),
    // epoch ms: default dinámico en SQL (unixepoch) + default en runtime del ORM (Date.now)
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    uniqueIndex('users_tenant_id_email_unique').on(table.tenantId, table.email),
  ],
);

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    price: integer('price'), // centavos; nullable si el producto no tiene precio fijo
    stock: integer('stock').notNull().default(0),
    // epoch ms: default dinámico en SQL (unixepoch) + default en runtime del ORM (Date.now)
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index('products_tenant_id_idx').on(table.tenantId),
    uniqueIndex('products_tenant_id_sku_unique').on(table.tenantId, table.sku),
  ],
);

/**
 * Registro de auditoría (Sprint 04): toda mutación de negocio, login y
 * logout quedan trazados por tenant. `userId` es nullable con
 * `onDelete: 'set null'` para que la auditoría sobreviva al borrado del
 * usuario; el tenant, en cambio, cascadea (al borrar el tenant no queda
 * nada que auditar). `details` es JSON con datos puntuales y NO sensibles
 * (nunca passwordHash).
 */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    details: text('details', { mode: 'json' })
      .notNull()
      .default('{}')
      .$type<Record<string, unknown>>(),
    // epoch ms: default dinámico en SQL (unixepoch) + default en runtime del ORM (Date.now)
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index('audit_logs_tenant_id_created_at_idx').on(table.tenantId, table.createdAt),
  ],
);

// === Tipos inferidos ===

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

/**
 * Catálogo de acciones auditables. Mantener sincronizado con los callers:
 * las Server Actions y el flujo de auth solo insertan acciones de esta lista.
 */
export const AUDIT_ACTIONS = [
  'login_success',
  'login_failed',
  'logout',
  'product_created',
  'product_updated',
  'product_deleted',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
