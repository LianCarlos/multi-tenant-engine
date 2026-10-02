# Guía de Contribución

## Sistema de Ramas

- Todo el código debe desarrollarse en ramas con el formato `feature/<nombre-funcionalidad>`.
- Prohibido hacer push directo a las ramas principales (`main` / `beta`).

## Pull Requests

- Todo cambio se integra exclusivamente mediante Pull Request.
- **Revisión cruzada obligatoria**: ningún colaborador puede aprobar ni fusionar su propio PR. Todo Pull Request debe ser revisado y aprobado por otro miembro del equipo antes de su integración.
- El propósito de la revisión cruzada es asegurar la calidad de la arquitectura.

## Reglas de Arquitectura

Antes de implementar, lee obligatoriamente:

- `docs/ARCHITECTURE.md` — stack y patrón multi-tenant.
- `docs/SECURITY.md` — aislamiento multi-tenant vía DAL (filtro `tenant_id` desde la sesión verificada).
- `docs/UI_UX.md` — directrices de estilo y rendimiento.

## Gate de CI

- Todo Pull Request debe pasar el workflow de CI (`.github/workflows/ci.yml`) antes de fusionarse: `npx tsc --noEmit`, `npm run lint`, `npm run seed`, `npm run test:isolation` y `npm run build`.
- El CI se ejecuta automáticamente en cada push a `main`/`beta` y en cada Pull Request.
- Cualquier paso en rojo bloquea el merge.
