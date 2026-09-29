# SPRINT 04 — Auditoría (`audit_logs`) y analítica de movimientos

> **Depende de:** Sprint 02 (obligatorio) · Sprint 03 (recomendado) · **Estado:** Pendiente

## 1. Objetivo

Trazabilidad total de operaciones: nueva tabla `audit_logs` en Drizzle (`id`, `tenantId`, `userId`, `action`, `details`, `createdAt`), registro automático de auditoría en cada Server Action, y vista `/dashboard/audit` con filtros y exportación rápida a CSV, siempre aislada por tenant.

## 2. Alcance

**Dentro:** tabla `audit_logs` + migración versionada, registro transaccional en mutaciones, página de auditoría con filtros (acción, fecha), export CSV, auditoría de login/logout.
**Fuera:** analítica con gráficos complejos, retención/purgado automático (nota de backlog).

## 3. Archivos a crear / modificar

| Archivo | Acción | Descripción |
|---|---|---|
| `src/db/schema.ts` | Modificar | Tabla `auditLogs` + tipos inferidos |
| `drizzle/0001_*.sql` | Crear (via `drizzle-kit generate`) | Migración versionada de `audit_logs` |
| `src/lib/audit.ts` | Crear | Helper `recordAudit` reutilizable |
| `src/lib/dal.ts` | Modificar | `listAuditLogs(tenantId, filtros)` con paginación |
| `src/app/actions/products.ts` | Modificar | Envolver cada mutación + auditoría en `db.transaction` |
| `src/app/actions/auth.ts` | Modificar | Auditoría de `login_success`, `login_failed`, `logout` |
| `app/dashboard/audit/page.tsx` | Crear | Vista con filtros por acción / usuario / fecha |
| `app/api/audit/export/route.ts` | Crear | Exportación CSV autenticada y aislada por tenant |

## 4. Requisitos de código

### 4.1 Esquema `auditLogs` (`src/db/schema.ts`)
- Columnas:
  - `id` — PK autoincrement.
  - `tenantId` — FK → `tenants.id`, `onDelete: 'cascade'`.
  - `userId` — FK → `users.id`, `onDelete: 'set null'`, **nullable** (la auditoría sobrevive al borrado del usuario).
  - `action` — `text` notNull (ej. `'login_success' | 'login_failed' | 'logout' | 'product_created' | 'product_updated' | 'product_deleted'`).
  - `details` — `text`, `{ mode: 'json' }` + `.$type<Record<string, unknown>>()`, default `'{}'`.
  - `createdAt` — epoch ms con default dinámico: `.default(sql\`(unixepoch() * 1000)\`)` + `.$defaultFn(() => Date.now())`.
- Índice `(tenantId, createdAt)` para las consultas filtradas.
- Generar migración con `npx drizzle-kit generate` (crea `drizzle/0001_*.sql` y actualiza `drizzle/meta/`); aplicar con `npx drizzle-kit migrate` (detecta better-sqlite3 automáticamente).
- **Nunca** editar a mano `drizzle/0000_initial_schema.sql`.

### 4.2 `src/lib/audit.ts`
- `recordAudit({ tenantId, userId, action, details })` que inserta en `auditLogs`.
- `details` solo con datos no sensibles (ej. `{ productId, sku, delta }`); prohibido passwords, hashes o emails completos de terceros.

### 4.3 Auditoría transaccional
- En `products.ts`: cada mutación exitosa y su `recordAudit` deben ejecutarse en la **misma transacción** (`db.transaction`): si la auditoría falla, la mutación se revierte (y viceversa). Mismo criterio en `auth.ts` para login/logout; para `login_failed` registrar el email del intento.
- Orden: validar Zod → leer sesión → transacción (mutación + audit) → publicar evento SSE (Sprint 03) → devolver estado.

### 4.4 Vista `/dashboard/audit`
- Server Component protegido (`getSession()` → redirect si no hay sesión).
- Filtros por `searchParams`: `action`, `from`, `to` (fechas), paginación simple (`page`, límite 50).
- Tabla: fecha, usuario, acción, detalles (JSON formateado compacto). Solo filas del `tenantId` de la sesión (la DAL filtra).
- Enlace a exportar CSV con los mismos filtros.

### 4.5 Export CSV (`app/api/audit/export/route.ts`)
- `GET` con sesión obligatoria (401/redirect sin sesión).
- Respuesta `text/csv; charset=utf-8`, header `Content-Disposition: attachment; filename="audit-<tenantId>.csv"`, con BOM `\uFEFF` (Excel).
- Escape correcto de comas/comillas/saltos de línea en celdas. Solo datos del tenant de la sesión.

## 5. Criterios de Aceptación / Verificación

- [ ] Migración aplica limpia sobre base nueva: borrar `sqlite.db` → `npm run seed` → `npx drizzle-kit migrate` → tabla `audit_logs` existe.
- [ ] Crear producto, mover stock y borrar producto generan filas en `audit_logs` con `tenantId`, `userId`, `action` y `details` correctos.
- [ ] Login exitoso, login fallido y logout quedan auditados.
- [ ] La vista de auditoría del usuario de A **nunca** muestra filas de B (aislamiento).
- [ ] Filtros por acción y rango de fechas funcionan; la paginación no rompe los filtros.
- [ ] CSV descarga, abre en Excel con columnas correctas y solo contiene filas del tenant actual.
- [ ] Simular fallo de auditoría → la mutación de stock NO se aplica (atomicidad transaccional).
- [ ] `npx tsc --noEmit` ✓ y `npm run lint` ✓.

## 6. Validación técnica

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
npm run seed
npx tsc --noEmit
npm run lint
npm run dev   # matriz manual de la sección 5
```

## 7. Riesgos / Notas

- `details` en `text` con `mode: 'json'` es la vía idiomática de Drizzle para SQLite; nunca usar columnas REAL para timestamps.
- Para `login_failed` con usuario inexistente, `userId` es null — no intentar resolver un userId inexistente.
- Mantener el volumen de `details` acotado (campos puntuales, no el objeto completo) para que el CSV y la vista sigan siendo legibles.
