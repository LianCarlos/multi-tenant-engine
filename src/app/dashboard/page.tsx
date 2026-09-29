import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/src/lib/auth';
import { getTenantById, getUserById, getProductCount } from '@/src/lib/dal';
import { logoutAction } from '@/src/app/actions/auth';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const [tenant, user, productCount] = await Promise.all([
    getTenantById(session.tenantId),
    getUserById(Number(session.sub), session.tenantId),
    getProductCount(session.tenantId),
  ]);

  return (
    <main className="flex flex-1 flex-col gap-6 bg-zinc-50 p-8 dark:bg-black">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Tenant</p>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {tenant?.name ?? 'Tenant desconocido'}
          </h1>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Cerrar sesión
          </button>
        </form>
      </header>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Usuario</p>
        <p className="text-base text-zinc-900 dark:text-zinc-50">
          {user?.email ?? 'Desconocido'} · {session.role}
        </p>

        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Productos en inventario</p>
        <p className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">{productCount}</p>

        <Link
          href="/dashboard/inventory"
          className="mt-4 inline-block text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50"
        >
          Ir al inventario →
        </Link>
      </section>
    </main>
  );
}
