# Sprint 04 — Instrucciones de Testeo: Auditoría (`audit_logs`) y export CSV

> Ciclo: Sprint 04 (Auditoría y analítica de movimientos) · Estado: implementado, verificado y commiteado · Documento de QA obligatorio.

## 1. Alcance implementado

| Componente | Archivo | Qué hace |
|---|---|---|
| Tabla `audit_logs` | `src/db/schema.ts` | `id` integer PK autoincrement; `tenant_id` integer NOT NULL FK → `tenants` (`onDelete: cascade`); `user_id` integer NULL FK → `users` (`onDelete: set null`); `action` text NOT NULL (catálogo `AUDIT_ACTIONS`); `details` JSON (`text` + `mode: 'json'`); `created_at` epoch **ms** con default dinámico. Índice `(tenant_id, created_at)`. |
| Migración versionada | `drizzle/0001_sticky_absorbing_man.sql` | Crea `audit_logs` + índice. Aplicada con `npx drizzle-kit migrate`. |
| DAL de auditoría | `src/lib/dal.ts` | `createAuditLog({ tenantId, userId, action, details }, tx?)` y `getTenantAuditLogs(tenantId, { action, from, to, page, limit })` → `{ logs, total }` con filtros (epoch ms, inclusivos) y paginación opcional; `leftJoin` al email del usuario. Sin `page`/`limit` devuelve todas las filas filtradas (uso del export). |
| Mutaciones transaccionales | `src/app/actions/product.ts` | Las 3 mutaciones (`createProductAction`, `updateStockAction`, `deleteProductAction`) ejecutan mutación + auditoría en **transacciones síncronas** `db.transaction((tx) => ...)`: o persisten ambas o ninguna. `updateStockAction` audita `details: { productId, sku, stockAnterior, stockNuevo, delta }`. |
| Auditoría de auth | `src/app/actions/auth.ts` | `login_success`, `login_failed` (usuario existente con password incorrecta) y `logout`. Login con **email inexistente no genera fila** (decisión documentada: FK `tenant_id` NOT NULL y no hay tenant conocido para aislar el evento). |
| Vista de auditoría | `src/app/dashboard/audit/page.tsx` + `audit-table.tsx` | Server Component con `dynamic = 'force-dynamic'`; filtros por `action`, `from`, `to` (fechas en hora local, inclusivas); paginación de 50 por página que conserva los filtros; badges por acción; detalles JSON expandibles; enlace "Exportar CSV" con los mismos filtros. |
| Export CSV | `src/app/api/audit/export/route.ts` | `GET` autenticado (401 sin sesión); BOM `\uFEFF` para Excel; escape RFC 4180 (comillas duplicadas, celdas con coma/salto de línea entre comillas); `Content-Disposition: attachment; filename="audit-<tenantId>.csv"`; **sin paginar** (todas las filas del tenant con los filtros). |

## 2. Prerequisitos y entorno

- [ ] Node.js instalado (ver `engines` en `package.json`).
- [ ] Dependencias instaladas: `npm install`.
- [ ] Migraciones aplicadas: `npx drizzle-kit migrate` (detecta better-sqlite3 automáticamente; aplica `drizzle/0001_sticky_absorbing_man.sql`).
- [ ] Base sembrada: `npm run seed` (idempotente y **destructiva**: borra productos, usuarios y tenants — y por cascade también `audit_logs`. No correr contra datos reales). Tras el seed, `audit_logs` queda vacío.
- [ ] Servidor en ejecución: `npm run dev` (por defecto `http://localhost:3000`).
- [ ] Para pruebas estables entre reinicios, exportar `JWT_SECRET` fijo antes de `npm run dev` (en dev, sin variable, `src/lib/auth.ts` genera una clave efímera por proceso: las sesiones no sobreviven a reinicios).
- [ ] DB local: `sqlite.db` en la raíz del proyecto (`src/db/client.ts`, `DATABASE_URL`). Para inspección directa opcional: `sqlite3 sqlite.db "select ..."`.

## 3. Datos de prueba (creados por `npm run seed`)

Credenciales definidas en `src/db/seed.ts`:

