'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';

export interface AuditTableRow {
  id: number;
  createdAt: number;
  action: string;
  userEmail: string | null;
  details: Record<string, unknown>;
}

interface AuditTableProps {
  logs: AuditTableRow[];
  total: number;
  page: number;
  limit: number;
  /** Query base ya construida por la page (ej. `?action=login_success&from=2026-01-01`), sin `page`. */
  filtersQuery: string;
}

const ACTION_LABELS: Record<string, string> = {
  login_success: 'Login exitoso',
  login_failed: 'Login fallido',
  logout: 'Cierre de sesión',
  product_created: 'Producto creado',
  product_updated: 'Stock actualizado',
  product_deleted: 'Producto eliminado',
};

const ACTION_BADGES: Record<string, string> = {
  login_success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  login_failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  logout: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  product_created: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  product_updated: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  product_deleted: 'bg-red-800 text-red-50 dark:bg-red-950 dark:text-red-200',
};

const UNKNOWN_ACTION_BADGE =
  'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';

function buildPageHref(filtersQuery: string, targetPage: number): string {
  const separator = filtersQuery === '' ? '?' : `${filtersQuery}&`;
  return `/dashboard/audit${separator}page=${targetPage}`;
}

const EMPTY_SUBSCRIBE = () => () => {};

/**
 * Formatea la fecha SOLO tras la hidratación en cliente: el servidor
 * renderiza el cliente en su propia zona horaria y formatear durante el
 * render del servidor provocaría hydration mismatch cuando las zonas
 * difieren. `useSyncExternalStore` devuelve `false` en el snapshot del
 * servidor y React re-renderiza con el snapshot del cliente al hidratar.
 */
function FormattedDate({ value }: { value: number }) {
  const hydrated = useSyncExternalStore(
    EMPTY_SUBSCRIBE,
    () => true,
    () => false,
  );

  if (!hydrated) {
    return <span className="text-zinc-300 dark:text-zinc-700">—</span>;
  }

  return (
    <>
      {new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )}
    </>
  );
}

export function AuditTable({ logs, total, page, limit, filtersQuery }: AuditTableProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {total} {total === 1 ? 'registro' : 'registros'} · Página {page} de {totalPages}
      </p>

      {logs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No hay registros de auditoría que coincidan con los filtros.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Usuario</th>
                <th className="px-4 py-2 font-medium">Acción</th>
                <th className="px-4 py-2 font-medium">Detalles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
              {logs.map((log) => {
                const isExpanded = expandedId === log.id;
                const badgeClassName = ACTION_BADGES[log.action] ?? UNKNOWN_ACTION_BADGE;
                return (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums">
                      <FormattedDate value={log.createdAt} />
                    </td>
                    <td className="px-4 py-2">{log.userEmail ?? 'Usuario eliminado'}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badgeClassName}`}
                      >
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                        aria-expanded={isExpanded}
                        className="text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-400"
                      >
                        {isExpanded ? 'Ocultar' : 'Ver'}
                      </button>
                      {isExpanded && (
                        <pre className="mt-2 max-w-xl overflow-x-auto rounded bg-zinc-100 p-2 text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <nav className="flex items-center gap-4" aria-label="Paginación de auditoría">
        {page <= 1 ? (
          <span className="text-sm text-zinc-400 dark:text-zinc-600">← Anterior</span>
        ) : (
          <Link
            href={buildPageHref(filtersQuery, page - 1)}
            className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50"
          >
            ← Anterior
          </Link>
        )}
        {page >= totalPages ? (
          <span className="text-sm text-zinc-400 dark:text-zinc-600">Siguiente →</span>
        ) : (
          <Link
            href={buildPageHref(filtersQuery, page + 1)}
            className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50"
          >
            Siguiente →
          </Link>
        )}
      </nav>
    </section>
  );
}
