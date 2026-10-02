# Instrucciones de Testeo — Sprint 05: Portfolio Polish, Hardening & CI

> Ciclo implementado, verificado y commiteado. Documento obligatorio para QA / CTO / integración.
> Código fuente de verdad: `src/app/api/audit/export/route.ts`, `.github/workflows/ci.yml`, `scripts/tenant-isolation-test.mjs`.

## 1. Alcance implementado

- **Sanitizador anti Formula Injection** en `src/app/api/audit/export/route.ts`: `sanitizeCsvCell` antepone `'` cuando la celda empieza por `=`, `+`, `-`, `@`, tab (`\t`) o `\r`. Se aplica **antes** del escape RFC 4180 (`formatCsvCell` = `escapeCsvCell(sanitizeCsvCell(...))`) a **todas** las celdas (encabezado y filas).
- **Workflow CI** `.github/workflows/ci.yml`: triggers `push` a `main`/`beta` + `pull_request`; Node 22 (prebuilds de better-sqlite3 v13); `npm ci`; pasos en orden: tsc → lint → seed → test:isolation → build; incluye `concurrency` (cancel-in-progress), `permissions: contents: read` y `timeout-minutes: 15`.
- **Test de aislamiento** `scripts/tenant-isolation-test.mjs`: Node puro (`node:assert` + better-sqlite3), SQLite `:memory:` con `PRAGMA foreign_keys = ON` ejecutado **antes** del DDL real de `drizzle/*.sql` (leído en orden). 8 aserciones: A1 ×3 tablas (products, users, audit_logs), A2 (SKU entre/dentro de tenants), A3 (email entre/dentro de tenants), A4 (cascade al borrar tenant), A5 (ON DELETE SET NULL de user_id), A6 (documental: query sin filtro cruza tenants). Salida ✓/✗ por aserción, exit 0/1 con mensaje claro.
- **Documentación**: `docs/ARCHITECTURE.md` con 4 diagramas Mermaid + ADRs; `README.md` bilingüe EN/ES; `CONTRIBUTING.md` con gate de CI obligatorio.

## 2. Prerequisitos y entorno

- Node 22 o 24 instalado (better-sqlite3 v13 trae prebuilds; evita compilar).
- Dependencias instaladas de forma reproducible: `npm ci`.
- Base de datos sembrada (destructiva, solo dev): `npm run seed`.
- Cuenta GitHub con permisos de push para ver la pestaña Actions.

## 3. Datos de prueba

- **Login**: `owner@alfa.test` / `Alfa123!owner` (tenant Alfa, role owner) — generadas por `npm run seed`.
- **CSV con vectores**: para generar celdas que disparen el sanitizador, crear/editar/borrar productos cuyos nombres comiencen con `=`, `+`, `-`, `@` (p. ej. `=HYPERLINK("http://evil")` como nombre de producto) y luego exportar auditoría desde `/dashboard/audit`.
- El test de aislamiento crea sus propios fixtures en memoria; no requiere datos previos.

## 4. Pasos de prueba

### 4.1 Local — Test de aislamiento (`npm run test:isolation`)

- [ ] Ejecutar `npm run test:isolation`: proceso termina con exit 0, resumen `Aserciones pasadas: 8`, `Aserciones fallidas: 0` y `✓ Aislamiento multi-tenant verificado`.
- [ ] Verificar que la salida muestra 8 líneas `✓` (A1 ×3, A2, A3, A4, A5, A6) y la advertencia documental de A6 (sin filtro = cruza tenants, por eso la DAL es obligatoria).
- [ ] Verificar el encabezado: `DDL: aplicadas 2 migraciones en SQLite :memory: (foreign_keys = ON)`.
- [ ] **Caso borde (fallo intencional)**: copiar el script a `scripts/tmp-broken-test.mjs`, romper una aserción (p. ej. quitar `WHERE tenant_id = ?` en A1), ejecutar `node scripts/tmp-broken-test.mjs` → exit 1, `✗` con mensaje claro y resumen con fallos. Eliminar la copia al terminar.

### 4.2 CSV — Sanitización anti Formula Injection

