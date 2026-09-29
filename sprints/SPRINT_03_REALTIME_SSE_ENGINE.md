# SPRINT 03 — Motor de Sincronización en Tiempo Real con SSE local

> **Depende de:** Sprint 02 · **Estado:** Pendiente

## 1. Objetivo

Sincronización en tiempo real multi-pestaña y multi-usuario mediante Server-Sent Events (SSE) locales: un Route Handler con Pub/Sub en memoria (EventEmitter de Node.js) y un hook cliente que actualiza el Dashboard en vivo cuando el stock cambia en otra pestaña o por otro usuario del mismo tenant. **Sin websockets de terceros.**

## 2. Alcance

**Dentro:** canal SSE autenticado por tenant, pub/sub en memoria, hook `useRealtimeInventory`, publicación de eventos desde las mutaciones de productos, indicador de conexión en UI.
**Fuera:** broker externo / multi-instancia (limitación consciente del proyecto), SSE para tablas distintas de inventario (el mecanismo es extensible).

## 3. Archivos a crear / modificar

| Archivo | Acción | Descripción |
|---|---|---|
| `src/lib/pubsub.ts` | Crear | Pub/Sub en memoria con canales por tenant (EventEmitter en `globalThis`) |
| `app/api/realtime/sse/route.ts` | Crear | Route Handler GET que sirve el stream `text/event-stream` |
| `src/hooks/useRealtimeInventory.ts` | Crear | Hook cliente con `EventSource` y estados de conexión |
| `src/components/inventory/InventoryTable.tsx` | Modificar | Suscribirse al canal, refrescar en vivo y badge de conexión |
| `src/app/actions/products.ts` | Modificar | Publicar evento tras cada mutación exitosa (reemplazar TODO de Sprint 02) |

## 4. Requisitos de código

### 4.1 `src/lib/pubsub.ts`
- Singleton en `globalThis` (mismo patrón que `src/db/client.ts`): `EventEmitter` con canal por tenant (clave `tenant:{tenantId}`).
- API:
  - `publishInventoryEvent(tenantId, event)` — evento `{ type: 'product_created' | 'product_updated' | 'product_deleted', payload: { productId } }`. **El payload no debe contener `tenantId` ni datos sensibles.**
  - `subscribeToTenant(tenantId, listener)` — devuelve función de unsubscribe.
- `emitter.setMaxListeners(0)` o valor alto documentado; nunca emitir a canales de otros tenants.
- Comentario de arquitectura: válido para **un solo proceso** (deploy local/único); la limitación se documentará en `docs/ARCHITECTURE.md` (Sprint 05).

### 4.2 `app/api/realtime/sse/route.ts`
- `export const dynamic = 'force-dynamic'` (prohibir caché/SSG del stream).
- Método `GET`:
  1. `getSession()` (cookie, async `await cookies()`); sin sesión → `Response` 401.
  2. Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
  3. `new ReadableStream({ start(controller) })` con `TextEncoder`:
     - Enviar `retry: 3000\n\n` y un evento `connected` inicial.
     - Suscribirse con `subscribeToTenant(session.tenantId, listener)`: en cada evento, `controller.enqueue('data: ' + JSON.stringify(event) + '\n\n')`.
     - Heartbeat: `: ping\n\n` (comentario SSE) cada ~25 s (`setInterval`) para mantener viva la conexión.
     - Limpieza: en el `abort` de `request.signal` → `clearInterval` + unsubscribe + `controller.close()`. Sin leaks de listeners.
- `new Response(stream, { headers })`.

### 4.3 `src/hooks/useRealtimeInventory.ts`
- Client Hook: `useRealtimeInventory({ enabled, onEvent })`.
- Si `enabled` es false → no crear `EventSource` (evitar 401s sin sesión).
- `new EventSource('/api/realtime/sse')`; `onmessage` → `JSON.parse` → `onEvent(event)`; expone `connectionState: 'connecting' | 'open' | 'error'` vía `onopen` / `onerror` (EventSource se reconecta solo; documentarlo en el comentario del hook).
- Cleanup en `useEffect` unmount (`source.close()`). Usar un ref para la callback más reciente sin reconectar.

### 4.4 Publicación e integración UI
- En `products.ts`: tras cada mutación exitosa (crear / actualizar / borrar) llamar `publishInventoryEvent(session.tenantId, ...)`.
- `InventoryTable.tsx`: usar el hook y ante cualquier evento de inventario llamar `router.refresh()` (los Server Components re-servirán la lista actualizada) y mostrar un badge "● En vivo" / "○ Reconectando…".

## 5. Criterios de Aceptación / Verificación

- [ ] Dos pestañas del mismo navegador (mismo usuario/tenant): cambiar stock en la pestaña A → la pestaña B lo refleja en ≤ 2 s sin recarga manual.
- [ ] Dos usuarios del mismo tenant: los cambios se ven en tiempo real entre ambos.
- [ ] Usuario del tenant A y usuario del tenant B conectados a la vez: los eventos de A **nunca** llegan al stream de B (verificar con Network/curl y sin datos de tenant en el payload).
- [ ] Petición a `/api/realtime/sse` sin cookie → 401; con cookie válida → stream abierto y evento `connected` recibido.
- [ ] Cerrar la pestaña → el stream se cierra en el servidor (no crecen listeners ni `MaxListenersExceededWarning` en consola).
- [ ] Heartbeats `: ping` llegan periódicamente (verificar en DevTools → Network → EventStream).
- [ ] `npx tsc --noEmit` ✓ y `npm run lint` ✓.

## 6. Validación técnica

```bash
npx tsc --noEmit
npm run lint
npm run dev
# 1) login en 2 pestañas/usuarios  2) mutar stock  3) observar EventStream y la UI
# curl -N -b "session=<cookie>" http://localhost:3000/api/realtime/sse   (stream crudo)
```

## 7. Riesgos / Notas

- `EventSource` no permite headers personalizados: la autenticación va por cookie (correcto en este diseño).
- Pub/Sub en memoria = proceso único; si en el futuro hay multi-instancia, este módulo es el único punto a reemplazar por un broker (contrato de API estable).
- Proxies con buffering rompen SSE: por eso `X-Accel-Buffering: no` y `Cache-Control: no-transform`.
