import { count, eq, and, desc, gte, lte } from 'drizzle-orm';
import { db } from '@/src/db/client';
import {
  tenants,
  users,
  products,
  auditLogs,
  type Tenant,
  type User,
  type Product,
  type AuditLog,
  type AuditAction,
} from '@/src/db/schema';

// El union AuditAction vive en el schema (fuente única junto a la tabla);
// la DAL lo re-exporta como parte de su API de auditoría.
export type { AuditAction } from '@/src/db/schema';

/**
 * REGLA DE ARQUITECTURA (multi-tenant) — capa única de acceso a datos:
 * Toda función de negocio recibe `tenantId` EXCLUSIVAMENTE desde la sesión
 * verificada del llamador (getSession() en src/lib/auth.ts), JAMÁS desde un
 * input del cliente (formData, query params, body o headers): cualquier
 * tenantId de origen cliente es falsificable y rompería el aislamiento entre
 * tenants. Toda consulta sobre `users` o `products` DEBE filtrar por
 * `eq(tabla.tenantId, tenantId)`.
 *
 * Única excepción: getUserByEmail, que es intencionalmente global — es el
 * único punto del sistema donde aún no existe una sesión (flujo de login),
 * así que el tenant se obtiene del usuario encontrado, no al revés.
 *
 * Este módulo es server-only: debe invocarse desde Server Components,
 * Server Actions o Route Handlers, nunca desde Client Components.
 */

export async function getUserByEmail(email: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user ?? null;
}

/**
 * Único uso legítimo de un id de usuario fuera de getUserByEmail: recuperar
 * los datos del usuario ya autenticado por la sesión (p. ej. su email para
 * mostrarlo en el dashboard). Filtra también por tenantId como defensa en
 * profundidad, aunque el id ya pertenece a un único tenant por FK.
 */
export function getUserById(id: number, tenantId: number): User | null {
  const [user] = db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
    .limit(1)
    .all();
  return user ?? null;
}

export async function getTenantById(tenantId: number): Promise<Tenant | null> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return tenant ?? null;
}

export async function listProducts(tenantId: number): Promise<Product[]> {
  return db.select().from(products).where(eq(products.tenantId, tenantId));
}

export async function getProductCount(tenantId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(products)
    .where(eq(products.tenantId, tenantId));
  return row?.value ?? 0;
}

export function getProductById(
  tenantId: number,
  productId: number,
  tx?: DbTransaction,
): Product | null {
  const [product] = (tx ?? db)
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .limit(1)
    .all();
  return product ?? null;
}

interface CreateProductData {
  sku: string;
  name: string;
  price?: number;
  stock: number;
}

/** better-sqlite3 reporta violaciones de constraint con este `code`. */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export type CreateProductResult =
  | { ok: true; product: Product }
  | { ok: false; error: 'SKU_DUPLICATE' };

export function createProduct(
  tenantId: number,
  data: CreateProductData,
  tx?: DbTransaction,
): CreateProductResult {
  try {
    const [product] = (tx ?? db)
      .insert(products)
      .values({
        tenantId,
        sku: data.sku,
        name: data.name,
        price: data.price,
        stock: data.stock,
      })
      .returning()
      .all();
    return { ok: true, product };
  } catch (error) {
    // Dentro de una transacción, devolver sin lanzar mantiene la transacción
    // viva (no hay nada que revertir: el insert falló por completo).
    if (isUniqueConstraintError(error)) {
      return { ok: false, error: 'SKU_DUPLICATE' };
    }
    throw error;
  }
}

