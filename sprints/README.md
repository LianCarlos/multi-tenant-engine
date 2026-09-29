# Sprints — Hoja de Ruta Congelada

> **Instrucción para Agentes de IA:** Cuando el usuario indique "Ejecuta el Sprint X", lee detenidamente el archivo correspondiente `sprints/SPRINT_0X_...md`, implementa todo el código necesario, ejecuta los scripts de validación (`npx tsc --noEmit` y `npm run lint`), verifica que el seed o las pruebas pasen sin errores, y emite un informe final antes de concluir.

## Índice de Sprints

| # | Archivo | Objetivo | Depende de |
|---|---|---|---|
| 01 | `sprints/SPRINT_01_AUTH_AND_DAL.md` | Autenticación local + DAL con aislamiento por `tenant_id` | — |
| 02 | `sprints/SPRINT_02_INVENTORY_CRUD_AND_CONCURRENCY.md` | CRUD de inventario, concurrencia optimista, stock no negativo | Sprint 01 |
| 03 | `sprints/SPRINT_03_REALTIME_SSE_ENGINE.md` | SSE local multi-pestaña y multi-usuario | Sprint 02 |
| 04 | `sprints/SPRINT_04_AUDIT_LOGS_AND_ANALYTICS.md` | Tabla `audit_logs`, auditoría automática, vista + CSV | Sprint 02 (03 recomendado) |
| 05 | `sprints/SPRINT_05_PORTFOLIO_POLISH_AND_CI.md` | Diagrama Mermaid, CI en GitHub Actions, test de aislamiento | Sprints 01–04 |

## Protocolo de Ejecución

1. **Leer antes de codificar**:
   - El archivo del sprint correspondiente (obligatorio).
   - `AGENTS.md`: esta versión de Next.js puede diferir de tu entrenamiento; consulta las guías empaquetadas en `node_modules/next/dist/docs/` antes de escribir código.
   - `docs/SECURITY.md` y `docs/ARCHITECTURE.md` para no romper el modelo de seguridad.
2. **Implementar** todo el código del sprint respetando las reglas del archivo.
3. **Validar** (obligatorio, en este orden):
   - `npx tsc --noEmit`
   - `npm run lint`
   - Verificación funcional específica del sprint (seed, prueba manual o script según el caso).
4. **Emitir informe final** con: archivos creados/modificados, decisiones tomadas, resultados de validación y riesgos abiertos.

## Reglas Inquebrantables del Proyecto

- **Aislamiento multi-tenant**: el `tenantId` SIEMPRE sale de la sesión verificada (`getSession()`); JAMÁS de parámetros del cliente. Cualquier consulta o mutación sin filtro por `tenant_id` es un defecto bloqueante.
- **Cero dependencias cloud**: SQLite, JWT local y SSE. No agregar servicios externos.
- **Convenciones Next 16**: `cookies()` de `next/headers` es async (`await cookies()`); `createSession`/`destroySession` solo desde Server Actions o Route Handlers; Server Actions viven en archivos con `'use server'` y funciones `async`.
- **jose v6**: `setExpirationTime(number)` interpreta el número como timestamp epoch absoluto; la duración relativa se pasa como string (`'7d'` o `` `${segundos}s` ``).
- **SQLite/Drizzle**: defaults de fecha dinámicos (`.default(sql\`(unixepoch() * 1000)\`)` + `.$defaultFn(() => Date.now())`); singleton en `globalThis` (ya implementado en `src/db/client.ts`); todo cambio de schema pasa por `npx drizzle-kit generate` + migración versionada en `drizzle/`.
- **Migraciones**: modificar solo `src/db/schema.ts` y regenerar; nunca editar a mano los archivos SQL existentes en `drizzle/`.

## Criterio de Done por Sprint

- `npx tsc --noEmit` sin errores.
- `npm run lint` sin errores.
- Verificación funcional del sprint completada (checklist del propio archivo del sprint).
- Ningún cambio ajeno al alcance del sprint (no tocar archivos de sprints posteriores salvo indicación explícita).

## Formato del Informe Final

```text
Sprint: SPRINT_0X — <título>
Archivos creados: ...
Archivos modificados: ...
Validación: tsc ✓ / lint ✓ / <verificación funcional> ✓
Decisiones de implementación: ...
Riesgos abiertos: ...
```
