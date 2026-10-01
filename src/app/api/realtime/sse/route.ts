import { getSession } from '@/src/lib/auth';
import { subscribeToInventoryEvents } from '@/src/lib/events';

export const dynamic = 'force-dynamic';

const HEARTBEAT_INTERVAL_MS = 25_000;

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };

  const encoder = new TextEncoder();

  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    clearInterval(heartbeat);
    unsubscribe?.();
    try {
      controllerRef?.close();
    } catch {
      // El stream ya estaba cerrado (desconexión del cliente): nada que limpiar.
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;

      if (request.signal.aborted) {
        cleanup();
        return;
      }

      controller.enqueue(encoder.encode('retry: 3000\n\n'));
      controller.enqueue(encoder.encode('event: connected\ndata: {"ok":true}\n\n'));

      unsubscribe = subscribeToInventoryEvents(session.tenantId, (event) => {
        controller.enqueue(
          encoder.encode(`event: inventory_updated\ndata: ${JSON.stringify(event)}\n\n`),
        );
      });

      // Heartbeat SSE: un comentario (ignorado por los clientes) que mantiene
      // viva la conexión y evita que proxies intermedios cierren el stream.
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': ping\n\n'));
      }, HEARTBEAT_INTERVAL_MS);

      request.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, { headers });
}
