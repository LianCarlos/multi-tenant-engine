import { EventEmitter } from 'node:events';

/**
 * Pub/Sub en memoria para eventos de inventario, con un canal por tenant
 * (clave `tenant:{tenantId}`) — aislamiento multi-tenant estricto: un evento
 * solo se emite en el canal del tenant que lo originó.
 *
 * ARQUITECTURA: este módulo es válido para UN SOLO proceso (deploy único).
 * Si en el futuro hubiera multi-instancia, este módulo es el único punto a
 * reemplazar por un broker (Redis, etc.): el contrato de API
 * (`publishInventoryEvent` / `subscribeToInventoryEvents`) se mantiene.
 */
export type InventoryEventType =
  | 'product_created'
  | 'product_updated'
  | 'product_deleted';

export interface InventoryEvent {
  type: InventoryEventType;
  /** El payload nunca incluye `tenantId` ni datos sensibles. */
  payload: { productId: number };
}

/**
 * Patrón globalThis (mismo que src/db/client.ts): un único EventEmitter por
 * proceso, estable entre recompilaciones HMR de Next.js.
 */
const globalForEvents = globalThis as unknown as {
  __inventoryEmitter?: EventEmitter;
};

export const inventoryEmitter: EventEmitter =
  globalForEvents.__inventoryEmitter ?? new EventEmitter();

if (process.env.NODE_ENV !== 'production') {
  globalForEvents.__inventoryEmitter = inventoryEmitter;
}

/**
 * Sin límite de listeners: cada conexión SSE registra un listener en el
 * canal de su tenant y el límite por defecto (10) produciría
 * MaxListenersExceededWarning con pocas pestañas abiertas. No hay crecimiento
 * indefinido: cada stream hace unsubscribe en su cleanup (abort/cancel).
 */
inventoryEmitter.setMaxListeners(0);

function tenantChannel(tenantId: number): string {
  return `tenant:${tenantId}`;
}

export function publishInventoryEvent(tenantId: number, event: InventoryEvent): void {
  inventoryEmitter.emit(tenantChannel(tenantId), event);
}

export function subscribeToInventoryEvents(
  tenantId: number,
  listener: (event: InventoryEvent) => void,
): () => void {
  const channel = tenantChannel(tenantId);
  inventoryEmitter.on(channel, listener);
  return () => {
    inventoryEmitter.off(channel, listener);
  };
}