| Tenant | Email | Contraseña | Rol |
|---|---|---|---|
| Empresa Alfa | `owner@alfa.test` | `Alfa123!owner` | owner |
| Empresa Alfa | `member@alfa.test` | `Alfa123!member` | member |
| Empresa Beta | `owner@beta.test` | `Beta123!owner` | owner |
| Empresa Beta | `member@beta.test` | `Beta123!member` | member |

Productos sembrados: Alfa → `ALF-001` (stock 20), `ALF-002` (stock 5) · Beta → `BET-001` (stock 40), `BET-002` (stock 12).

## 4. Casos felices

### Feliz A — Mutaciones de producto auditadas
- [ ] Iniciar sesión como `owner@alfa.test` y abrir `/dashboard/inventory`.
- [ ] Crear un producto (p. ej. SKU `ALF-003`), mover stock de `ALF-001` con `+` y `−`, y eliminar el producto creado.
- [ ] Ir a `/dashboard/audit` y revisar las filas nuevas (badge + "Ver" detalles de cada una).

**Criterio de aceptación:** cada mutación genera una fila en `audit_logs` con `tenant_id` del tenant de la sesión, `user_id` del usuario autenticado, `action` correcto y `details` correctos. **Resultado esperado:** filas `product_created` (con `productId`, `sku`, `stock`, `price`), `product_updated` (con `stockAnterior`, `stockNuevo` y `delta` correctos: ej. 20 → 23 con `delta: 3`, y la resta a la inversa) y `product_deleted` (con `productId` y `sku`). El badge del usuario coincide con `owner@alfa.test`.

### Feliz B — Login, login fallido y logout auditados
- [ ] Cerrar sesión (si hay) y hacer login con `owner@alfa.test`.
- [ ] Cerrar sesión de nuevo.
- [ ] Intentar login con `owner@alfa.test` y contraseña incorrecta (ej. `incorrecta`).
- [ ] Hacer login correcto y revisar `/dashboard/audit`.

**Criterio de aceptación:** quedan registrados `login_success`, `logout` y `login_failed`. **Resultado esperado:** una fila `login_success` (details con `email`), una `logout` y una `login_failed` (details con el email del intento, nunca el hash), cada una con el `user_id` correcto.

### Feliz C — Aislamiento entre tenants en la vista
- [ ] Generar actividad en Alfa (al menos una mutación de producto y un login).
- [ ] En una ventana de incógnito, iniciar sesión como `owner@beta.test`, generar actividad en Beta (ej. mover stock de `BET-001`) y abrir `/dashboard/audit`.

**Criterio de aceptación:** la vista de cada tenant muestra **solo** sus filas. **Resultado esperado:** Alfa nunca ve la fila de Beta ni viceversa; los emails visibles pertenecen solo al tenant de la sesión.

### Feliz D — Filtros por acción y rango de fechas; paginación conserva filtros
- [ ] En `/dashboard/audit` (como `owner@alfa.test`), seleccionar acción "Stock actualizado" y pulsar **Filtrar**.
- [ ] Seleccionar "Desde" y "Hasta" con el día actual (o un rango que cubra la actividad generada) y **Filtrar**.
- [ ] Si hay más de 50 filas, navegar con "Siguiente →" / "← Anterior".

**Criterio de aceptación:** los filtros se aplican y la paginación no los pierde. **Resultado esperado:** solo filas `product_updated` con el filtro de acción; el rango de fechas incluye el inicio del día (00:00:00.000) y el fin (23:59:59.999) en hora local; los enlaces de paginación conservan `action`/`from`/`to` en la URL y el contador "Página X de Y" es correcto.

### Feliz E — Export CSV
- [ ] En `/dashboard/audit` con filtros activos (o sin ellos), pulsar **Exportar CSV**.
- [ ] Abrir el archivo descargado (doble clic en Excel / Numbers / editor de texto).

**Criterio de aceptación:** descarga `audit-<tenantId>.csv`, abre en Excel con columnas correctas y contiene todas las filas filtradas del tenant (sin paginar). **Resultado esperado:** columnas `Fecha, Usuario, Acción, Detalles` sin caracteres extraños al inicio (BOM correcto para UTF-8), una fila por registro, y solo filas del tenant de la sesión.

