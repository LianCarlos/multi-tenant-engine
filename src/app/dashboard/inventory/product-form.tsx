'use client';

import { useActionState, useEffect, useRef } from 'react';
import { createProductAction, type ProductActionState } from '@/src/app/actions/product';

const initialState: ProductActionState = { status: 'idle' };

export function ProductForm() {
  const [state, formAction, isPending] = useActionState(createProductAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === 'success') {
      formRef.current?.reset();
    }
  }, [state.status]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-wrap items-end gap-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="sku" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          SKU
        </label>
        <input
          id="sku"
          name="sku"
          required
          className="w-32 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {state.fieldErrors?.sku && (
          <p className="text-xs text-red-600 dark:text-red-400">{state.fieldErrors.sku[0]}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Nombre
        </label>
        <input
          id="name"
          name="name"
          required
          className="w-48 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {state.fieldErrors?.name && (
          <p className="text-xs text-red-600 dark:text-red-400">{state.fieldErrors.name[0]}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="price" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Precio (centavos)
        </label>
        <input
          id="price"
          name="price"
          type="number"
          min={0}
          step={1}
          placeholder="Opcional"
          className="w-32 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {state.fieldErrors?.price && (
          <p className="text-xs text-red-600 dark:text-red-400">{state.fieldErrors.price[0]}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="stock" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Stock inicial
        </label>
        <input
          id="stock"
          name="stock"
          type="number"
          min={0}
          step={1}
          defaultValue={0}
          className="w-24 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {state.fieldErrors?.stock && (
          <p className="text-xs text-red-600 dark:text-red-400">{state.fieldErrors.stock[0]}</p>
        )}
      </div>

      {state.status === 'error' && state.message && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {isPending ? 'Agregando…' : 'Agregar producto'}
      </button>
    </form>
  );
}
