import { count, eq, and } from 'drizzle-orm';
import { db } from '@/src/db/client';
import { tenants, users, products, type Tenant, type User, type Product } from '@/src/db/schema';

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
export async function getUserById(id: number, tenantId: number): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
    .limit(1);
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

export async function getProductById(tenantId: number, productId: number): Promise<Product | null> {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .limit(1);
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

export async function createProduct(
  tenantId: number,
  data: CreateProductData,
): Promise<CreateProductResult> {
  try {
    const [product] = await db
      .insert(products)
      .values({
        tenantId,
        sku: data.sku,
        name: data.name,
        price: data.price,
        stock: data.stock,
      })
      .returning();
    return { ok: true, product };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: false, error: 'SKU_DUPLICATE' };
    }
    throw error;
  }
}

/** `true` si borró la fila; `false` si no existía o pertenecía a otro tenant. */
export async function deleteProduct(tenantId: number, productId: number): Promise<boolean> {
  const result = db
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
export async function updateProductStock(
  tenantId: number,
  productId: number,
  delta: number,
): Promise<UpdateProductStockResult> {
  const current = await getProductById(tenantId, productId);
  if (!current) {
    return { ok: false, error: 'NOT_FOUND' };
  }

  const newStock = current.stock + delta;
  if (newStock < 0) {
    return { ok: false, error: 'STOCK_NEGATIVE' };
  }

  const result = db
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
