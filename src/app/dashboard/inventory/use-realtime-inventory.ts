'use client';

import { useEffect, useRef, useState } from 'react';
import type { InventoryEvent } from '@/src/lib/events';

export type RealtimeConnectionState = 'connecting' | 'open' | 'error';

interface UseRealtimeInventoryOptions {
  enabled: boolean;
  onEvent: (event: InventoryEvent) => void;
}

function isInventoryEvent(value: unknown): value is InventoryEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.type !== 'product_created' &&
    candidate.type !== 'product_updated' &&
    candidate.type !== 'product_deleted'
  ) {
    return false;
  }
  const payload = candidate.payload;
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  return typeof (payload as Record<string, unknown>).productId === 'number';
}

/**
 * Suscribe el componente al stream SSE de inventario de su tenant.
 *
 * EventSource se reconecta automáticamente (usando el `retry:` que envía el
 * servidor): ante un `onerror` NO recreamos la instancia manualmente, solo
 * reflejamos el estado `error` mientras el navegador reintenta.
 */
export function useRealtimeInventory({
  enabled,
  onEvent,
}: UseRealtimeInventoryOptions): { connectionState: RealtimeConnectionState } {
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('connecting');

  // Ref con el callback más reciente: permite que `onEvent` cambie entre
  // renders sin destruir/recrear el EventSource (que de otro modo perdería
  // el estado de conexión y reconectaría innecesariamente).
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const source = new EventSource('/api/realtime/sse');

    source.onopen = () => setConnectionState('open');
    source.onerror = () => setConnectionState('error');

    // El servidor emite los eventos de inventario con NOMBRE
    // (`event: inventory_updated`). En SSE, los eventos con nombre NO disparan
    // `onmessage`: el navegador despacha un evento propio en el EventSource.
    // Nos suscribimos al nombre concreto y mantenemos `onmessage` como
    // fallback por si en el futuro hubiera frames sin campo `event:`.
    const handleFrame = (event: Event) => {
      if (!(event instanceof MessageEvent)) {
        return;
      }
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (isInventoryEvent(parsed)) {
          onEventRef.current(parsed);
        }
      } catch {
        // Frame no JSON (los comentarios SSE `: ping` nunca llegan aquí).
      }
    };

    source.addEventListener('inventory_updated', handleFrame);
    source.onmessage = handleFrame;

    return () => {
      source.close();
    };
  }, [enabled]);

  return { connectionState };
}
