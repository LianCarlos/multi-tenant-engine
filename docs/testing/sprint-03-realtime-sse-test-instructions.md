# Sprint 03 — Instrucciones de Testeo: Motor Realtime SSE local

> Ciclo: Sprint 03 (Motor de Sincronización en Tiempo Real con SSE local) · Estado: implementado y verificado · Documento de QA obligatorio.

## 1. Alcance implementado

| Componente | Archivo | Qué hace |
|---|---|---|
| Pub/Sub en memoria | `src/lib/events.ts` | `EventEmitter` singleton en `globalThis`; un canal por tenant (`tenant:{tenantId}`); eventos `product_created` / `product_updated` / `product_deleted` con payload mínimo `{ productId }` (sin `tenantId` ni datos sensibles); `setMaxListeners(0)`; API `publishInventoryEvent(tenantId, event)` y `subscribeToInventoryEvents(tenantId, listener)` → función de unsubscribe. |
| Route Handler SSE | `src/app/api/realtime/sse/route.ts` | `GET` autenticado por JWT de la cookie `session`; 401 sin sesión; `dynamic = 'force-dynamic'`; headers SSE (`text/event-stream`, `no-cache, no-transform`, `keep-alive`, `X-Accel-Buffering: no`); envía `retry: 3000`, evento `connected`, y re-emite eventos del tenant como `event: inventory_updated`; heartbeat `: ping` cada 25 s; cleanup completo en `abort`/`cancel` (flag `cleanedUp`, `clearInterval`, unsubscribe, `controller.close()`). |
| Publicación de eventos | `src/app/actions/product.ts` | Las 3 mutaciones (`createProductAction`, `updateStockAction`, `deleteProductAction`) publican al canal del tenant **solo tras éxito** y luego revalidan `/dashboard` y `/dashboard/inventory`. |
| Hook cliente | `src/app/dashboard/inventory/use-realtime-inventory.ts` | `EventSource('/api/realtime/sse')` con estados `connecting` / `open` / `error`; suscripción a `event: inventory_updated` vía `addEventListener` + `onmessage` como fallback; validación de forma del payload (`isInventoryEvent`); callback en `ref` sin recrear la conexión; cleanup con `source.close()`. |
| UI | `src/app/dashboard/inventory/inventory-table.tsx` | Badge de conexión (`● En vivo` / `○ Conectando…` / `○ Reconectando…`) y `router.refresh()` ante cada evento para re-servir los Server Components. |

## 2. Prerequisitos y entorno

- [ ] Node.js instalado (mínimo la versión usada por el repo; ver `package.json` `engines`).
- [ ] Dependencias instaladas: `npm install`.
- [ ] Base de datos sembrada: `npm run seed` (idempotente: borra y recrea datos de prueba; **no correr contra datos reales**).
- [ ] Servidor en ejecución: `npm run dev` (por defecto `http://localhost:3000`).
- [ ] En desarrollo, si `JWT_SECRET` no está definido, el servidor genera una clave efímera por proceso (`src/lib/auth.ts`): las sesiones no sobreviven a reinicios del servidor. Para pruebas estables entre reinicios, exportar un `JWT_SECRET` fijo antes de `npm run dev`.

## 3. Datos de prueba (creados por `npm run seed`)

Credenciales definidas en `src/db/seed.ts`:

| Tenant | Email | Contraseña | Rol |
|---|---|---|---|
| Empresa Alfa | `owner@alfa.test` | `Alfa123!owner` | owner |
| Empresa Alfa | `member@alfa.test` | `Alfa123!member` | member |
| Empresa Beta | `owner@beta.test` | `Beta123!owner` | owner |
| Empresa Beta | `member@beta.test` | `Beta123!member` | member |

Productos sembrados: Alfa → `ALF-001` (stock 20), `ALF-002` (stock 5) · Beta → `BET-001` (stock 40), `BET-002` (stock 12).

## 4. Pruebas felices (manuales)

### Feliz A — Dos pestañas, mismo usuario/tenant
- [ ] Iniciar sesión como `owner@alfa.test` en la pestaña A y abrir `/dashboard/inventory`.
- [ ] Duplicar la pestaña (misma sesión) → pestaña B también en `/dashboard/inventory`.
- [ ] En A, pulsar `+` o `−` en un producto (p. ej. `ALF-001`).
- [ ] Observar B **sin recargar** durante 2 s.

**Criterio de aceptación:** el stock actualizado de A aparece en B en **≤ 2 s** sin recarga manual. **Resultado esperado:** badge de B en `● En vivo` y stock igual al de A (más el ajuste aplicado también de forma optimista en A).

### Feliz B — Dos usuarios del mismo tenant
- [ ] Pestaña A: sesión `owner@alfa.test` en `/dashboard/inventory`.
- [ ] Pestaña B (ventana de incógnito): sesión `member@alfa.test` en `/dashboard/inventory`.
- [ ] En A, crear un producto con el formulario (SKU único, p. ej. `ALF-003`).
- [ ] En A, ajustar stock y luego eliminar el producto creado.
- [ ] Observar B en cada paso.

**Criterio de aceptación:** los cambios (alta, ajuste, baja) se reflejan en B en tiempo real. **Resultado esperado:** B muestra el producto nuevo, el stock ajustado y su desaparición sin recargar (vía `router.refresh()`).

