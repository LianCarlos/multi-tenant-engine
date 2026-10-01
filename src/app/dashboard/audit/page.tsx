import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/src/lib/auth';
import { getTenantAuditLogs } from '@/src/lib/dal';
import { AUDIT_ACTIONS, type AuditAction } from '@/src/db/schema';
import { AuditTable, type AuditTableRow } from './audit-table';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<AuditAction, string> = {
  login_success: 'Login exitoso',
  login_failed: 'Login fallido',
  logout: 'Cierre de sesión',
  product_created: 'Producto creado',
  product_updated: 'Stock actualizado',
  product_deleted: 'Producto eliminado',
};

interface AuditPageProps {
  searchParams: Promise<{
    action?: string | string[];
    from?: string | string[];
    to?: string | string[];
    page?: string | string[];
  }>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

function isAuditAction(value: string | undefined): value is AuditAction {
  return value !== undefined && (AUDIT_ACTIONS as readonly string[]).includes(value);
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

/** Valida `yyyy-mm-dd` y rechaza fechas que no existan (p. ej. 31/02). */
function parseLocalDate(value: string | undefined): LocalDateParts | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Inicio del día en hora LOCAL (00:00:00.000) como epoch ms. */
function startOfDayMs(value: string | undefined): number | undefined {
  const parsed = parseLocalDate(value);
  if (!parsed) {
    return undefined;
  }
  return new Date(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0).getTime();
}

/** Fin del día en hora LOCAL (23:59:59.999) como epoch ms. */
function endOfDayMs(value: string | undefined): number | undefined {
  const parsed = parseLocalDate(value);
  if (!parsed) {
    return undefined;
  }
  return new Date(parsed.year, parsed.month - 1, parsed.day, 23, 59, 59, 999).getTime();
}

function parsePage(value: string | undefined): number {
  if (!value) {
    return 1;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const params = await searchParams;

  const actionRaw = firstParam(params.action);
  const fromRaw = firstParam(params.from);
  const toRaw = firstParam(params.to);

  const action = isAuditAction(actionRaw) ? actionRaw : undefined;
  const from = startOfDayMs(fromRaw);
  const to = endOfDayMs(toRaw);
  const page = parsePage(firstParam(params.page));

  const { logs, total } = await getTenantAuditLogs(session.tenantId, {
    action,
    from,
    to,
    page,
    limit: PAGE_SIZE,
  });

  // Query base con SOLO los filtros válidos, para reutilizar en la paginación
  // y en el enlace de exportación CSV (sin `page`).
  const filtersQuery = [
    action !== undefined && `action=${encodeURIComponent(action)}`,
    from !== undefined && `from=${encodeURIComponent(fromRaw ?? '')}`,
    to !== undefined && `to=${encodeURIComponent(toRaw ?? '')}`,
  ]
    .filter((part): part is string => part !== false)
    .join('&');
  const queryWithLeadingMark = filtersQuery === '' ? '' : `?${filtersQuery}`;

  const rows: AuditTableRow[] = logs.map((log) => ({
    id: log.id,
    createdAt: log.createdAt,
    action: log.action,
    userEmail: log.userEmail,
    details: log.details,
  }));

  return (
    <main className="flex flex-1 flex-col gap-6 bg-zinc-50 p-8 dark:bg-black">
      <header>
        <Link
          href="/dashboard"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← Volver al dashboard
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Auditoría</h1>
      </header>

      <section className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <form method="get" action="/dashboard/audit" className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="action"
              className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Acción
            </label>
            <select
              id="action"
              name="action"
              defaultValue={action ?? ''}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="">Todas</option>
              {AUDIT_ACTIONS.map((option) => (
                <option key={option} value={option}>
                  {ACTION_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="from"
              className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Desde
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={fromRaw ?? ''}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="to"
              className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Hasta
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={toRaw ?? ''}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>

          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Filtrar
          </button>
        </form>

        <Link
          href={`/api/audit/export${queryWithLeadingMark}`}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Exportar CSV
        </Link>
      </section>

      <AuditTable
        logs={rows}
        total={total}
        page={page}
        limit={PAGE_SIZE}
        filtersQuery={queryWithLeadingMark}
      />
    </main>
  );
}