## 5. Casos borde

### Borde A — Login con email inexistente NO genera fila
- [ ] Intentar login con `nadie@alfa.test` (cualquier contraseña).
- [ ] Revisar `/dashboard/audit` con sesión de Alfa y confirmar (también con `sqlite3` si se desea) que no hay fila `login_failed` para ese intento.

**Criterio de aceptación (decisión documentada):** sin usuario no existe `tenant_id` y la FK es NOT NULL, por lo que el evento **no se audita**. **Resultado esperado:** la UI responde "Credenciales inválidas" (mismo mensaje que password incorrecta, sin filtrar al cliente) y **no** aparece ninguna fila nueva en `audit_logs`.

### Borde B — Celdas CSV con comillas y comas (RFC 4180)
- [ ] Crear un producto con nombre que contenga coma y comillas, p. ej. `Martillo "pro", 5kg` (permitido: `name` acepta 1–128 caracteres).
- [ ] Exportar CSV y abrirlo en Excel.

**Criterio de aceptación:** el escape cumple RFC 4180. **Resultado esperado:** la celda aparece íntegra en una sola columna (envuelta en comillas, con comillas internas duplicadas `""`) y el producto creado para la prueba aparece auditado como `product_created`.

### Borde C — Filtros inválidos se ignoran con gracia
- [ ] Visitar `/dashboard/audit?action=no_existe&from=2026-02-31&to=basura&page=abc`.

**Criterio de aceptación:** valores no válidos no rompen la vista. **Resultado esperado:** los filtros inválidos se descartan (acción no catalogada, fecha inexistente, page no numérica → página 1) y se muestran todas las filas del tenant.

### Borde D — Atomicidad: fallo simulado de auditoría revierte la mutación de stock
- [ ] Reproducir con una DB aislada y el DDL real del repo (ver receta abajo), **sin tocar** `sqlite.db` del entorno de dev.
- [ ] Ejecutar la receta que, dentro de `db.transaction((tx) => ...)`, mueve stock y **lanza un error antes de cerrar la transacción**.

**Criterio de aceptación:** la mutación de stock no se aplica si la auditoría no persiste. **Resultado esperado:** tras el rollback el stock queda intacto y `audit_logs` sin filas nuevas; en el flujo feliz (sin error) persisten **ambas** cosas (producto actualizado + fila de auditoría).

Receta mínima reproducible (crea `/tmp/audit-atomic-test.db`):

```bash
cat > /tmp/audit-atomic.test.ts <<'EOF'
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from '/Users/macprolian/multi-tenant-engine/src/db/schema';

const sql = new Database('/tmp/audit-atomic-test.db');
sql.pragma('foreign_keys = ON');
const root = '/Users/macprolian/multi-tenant-engine';
for (const f of ['drizzle/0000_initial_schema.sql', 'drizzle/0001_sticky_absorbing_man.sql']) {
  for (const stmt of readFileSync(join(root, f), 'utf8').split('--> statement-breakpoint')) {
    if (stmt.trim()) sql.exec(stmt);
  }
}
const db = drizzle(sql, { schema });
const tenant = db.insert(schema.tenants).values({ name: 'T' }).returning().all()[0];
const user = db
  .insert(schema.users)
  .values({ tenantId: tenant.id, email: 'u@t.test', passwordHash: 'x', role: 'owner' })
  .returning().all()[0];
const product = db
  .insert(schema.products)
  .values({ tenantId: tenant.id, sku: 'T-001', name: 'P', price: 100, stock: 10 })
  .returning().all()[0];

const rollback = () => {
  try {
    db.transaction((tx) => {
      tx.update(schema.products)
        .set({ stock: 15 })
        .where(eq(schema.products.id, product.id))
        .run();
      tx.insert(schema.auditLogs)
        .values({ tenantId: tenant.id, userId: user.id, action: 'product_updated', details: {} })
        .run();
      throw new Error('simulando fallo de auditoría');
    });
  } catch {}
  const p = db.select().from(schema.products).where(eq(schema.products.id, product.id)).all()[0];
  const n = db.select().from(schema.auditLogs).all().length;
  console.log('rollback → stock:', p.stock, '| audit_rows:', n); // esperado: stock 10, audit_rows 0
};

const happy = () => {
  db.transaction((tx) => {
    tx.update(schema.products)
      .set({ stock: 15 })
      .where(eq(schema.products.id, product.id))
      .run();
    tx.insert(schema.auditLogs)
      .values({ tenantId: tenant.id, userId: user.id, action: 'product_updated', details: { delta: 5 } })
      .run();
  });
  const p = db.select().from(schema.products).where(eq(schema.products.id, product.id)).all()[0];
  const n = db.select().from(schema.auditLogs).all().length;
  console.log('feliz    → stock:', p.stock, '| audit_rows:', n); // esperado: stock 15, audit_rows 1
};

rollback();
happy();
EOF
npx tsx /tmp/audit-atomic.test.ts && rm /tmp/audit-atomic.test.ts /tmp/audit-atomic-test.db*
```

