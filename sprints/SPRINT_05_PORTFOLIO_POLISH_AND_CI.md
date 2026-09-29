# SPRINT 05 — Pulido de portafolio, diagrama de arquitectura y CI

> **Depende de:** Sprints 01–04 · **Estado:** Pendiente

## 1. Objetivo

Preparación profesional para producción y documentación de arquitectura: diagrama de arquitectura en código Mermaid en `docs/ARCHITECTURE.md`, workflow de GitHub Actions para verificar tipos (`tsc`) y linting en cada PR, y script de prueba end-to-end de aislamiento entre tenants.

## 2. Alcance

**Dentro:** documentación arquitectónica completa (Mermaid), CI en GitHub Actions, test de aislamiento ejecutable, scripts npm, estado final del README.
**Fuera:** deployment real (VPS/containers), E2E de navegador (Playwright), cobertura completa de tests unitarios.

## 3. Archivos a crear / modificar

| Archivo | Acción | Descripción |
|---|---|---|
| `docs/ARCHITECTURE.md` | Reescribir | Documento completo con diagramas Mermaid y registro de decisiones |
| `.github/workflows/ci.yml` | Crear | CI: `tsc --noEmit` + `lint` + seed + test de aislamiento |
| `scripts/tenant-isolation-test.mjs` | Crear | Prueba end-to-end de aislamiento entre tenants (SQL crudo) |
| `package.json` | Modificar | Script `"test:isolation": "node scripts/tenant-isolation-test.mjs"` |
| `README.md` | Modificar | Actualizar estado de sprints a completado y documentar `test:isolation` |
| `CONTRIBUTING.md` | Modificar (si aplica) | Mencionar el gate de CI obligatorio para merge |

## 4. Requisitos de código

### 4.1 `docs/ARCHITECTURE.md`
- Reescribir por completo (hoy es una línea). Contenido mínimo:
  - **Diagrama 1 — Vista de sistema** (`flowchart` Mermaid): Navegador → Server Actions/Route Handlers → DAL → SQLite; rama SSE → Pub/Sub.
  - **Diagrama 2 — Secuencia de autenticación** (`sequenceDiagram`): login → `verifyPassword` → `createSession` → cookie.
  - **Diagrama 3 — Secuencia SSE** (`sequenceDiagram`): mutación → publish → stream → EventSource → refresh.
  - **Diagrama 4 — Modelo de datos** (`erDiagram`): `tenants`, `users`, `products`, `audit_logs` y sus relaciones.
  - **Registro de decisiones (ADR)**: SQLite local vs cloud; JWT en cookie vs sesión de BD; SSE vs WebSockets; DAL vs RLS; precios en centavos; CAS para stock.
  - **Modelo de seguridad** (referenciando `docs/SECURITY.md`): regla del `tenantId` desde sesión, flags de cookie, bcrypt, secretos.
  - **Limitaciones conscientes**: pub/sub en memoria (proceso único), SQLite un solo escritor, y cómo evolucionar cada una.
- Los diagramas deben renderizar en GitHub y en la vista previa de VS Code.

### 4.2 `.github/workflows/ci.yml`
- Triggers: `pull_request` (todas las ramas) y `push` a `main` / `beta`.
- Job único `verify` con `ubuntu-latest`, `actions/checkout@v4`, `actions/setup-node@v4` (Node 22 o 24 — better-sqlite3 v13 tiene prebuilds), `npm ci`.
- Pasos en orden:
  1. `npx tsc --noEmit` (tipos).
  2. `npm run lint` (ESLint).
  3. `npm run seed` (integridad del seed; es idempotente).
  4. `npm run test:isolation` (aislamiento entre tenants).
- Cache opcional de `npm` (actions/cache) — no obligatorio.
- Cualquier paso en rojo bloquea el PR.

### 4.3 `scripts/tenant-isolation-test.mjs`
- Node puro (`node:assert` + `better-sqlite3`), sin frameworks de test, base de datos **en memoria** (`new Database(':memory:')`).
- Aplica el DDL real: leer `drizzle/*.sql` ordenados por nombre (`fs.readdirSync`) y ejecutarlos — así el test valida las migraciones tal cual están.
- Fixtures: 2 tenants, usuarios por tenant, productos con SKUs repetidos entre tenants pero no dentro.
- Aserciones (que fallen con mensaje claro y `process.exit(1)`):
  1. Consulta con filtro `tenant_id = A` no devuelve filas de B (`products`, `users`, `audit_logs`).
  2. SKU idéntico en tenant A y B → OK (distintos tenants); SKU duplicado dentro del mismo tenant → viola constraint.
  3. Email duplicado dentro del mismo tenant → viola constraint; mismo email en otro tenant → OK.
  4. `DELETE` del tenant A elimina en cascada sus products/users, pero **nada** de B.
  5. Borrar un usuario conserva sus `audit_logs` con `user_id = NULL` (verifica `set null`).
  6. Una query "maliciosa" sin filtro de tenant devuelve filas de ambos → demuestra por qué la DAL es obligatoria (imprimir advertencia documental si pasa).
- Salida: resumen por aserción (`✓` / `✗`) y exit code 0/1.

### 4.4 `package.json` y docs
- Añadir `"test:isolation": "node scripts/tenant-isolation-test.mjs"`.
- `README.md`: marcar sprints 01–05 como completados y añadir `npm run test:isolation` a la sección de validación.
- `CONTRIBUTING.md`: exigir CI verde antes de merge (leer el archivo actual y ajustar sin reescribirlo entero).

## 5. Criterios de Aceptación / Verificación

- [ ] Los 4 diagramas Mermaid renderizan correctamente (VS Code Preview / GitHub).
- [ ] `ci.yml` es sintácticamente válido y el flujo queda visible en GitHub tras el push (pestaña Actions).
- [ ] `npm run test:isolation` → exit 0 con todas las aserciones ✓.
- [ ] Romper intencionalmente una aserción (p. ej. quitar filtro de tenant en el fixture) → el test falla con mensaje claro y exit 1.
- [ ] `npx tsc --noEmit` ✓, `npm run lint` ✓, `npm run seed` ✓ (repetible).
- [ ] `README.md` refleja el estado real (sprints completados, comandos de validación).
- [ ] PR de ejemplo contra `beta` ejecuta el workflow y pasa completo.

## 6. Validación técnica

```bash
node scripts/tenant-isolation-test.mjs
npx tsc --noEmit
npm run lint
npm run seed
# subir rama → abrir PR → verificar Actions
```

## 7. Riesgos / Notas

- El test corre contra DDL real en memoria: si el schema cambia en el futuro, el test se adapta solo leyendo `drizzle/*.sql` — mantener esa convención.
- No usar Jest/Vitest para este artefacto: mantener el repo con dependencias mínimas es parte del discurso del portafolio.
- `ubuntu-latest` con `npm ci` necesita `package-lock.json` versionado (ya existe; no borrarlo).
