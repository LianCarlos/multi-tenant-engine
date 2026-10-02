/**
 * Prueba end-to-end de aislamiento multi-tenant (Sprint 05).
 *
 * Node puro: better-sqlite3 + node:assert, sin frameworks de test. Aplica el
 * DDL REAL del proyecto (drizzle/*.sql, en orden) sobre una base SQLite en
 * memoria. Si el esquema cambia, este test se adapta solo leyendo las
 * migraciones reales — mantener esa convención.
 *
 * IMPORTANTE: `PRAGMA foreign_keys = ON` se ejecuta ANTES de aplicar el DDL.
 * SQLite no aplica ON DELETE CASCADE / SET NULL sin ese PRAGMA.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('=== Test de aislamiento multi-tenant (Sprint 05) ===\n');

// ── Base de datos en memoria con el DDL real ──────────────────────────────
const db = new Database(':memory:');
db.pragma('foreign_keys = ON'); // CRÍTICO: antes del DDL, o FKs no aplican

const drizzleDir = path.join(ROOT_DIR, 'drizzle');
const migrationFiles = readdirSync(drizzleDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (migrationFiles.length === 0) {
  console.error('✗ No se encontraron migraciones .sql en drizzle/');
  process.exit(1);
}

for (const file of migrationFiles) {
  db.exec(readFileSync(path.join(drizzleDir, file), 'utf8'));
}
console.log(
  `DDL: aplicadas ${migrationFiles.length} migraciones en SQLite :memory: (foreign_keys = ON)\n`,
);

// ── Fixtures: 2 tenants, 2 usuarios por tenant, SKUs repetidos ENTRE tenants ──
const insertTenant = db.prepare('INSERT INTO tenants (name) VALUES (?)');
const insertUser = db.prepare(
  'INSERT INTO users (tenant_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
);
const insertProduct = db.prepare(
  'INSERT INTO products (tenant_id, sku, name, stock) VALUES (?, ?, ?, ?)',
);
const insertAuditLog = db.prepare(
  'INSERT INTO audit_logs (tenant_id, user_id, action, details) VALUES (?, ?, ?, ?)',
);

const tenantA = insertTenant.run('Tenant A').lastInsertRowid;
const tenantB = insertTenant.run('Tenant B').lastInsertRowid;

// password_hash NOT NULL y email NOT NULL en el DDL real.
const userAOwner = insertUser.run(tenantA, 'owner@a.test', 'hash-a-owner', 'owner').lastInsertRowid;
const userAMember = insertUser.run(tenantA, 'member@a.test', 'hash-a-member', 'member').lastInsertRowid;
const userBOwner = insertUser.run(tenantB, 'owner@b.test', 'hash-b-owner', 'owner').lastInsertRowid;
const userBMember = insertUser.run(tenantB, 'member@b.test', 'hash-b-member', 'member').lastInsertRowid;

// SKU compartido ENTRE tenants (permitido por el índice único (tenant_id, sku)).
const sharedSku = 'SKU-COMPARTIDO';
const productA1 = insertProduct.run(tenantA, sharedSku, 'Producto A1', 10).lastInsertRowid;
const productA2 = insertProduct.run(tenantA, 'SKU-A-UNICO', 'Producto A2', 5).lastInsertRowid;
const productB1 = insertProduct.run(tenantB, sharedSku, 'Producto B1', 20).lastInsertRowid;
const productB2 = insertProduct.run(tenantB, 'SKU-B-UNICO', 'Producto B2', 7).lastInsertRowid;

// Un audit_log por tenant, referenciando a un usuario de su tenant.
const auditA = insertAuditLog.run(tenantA, userAOwner, 'product_created', '{}').lastInsertRowid;
const auditB = insertAuditLog.run(tenantB, userBOwner, 'product_created', '{}').lastInsertRowid;

// Id del usuario con email compartido en B (se crea en la aserción A3); se
// usa en A4 para verificar la identidad exacta del tenant B tras el cascade.
let sharedUserB = null;

// ── Captura previa para la aserción 6 (documental) ────────────────────────
// La query "maliciosa" sin filtro de tenant necesita AMBOS tenants vivos;
// se captura ahora para poder imprimir la aserción al final, en orden.
const unfilteredProductTenants = db
  .prepare('SELECT tenant_id FROM products')
  .all()
  .map((row) => row.tenant_id);

// ── Harness: ✓/✗ por aserción, exit 1 con mensaje claro al fallar ────────
let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`✓ ${label}`);
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`✗ ${label}`);
    const message = error instanceof Error ? error.message : String(error);
    console.error(`    → ${message}`);
  }
}

function count(query, ...params) {
  return db.prepare(query).get(...params).c;
}

/** Ejecuta `fn` y exige que lance violación de constraint única; falla si no lanza. */
function expectUniqueViolation(fn, failureMessage) {
  try {
    fn();
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return; // violación esperada: el aislamiento funciona
    }
    throw new Error(`${failureMessage} — error inesperado: ${error?.code ?? error}`);
  }
  throw new Error(failureMessage);
}

