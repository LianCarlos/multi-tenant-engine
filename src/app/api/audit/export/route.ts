import { getSession } from '@/src/lib/auth';
import { getTenantAuditLogs } from '@/src/lib/dal';
import { AUDIT_ACTIONS, type AuditAction } from '@/src/db/schema';

export const dynamic = 'force-dynamic';

function isAuditAction(value: string | null): value is AuditAction {
  return value !== null && (AUDIT_ACTIONS as readonly string[]).includes(value);
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

/** Valida `yyyy-mm-dd` y rechaza fechas que no existan (p. ej. 31/02). */
function parseLocalDate(value: string | null): LocalDateParts | null {
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
function startOfDayMs(value: string | null): number | undefined {
  const parsed = parseLocalDate(value);
  if (!parsed) {
    return undefined;
  }
  return new Date(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0).getTime();
}

/** Fin del día en hora LOCAL (23:59:59.999) como epoch ms. */
function endOfDayMs(value: string | null): number | undefined {
  const parsed = parseLocalDate(value);
  if (!parsed) {
    return undefined;
  }
  return new Date(parsed.year, parsed.month - 1, parsed.day, 23, 59, 59, 999).getTime();
}

/**
 * Escapa una celda CSV (RFC 4180): si contiene comillas, comas o saltos de
 * línea, se envuelve en comillas duplicando las comillas internas.
 */
function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const actionRaw = url.searchParams.get('action');
  const fromRaw = url.searchParams.get('from');
  const toRaw = url.searchParams.get('to');

  const action = isAuditAction(actionRaw) ? actionRaw : undefined;
  const from = startOfDayMs(fromRaw);
  const to = endOfDayMs(toRaw);

  // Sin page/limit: todas las filas del tenant con los filtros aplicados.
  const { logs } = await getTenantAuditLogs(session.tenantId, { action, from, to });

  const rows = [
    ['Fecha', 'Usuario', 'Acción', 'Detalles'].map(escapeCsvCell).join(','),
    ...logs.map((log) =>
      [
        new Date(log.createdAt).toISOString(),
        log.userEmail ?? '',
        log.action,
        JSON.stringify(log.details),
      ]
        .map(escapeCsvCell)
        .join(','),
    ),
  ];

  const csv = rows.join('\r\n');

  return new Response(`\uFEFF${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-${session.tenantId}.csv"`,
    },
  });
}
