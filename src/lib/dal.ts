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