function assertRowsBelongToTenant(query, tenantId, expectedIds, tableLabel) {
  const rows = db.prepare(query).all(tenantId);
  assert.strictEqual(
    rows.length,
    expectedIds.length,
    `${tableLabel}: esperaba ${expectedIds.length} filas del tenant, obtuvo ${rows.length}`,
  );
  for (const row of rows) {
    assert.strictEqual(
      row.tenant_id,
      tenantId,
      `${tableLabel}: una fila del tenant B se coló en la consulta filtrada por A`,
    );
  }
  const actualIds = rows.map((row) => row.id).sort((a, b) => a - b);
  const expectedSorted = [...expectedIds].sort((a, b) => a - b);
  assert.deepStrictEqual(
    actualIds,
    expectedSorted,
    `${tableLabel}: los ids devueltos no coinciden con los del tenant A`,
  );
}

// ── Aserciones ────────────────────────────────────────────────────────────
check('A1 (products)  — filtro tenant_id = A no devuelve filas de B', () => {
  assertRowsBelongToTenant(
    'SELECT id, tenant_id FROM products WHERE tenant_id = ?',
    tenantA,
    [productA1, productA2],
    'products',
  );
});

check('A1 (users)     — filtro tenant_id = A no devuelve filas de B', () => {
  assertRowsBelongToTenant(
    'SELECT id, tenant_id FROM users WHERE tenant_id = ?',
    tenantA,
    [userAOwner, userAMember],
    'users',
  );
});

check('A1 (audit_logs) — filtro tenant_id = A no devuelve filas de B', () => {
  assertRowsBelongToTenant(
    'SELECT id, tenant_id FROM audit_logs WHERE tenant_id = ?',
    tenantA,
    [auditA],
    'audit_logs',
  );
});

check('A2 — SKU idéntico en A y B es válido; duplicado DENTRO del mismo tenant viola la constraint', () => {
  const crossTenantCount = count('SELECT COUNT(*) AS c FROM products WHERE sku = ?', sharedSku);
  assert.strictEqual(
    crossTenantCount,
    2,
    `el SKU compartido debe existir una vez por tenant (hay ${crossTenantCount})`,
  );
  expectUniqueViolation(
    () => insertProduct.run(tenantA, sharedSku, 'Duplicado A', 0),
    'A2: el SKU duplicado dentro del mismo tenant debía violar la constraint única (tenant_id, sku)',
  );
});

check('A3 — email repetido en OTRO tenant es válido; repetido DENTRO del mismo tenant viola la constraint', () => {
  const sharedEmail = 'shared@test.com';
  insertUser.run(tenantA, sharedEmail, 'hash-shared-a', 'member');
  sharedUserB = insertUser.run(tenantB, sharedEmail, 'hash-shared-b', 'member').lastInsertRowid;
  const crossTenantCount = count('SELECT COUNT(*) AS c FROM users WHERE email = ?', sharedEmail);
  assert.strictEqual(
    crossTenantCount,
    2,
    `el email compartido debe existir una vez por tenant (hay ${crossTenantCount})`,
  );
  expectUniqueViolation(
    () => insertUser.run(tenantA, sharedEmail, 'hash-shared-a-dup', 'member'),
    'A3: el email duplicado dentro del mismo tenant debía violar la constraint única (tenant_id, email)',
  );
});