### Feliz C — Aislamiento entre tenants
- [ ] Pestaña A: sesión `owner@alfa.test` en `/dashboard/inventory`.
- [ ] Pestaña B (incógnito): sesión `owner@beta.test` en `/dashboard/inventory`.
- [ ] En A, mutar stock de `ALF-001` varias veces.
- [ ] En B, abrir DevTools → Network → filtrar `sse` → inspeccionar el EventStream de `/api/realtime/sse`.
- [ ] Opcional (stream crudo de B): `curl -N -H "Cookie: session=<cookie_de_B>" http://localhost:3000/api/realtime/sse` mientras A muta.

**Criterio de aceptación:** los eventos de A **nunca** llegan al stream de B. **Resultado esperado:** el EventStream de B solo muestra `retry: 3000`, `event: connected` y `: ping`; ningún frame `inventory_updated`, ningún dato del tenant de A en payloads.

## 5. Casos borde

### Borde A — 401 sin sesión / cookie inválida
- [ ] `curl -i http://localhost:3000/api/realtime/sse` (sin cookie) → **401**.
- [ ] `curl -i -H "Cookie: session=token_invalido" http://localhost:3000/api/realtime/sse` → **401**.

**Resultado esperado:** ambos devuelven `401` con cuerpo `Unauthorized` y sin headers de stream.

### Borde B — Stream con cookie válida
- [ ] Iniciar sesión y copiar la cookie `session` (DevTools → Application → Cookies → `session`).
- [ ] `curl -N -H "Cookie: session=<cookie>" http://localhost:3000/api/realtime/sse` y dejar correr ≥ 30 s.

**Resultado esperado:** el stream inicia con `retry: 3000`, luego `event: connected` con `data: {"ok":true}`, y un comentario `: ping` aproximadamente cada 25 s.

### Borde C — Cierre de pestaña sin fugas en el servidor
- [ ] Con una pestaña conectada a `/dashboard/inventory`, abrir otra pestaña también conectada (para sumar listeners).
- [ ] Cerrar una de las pestañas y observar la consola del servidor (`npm run dev`).

**Resultado esperado:** el stream de la pestaña cerrada termina (abort → cleanup) y no aparece `MaxListenersExceededWarning` ni crecimiento sostenido de listeners (`listenerCount` del canal vuelve a bajar).

### Borde D — Logout o sesión expirada (comportamiento conocido)
- [ ] Con la pestaña en `/dashboard/inventory` y el stream abierto, hacer logout (o invalidar la cookie).
- [ ] Observar DevTools → Network en la pestaña.

**Resultado esperado (conocido):** el EventSource recibe `401`, pasa a estado `error` (`○ Reconectando…`) y **reintenta cada 3 s** (por `retry: 3000`) mientras la cookie siga inválida. **Deuda registrada:** gestión explícita del estado `auth` en el cliente queda para Sprint 05.

## 6. Validaciones de regresión (Sprints 01–02)

- [ ] **Login/logout:** iniciar sesión con `owner@alfa.test` y cerrar sesión correctamente; redirecciones a `/login` y `/dashboard` funcionan.
- [ ] **CRUD de productos:** crear un producto con SKU nuevo, verlo en la tabla, editarlo (stock) y eliminarlo.
- [ ] **SKU duplicado:** intentar crear un producto con `ALF-001` → error visible "Ese SKU ya existe en tu empresa" y sin evento publicado.
- [ ] **Stock negativo:** intentar restar stock por debajo de 0 → error "El stock no puede quedar por debajo de 0" y el valor no cambia.
- [ ] **Conflicto CAS (`STOCK_CONFLICT`):** con dos pestañas del mismo tenant, mutar el mismo producto casi a la vez → la operación concurrente perdedora muestra "El stock cambió en otra pestaña o por otro usuario. Reintenta."
- [ ] **Navegación:** ir y volver entre `/dashboard` y `/dashboard/inventory` sin errores ni recargas inesperadas; el badge reaparece correctamente.

## 7. Verificaciones ya ejecutadas (resultados reales del ciclo)

- `npx tsc --noEmit` → **verde, sin errores**.
- `npm run lint` → **verde, sin warnings**.
- **Aislamiento pub/sub con Node puro:** tenant 1 recibió exactamente 1 evento, tenant 2 recibió 0; payload `{"type":"product_updated","payload":{"productId":7}}` sin `tenantId`; tras unsubscribe, `listenerCount` volvió a 0; 15 listeners en un canal sin `MaxListenersExceededWarning`.
- **Endpoint:** 401 sin cookie y con cookie inválida; con cookie válida (JWT firmado con jose contra `JWT_SECRET` de dev) el stream devolvió `retry: 3000`, `event: connected\ndata: {"ok":true}` y `: ping` a los 25 s.

## 8. Limitación documentada

El Pub/Sub en memoria (`src/lib/events.ts`) es válido para **UN solo proceso** (deploy único). En un escenario multi-instancia este módulo es el único punto a reemplazar por un broker (Redis, etc.), manteniendo el contrato de API `publishInventoryEvent` / `subscribeToInventoryEvents` ya documentado en el propio archivo.
