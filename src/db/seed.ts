import { sqlite, db } from './client';
import { tenants, users, products } from './schema';
import { hashPassword } from '../lib/password';

/**
 * Seed idempotente: borra datos previos en orden por FKs (products → users
 * → tenants) y reinserta 2 tenants con 2 usuarios (owner/member) y productos
 * de ejemplo cada uno. Ejecutar con `npm run seed`.
 *
 * Reemplaza los datos existentes: no correr contra una base de datos con
 * información real.
 */

interface SeedCredential {
  tenant: string;
  email: string;
  password: string;
  role: string;
}

async function main() {
  console.log('[seed] Limpiando datos existentes...');
  db.delete(products).run();
  db.delete(users).run();
  db.delete(tenants).run();

  console.log('[seed] Insertando tenants...');
  const [alfa] = db.insert(tenants).values({ name: 'Empresa Alfa' }).returning().all();
  const [beta] = db.insert(tenants).values({ name: 'Empresa Beta' }).returning().all();

  console.log('[seed] Insertando usuarios...');
  const seedUsers = [
    { tenant: alfa, email: 'owner@alfa.test', password: 'Alfa123!owner', role: 'owner' },
    { tenant: alfa, email: 'member@alfa.test', password: 'Alfa123!member', role: 'member' },
    { tenant: beta, email: 'owner@beta.test', password: 'Beta123!owner', role: 'owner' },
    { tenant: beta, email: 'member@beta.test', password: 'Beta123!member', role: 'member' },
  ] as const;

  const credentials: SeedCredential[] = [];

  for (const seedUser of seedUsers) {
    const passwordHash = await hashPassword(seedUser.password);
    db.insert(users)
      .values({
        tenantId: seedUser.tenant.id,
        email: seedUser.email,
        passwordHash,
        role: seedUser.role,
      })
      .run();

    credentials.push({
      tenant: seedUser.tenant.name,
      email: seedUser.email,
      password: seedUser.password,
      role: seedUser.role,
    });
  }

  console.log('[seed] Insertando productos...');
  db.insert(products)
    .values([
      { tenantId: alfa.id, sku: 'ALF-001', name: 'Producto Alfa 1', price: 1500, stock: 20 },
      { tenantId: alfa.id, sku: 'ALF-002', name: 'Producto Alfa 2', price: 2300, stock: 5 },
      { tenantId: beta.id, sku: 'BET-001', name: 'Producto Beta 1', price: 900, stock: 40 },
      { tenantId: beta.id, sku: 'BET-002', name: 'Producto Beta 2', price: 4200, stock: 12 },
    ])
    .run();

  console.log('\n[seed] Completado. Credenciales de prueba:\n');
  console.table(credentials);
}

main()
  .catch((error) => {
    console.error('[seed] Error:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    sqlite.close();
  });
