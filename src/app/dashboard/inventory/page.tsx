import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/src/lib/auth';
import { listProducts } from '@/src/lib/dal';
import { ProductForm } from './product-form';
import { InventoryTable } from './inventory-table';

export default async function InventoryPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const initialProducts = await listProducts(session.tenantId);

  return (
    <main className="flex flex-1 flex-col gap-6 bg-zinc-50 p-8 dark:bg-black">
      <header>
        <Link
          href="/dashboard"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← Volver al dashboard
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Inventario</h1>
      </header>

      <ProductForm />
      <InventoryTable initialProducts={initialProducts} />
    </main>
  );
}