check('A4 — DELETE del tenant A hace cascade de sus products/users/audit_logs y no toca B', () => {
  db.prepare('DELETE FROM tenants WHERE id = ?').run(tenantA);

  assert.strictEqual(
    count('SELECT COUNT(*) AS c FROM products WHERE tenant_id = ?', tenantA),
    0,
    'A4: quedaron products del tenant A tras el DELETE',
  );
  assert.strictEqual(
    count('SELECT COUNT(*) AS c FROM users WHERE tenant_id = ?', tenantA),
    0,
    'A4: quedaron users del tenant A tras el DELETE',
  );
  assert.strictEqual(
    count('SELECT COUNT(*) AS c FROM audit_logs WHERE tenant_id = ?', tenantA),
    0,
    'A4: quedaron audit_logs del tenant A tras el DELETE',
  );
  assert.strictEqual(
    count('SELECT COUNT(*) AS c FROM tenants'),
    1,
    'A4: debía quedar solo el tenant B',
  );

  // El tenant B queda intacto: identidad exacta de sus filas (products y
  // users, incluido el email compartido insertado en A3) y su audit_log.
  const bProductIds = db
    .prepare('SELECT id FROM products WHERE tenant_id = ?')
    .all(tenantB)
    .map((row) => row.id)
    .sort((a, b) => a - b);
  assert.deepStrictEqual(
    bProductIds,
    [productB1, productB2].sort((a, b) => a - b),
    'A4: el cascade alteró los products del tenant B',
  );
  const bUserIds = db
    .prepare('SELECT id FROM users WHERE tenant_id = ?')
    .all(tenantB)
    .map((row) => row.id)
    .sort((a, b) => a - b);
  assert.deepStrictEqual(
    bUserIds,
    [userBOwner, userBMember, sharedUserB].sort((a, b) => a - b),
    'A4: el cascade alteró los users del tenant B',
  );
  assert.strictEqual(
    count('SELECT COUNT(*) AS c FROM audit_logs WHERE tenant_id = ?', tenantB),
    1,
    'A4: el cascade alteró los audit_logs del tenant B',
  );
  assert.ok(
    db.prepare('SELECT id FROM audit_logs WHERE id = ?').get(auditB) !== undefined,
    'A4: el audit_log del tenant B desapareció',
  );
});

check('A5 — borrar un usuario conserva sus audit_logs con user_id = NULL (ON DELETE SET NULL)', () => {
  db.prepare('DELETE FROM users WHERE id = ?').run(userBOwner);

  const auditRow = db.prepare('SELECT user_id FROM audit_logs WHERE id = ?').get(auditB);
  assert.ok(auditRow !== undefined, 'A5: el audit_log del tenant B desapareció al borrar su usuario');
  assert.strictEqual(
    auditRow.user_id,
    null,
    'A5: user_id debía quedar NULL (ON DELETE SET NULL), no se aplicó',
  );
  assert.strictEqual(
    count('SELECT COUNT(*) AS c FROM audit_logs WHERE tenant_id = ?', tenantB),
    1,
    'A5: el audit_log debía conservarse tras borrar el usuario',
  );
});

check('A6 (documental) — una query sin filtro de tenant devuelve filas de AMBOS tenants', () => {
  const seenTenants = [...new Set(unfilteredProductTenants)].sort((a, b) => a - b);
  const expectedTenants = [tenantA, tenantB].sort((a, b) => a - b);
  assert.deepStrictEqual(
    seenTenants,
    expectedTenants,
    'A6: la query sin filtro debía devolver filas de ambos tenants',
  );
});
console.log(
  '⚠  Advertencia documental (NO es un fallo de test): la query sin filtro atraviesa',
);
console.log(
  '   a los dos tenants porque SQLite no tiene Row Level Security. Por eso la DAL',
);
console.log(
  '   (src/lib/dal.ts) es OBLIGATORIA: inyecta siempre el tenant_id de la sesión',
);
console.log('   JWT verificada en el servidor, nunca un tenant_id de origen cliente.\n');

// ── Resumen ───────────────────────────────────────────────────────────────
console.log('=== Resumen ===');
console.log(`Aserciones pasadas: ${passed}`);
console.log(`Aserciones fallidas: ${failed}`);
if (failed > 0) {
  console.error('✗ EL TEST DE AISLAMIENTO FALLÓ: se detectaron fugas entre tenants.');
  console.error('Exit code: 1');
  process.exit(1);
}
console.log('✓ Aislamiento multi-tenant verificado sobre el DDL real de drizzle/.');
console.log('Exit code: 0');