/** `true` si borró la fila; `false` si no existía o pertenecía a otro tenant. */
export function deleteProduct(
  tenantId: number,
  productId: number,
  tx?: DbTransaction,
): boolean {
  const result = (tx ?? db)
    .delete(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .run();
  return result.changes > 0;
}

export type StockUpdateError = 'NOT_FOUND' | 'STOCK_NEGATIVE' | 'STOCK_CONFLICT';

export type UpdateProductStockResult =
  | { ok: true; product: Product }
  | { ok: false; error: StockUpdateError };

/**
 * Concurrencia optimista (compare-and-swap): lee el stock actual, rechaza
 * localmente si el resultado quedaría negativo (nunca llega a la BD), y
 * escribe con un WHERE que exige que `stock` siga valiendo lo que se leyó.
 * Si `changes === 0`, otra transacción ya movió el stock entre la lectura y
 * la escritura (STOCK_CONFLICT) — nunca se usa REPLACE/INSERT OR REPLACE,
 * que borrarían la fila y romperían el filtro por tenant.
 */
export function updateProductStock(
  tenantId: number,
  productId: number,
  delta: number,
  tx?: DbTransaction,
): UpdateProductStockResult {
  const current = getProductById(tenantId, productId, tx);
  if (!current) {
    return { ok: false, error: 'NOT_FOUND' };
  }

  const newStock = current.stock + delta;
  if (newStock < 0) {
    return { ok: false, error: 'STOCK_NEGATIVE' };
  }

  const result = (tx ?? db)
    .update(products)
    .set({ stock: newStock })
    .where(
      and(
        eq(products.id, productId),
        eq(products.tenantId, tenantId),
        eq(products.stock, current.stock),
      ),
    )
    .run();

  if (result.changes === 0) {
    return { ok: false, error: 'STOCK_CONFLICT' };
  }

  return { ok: true, product: { ...current, stock: newStock } };
}

// === Auditoría (Sprint 04) ===

/**
 * Tipo del callback de `db.transaction` (better-sqlite3): permite a las
 * Server Actions ejecutar mutación de negocio + auditoría atómicamente.
 */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AuditLogFilters {
  action?: AuditAction;
  /** Filtro desde: epoch ms, inclusive. */
  from?: number;
  /** Filtro hasta: epoch ms, inclusive. */
  to?: number;
  /** Página 1-based; requiere `limit`. Si se omite, se devuelven todas las filas. */
  page?: number;
  limit?: number;
}

export type AuditLogWithUserEmail = AuditLog & { userEmail: string | null };

/**
 * Inserta una entrada de auditoría, opcionalmente dentro de una transacción
 * ya abierta (`tx`). `details` SOLO debe contener datos no sensibles
 * (nunca passwordHash, secrets ni tokens).
 */
export function createAuditLog(
  {
    tenantId,
    userId,
    action,
    details,
  }: {
    tenantId: number;
    userId: number | null;
    action: AuditAction;
    details?: Record<string, unknown>;
  },
  tx?: DbTransaction,
): AuditLog {
  const [log] = (tx ?? db)
    .insert(auditLogs)
    .values({ tenantId, userId, action, details: details ?? {} })
    .returning()
    .all();
  return log;
}

/**
 * Lista los registros de auditoría de UN tenant (aislamiento duro: siempre
 * `eq(tenantId)`), con filtros opcionales de acción y rango de fechas
 * (epoch ms), join al email del usuario (null si fue borrado) y paginación
 * opcional. Sin `page`/`limit` devuelve TODAS las filas filtradas (export CSV).
 */
export async function getTenantAuditLogs(
  tenantId: number,
  filters?: AuditLogFilters,
): Promise<{ logs: AuditLogWithUserEmail[]; total: number }> {
  const conditions = and(
    eq(auditLogs.tenantId, tenantId),
    filters?.action !== undefined ? eq(auditLogs.action, filters.action) : undefined,
    filters?.from !== undefined ? gte(auditLogs.createdAt, filters.from) : undefined,
    filters?.to !== undefined ? lte(auditLogs.createdAt, filters.to) : undefined,
  );

  const [countRow] = await db
    .select({ value: count() })
    .from(auditLogs)
    .where(conditions);
  const total = countRow?.value ?? 0;

  const baseQuery = db
    .select({
      id: auditLogs.id,
      tenantId: auditLogs.tenantId,
      userId: auditLogs.userId,
      action: auditLogs.action,
      details: auditLogs.details,
      createdAt: auditLogs.createdAt,
      userEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.userId, users.id))
    .where(conditions)
    .orderBy(desc(auditLogs.createdAt));

  const { page, limit } = filters ?? {};
  const logs =
    page !== undefined && limit !== undefined
      ? await baseQuery.limit(limit).offset((page - 1) * limit)
      : await baseQuery;

  return { logs, total };
}