- [ ] Login como `owner@alfa.test`, generar 1–2 eventos de auditoría (crear/editar/borrar producto con nombre que empiece por `=` o `+`).
- [ ] En `/dashboard/audit`, exportar CSV y abrirlo en editor de texto (no en Excel).
- [ ] Comprobar que toda celda que empieza por `=`, `+`, `-`, `@`, tab o `\r` recibe prefijo `'` (p. ej. `'=HYPERLINK(...)`).
- [ ] Comprobar que el archivo empieza con BOM (`\uFEFF`) y que el escape RFC 4180 sigue intacto (celdas con `"` → `""` y envueltas en comillas).
- [ ] **Caso borde**: celda con `"` y `,` a la vez → envuelta y duplicada correctamente.
- [ ] **Caso borde**: celda que empieza con `+123` o `-45` (números maliciosos) → recibe `'`.

### 4.3 CI — Workflow de GitHub Actions

- [ ] Hacer push de una rama de feature y abrir PR contra `main` o `beta` → el workflow `CI` aparece en la pestaña Actions.
- [ ] Verificar que el workflow queda verde completo: tsc → lint → seed → test:isolation → build, los 5 pasos en orden.
- [ ] **Caso borde**: introducir un error de tipos temporal en la rama y pushear → el paso `tsc` falla y el PR queda en rojo (luego revertir).
- [ ] Confirmar que un push directo a `main`/`beta` también dispara el workflow (si tienes permisos; en su defecto, confiar en el trigger declarado).

### 4.4 Build de producción

- [ ] Ejecutar `npm run build` → termina con `Compiled successfully`.
- [ ] Verificar en la salida las 7 rutas: `/`, `/login`, `/dashboard`, `/dashboard/inventory`, `/dashboard/audit`, `/api/audit/export`, `/api/realtime/sse`.
- [ ] Sin errores de tipo ni warnings de lint que rompan el build.

### 4.5 Documentación — Diagramas Mermaid

- [ ] Abrir `docs/ARCHITECTURE.md` en VS Code (vista previa) y GitHub: los 4 diagramas Mermaid renderizan (sistema, secuencia auth, secuencia SSE, modelo de datos).
- [ ] Verificar que los ADRs y el modelo de seguridad referencian `docs/SECURITY.md` (regla del `tenantId` desde sesión).
- [ ] Verificar `CONTRIBUTING.md` → sección "Gate de CI" lista los 5 pasos y exige CI verde antes de merge.

### 4.6 Regresión Sprints 01–04

- [ ] **Auth (S01)**: login/logout con credenciales del seed; cookie HttpOnly; acceso sin sesión redirige a `/login`.
- [ ] **Inventario CAS (S02)**: dos pestañas con el mismo usuario, decremento concurrente de stock → una operación gana, la otra recibe error de concurrencia; stock nunca queda negativo.
- [ ] **SSE en vivo (S03)**: dos sesiones con el mismo tenant; una mutación en el inventario se refleja en la otra sin recargar (evento `inventory_updated`).
- [ ] **Auditoría + export CSV (S04)**: las acciones quedan registradas en `/dashboard/audit`; el CSV exportado contiene solo eventos del tenant de la sesión y sigue saneado (sección 4.2).

## 5. Verificaciones ya ejecutadas (resultados reales)

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` | ✓ sin errores |
| `npm run lint` | ✓ sin errores |
| `npm run seed` | ✓ idempotente, credenciales generadas |
| `npm run test:isolation` | ✓ 8/8 aserciones, exit 0 |
| Fallo intencional del test | ✓ exit 1 con mensaje claro |
| `npm run build` | ✓ `Compiled successfully` |
| Revisión arquitectónica | Aprobado — 0 críticos, 0 altos; hallazgo MEDIO de RLS en `CONTRIBUTING.md` corregido (ahora referencia DAL) |

## 6. Criterios de aceptación verificables

- [ ] `test:isolation` en verde (8 ✓, exit 0) y falla con mensaje claro al romper una aserción.
- [ ] Celdas CSV peligrosas reciben `'`; BOM y RFC 4180 intactos.
- [ ] `ci.yml` visible en Actions y verde completo en el primer PR/push.
- [ ] Build con las 7 rutas compiladas.
- [ ] 4 diagramas Mermaid renderizan en VS Code/GitHub.
- [ ] Regresión 01–04 sin fallos.

## 7. Notas

- **El CI aún no ha corrido en GitHub**: el primer push/PR confirmará el workflow real (los pasos locales ya pasaron en su totalidad).
- **`npm run seed` es destructivo**: borra y reinserta datos; jamás ejecutarlo contra una base con información real o en producción.
- El test de aislamiento lee `drizzle/*.sql` en orden: si el esquema cambia, el test se adapta solo — mantener esa convención (no reemplazar por fixtures hardcodeados).