> Nota: la receta reproduce el patrón real de `src/app/actions/product.ts` y `src/lib/dal.ts` (`db.transaction` con callback síncrono, `.run()`/`.all()`). La verificación oficial del ciclo ya ejecutó esta prueba con resultado real (ver sección 7).

## 6. Validaciones de regresión (Sprints 01–03)

- [ ] **Login/logout:** login correcto redirige a `/dashboard`; logout redirige a `/login` y la cookie `session` se elimina.
- [ ] **CRUD de productos:** crear con SKU nuevo, ver en tabla, mover stock y eliminar.
- [ ] **SKU duplicado:** crear con `ALF-001` → "Ese SKU ya existe en tu empresa" y **sin** fila `product_created` (la auditoría solo registra mutaciones exitosas).
- [ ] **Stock negativo:** restar por debajo de 0 → "El stock no puede quedar por debajo de 0", sin fila `product_updated`.
- [ ] **Conflicto CAS:** dos pestañas del mismo tenant mutan el mismo producto a la vez → la perdedora muestra "El stock cambió en otra pestaña o por otro usuario. Reintenta." y solo una fila `product_updated`.
- [ ] **SSE (Sprint 03):** con dos pestañas del mismo tenant en `/dashboard/inventory`, un ajuste de stock en A aparece en B en ≤ 2 s sin recargar; el badge sigue en `● En vivo` y los eventos **no** cruzan tenants (referencia completa: `docs/testing/sprint-03-realtime-sse-test-instructions.md`).
- [ ] **Navegación:** ir y volver entre `/dashboard` ↔ `/dashboard/inventory` ↔ `/dashboard/audit` sin errores; el enlace "← Volver al dashboard" funciona.

## 7. Verificaciones ya ejecutadas (resultados reales del ciclo)

- `npx tsc --noEmit` → **verde**; `npm run lint` → **verde**.
- **QA con Node puro sobre la DB local:** aislamiento OK (tenant A ve 4 filas propias, tenant B ve 1, **cero fugas cruzadas**); filtro por acción OK; filtro por rango de fechas OK; paginación OK.
- **Atomicidad real con DB aislada y DDL real de `drizzle/*.sql`:** flujo feliz transaccional persiste producto + audit; al lanzar error dentro de la transacción, **rollback real** (stock intacto, sin audit).
- **Fix crítico aplicado:** `db.transaction(async ...)` lanzaba `"Transaction function cannot return a promise"` con better-sqlite3 v13; reescrito a callbacks **síncronos** con `.all()`/`.run()`, verificado sin el error y con rollback real.

## 8. Notas técnicas y deuda

- **better-sqlite3 es un driver síncrono:** las transacciones deben ser callbacks síncronos (nunca `async`) y usar los helpers síncronos `.run()`/`.all()` — ese es el patrón vigente en `src/lib/dal.ts` y `src/app/actions/product.ts`.
- **Deuda registrada para Sprint 05:** purgado/retención de `audit_logs` (crecen sin límite), tests automatizados para la auditoría, y límite de conexiones SSE (gestión explícita del estado de auth en el cliente).
