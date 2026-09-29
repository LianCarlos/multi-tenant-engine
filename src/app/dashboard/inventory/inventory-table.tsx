'use client';

import { useOptimistic, useState, useTransition } from 'react';
import type { Product } from '@/src/db/schema';
import { deleteProductAction, updateStockAction } from '@/src/app/actions/product';

interface InventoryTableProps {
  initialProducts: Product[];
}

type OptimisticAction =
  | { type: 'adjust-stock'; productId: number; delta: number }
  | { type: 'remove'; productId: number };

function formatPrice(cents: number | null): string {
  if (cents == null) {
    return '—';
  }
  return `$${(cents / 100).toFixed(2)}`;
}

export function InventoryTable({ initialProducts }: InventoryTableProps) {
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<{ productId: number; message: string } | null>(null);

  const [optimisticProducts, applyOptimistic] = useOptimistic(
    initialProducts,
    (state: Product[], action: OptimisticAction) => {
      if (action.type === 'remove') {
        return state.filter((product) => product.id !== action.productId);
      }
      return state.map((product) =>
        product.id === action.productId
          ? { ...product, stock: product.stock + action.delta }
          : product,
      );
    },
  );

  function handleAdjust(productId: number, delta: number) {
    setRowError(null);
    startTransition(async () => {
      applyOptimistic({ type: 'adjust-stock', productId, delta });
      const result = await updateStockAction(productId, delta);
      if (result.status === 'error') {
        setRowError({ productId, message: result.message ?? 'No se pudo actualizar el stock' });
      }
    });
  }

  function handleDelete(productId: number) {
    setRowError(null);
    startTransition(async () => {
      applyOptimistic({ type: 'remove', productId });
      const result = await deleteProductAction(productId);
      if (result.status === 'error') {
        setRowError({ productId, message: result.message ?? 'No se pudo eliminar el producto' });
      }
    });
  }

  if (optimisticProducts.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        Todavía no hay productos en el inventario.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th className="px-4 py-2 font-medium">SKU</th>
            <th className="px-4 py-2 font-medium">Nombre</th>
            <th className="px-4 py-2 font-medium">Precio</th>
            <th className="px-4 py-2 font-medium">Stock</th>
            <th className="px-4 py-2 font-medium">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
          {optimisticProducts.map((product) => (
            <tr
              key={product.id}
              className={isPending ? 'opacity-60 transition-opacity' : 'transition-opacity'}
            >
              <td className="px-4 py-2 font-mono text-xs">{product.sku}</td>
              <td className="px-4 py-2">{product.name}</td>
              <td className="px-4 py-2">{formatPrice(product.price)}</td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleAdjust(product.id, -1)}
                    aria-label={`Restar stock a ${product.name}`}
                    className="rounded border border-zinc-300 px-2 py-0.5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
                  >
                    −
                  </button>
                  <span className="w-8 text-center tabular-nums">{product.stock}</span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleAdjust(product.id, 1)}
                    aria-label={`Sumar stock a ${product.name}`}
                    className="rounded border border-zinc-300 px-2 py-0.5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
                  >
                    +
                  </button>
                </div>
                {rowError?.productId === product.id && (
                  <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {rowError.message}
                  </p>
                )}
              </td>
              <td className="px-4 py-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleDelete(product.id)}
                  className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
                >
                  Eliminar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
