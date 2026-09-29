'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSession } from '@/src/lib/auth';
import {
  createProduct,
  deleteProduct,
  updateProductStock,
  type StockUpdateError,
} from '@/src/lib/dal';
import {
  productSchema,
  stockUpdateSchema,
  deleteProductSchema,
} from '@/src/lib/validations/product';

export interface ProductActionState {
  status: 'idle' | 'error' | 'success';
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

const DASHBOARD_PATH = '/dashboard';
const INVENTORY_PATH = '/dashboard/inventory';

function revalidateInventory() {
  revalidatePath(DASHBOARD_PATH);
  revalidatePath(INVENTORY_PATH);
}

const STOCK_ERROR_MESSAGES: Record<StockUpdateError, string> = {
  NOT_FOUND: 'Producto no encontrado',
  STOCK_NEGATIVE: 'El stock no puede quedar por debajo de 0',
  STOCK_CONFLICT: 'El stock cambió en otra pestaña o por otro usuario. Reintenta.',
};

export async function createProductAction(
  _prevState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const priceRaw = formData.get('price');
  const stockRaw = formData.get('stock');

  const parsed = productSchema.safeParse({
    sku: formData.get('sku'),
    name: formData.get('name'),
    price: priceRaw === null || priceRaw === '' ? undefined : priceRaw,
    stock: stockRaw === null || stockRaw === '' ? undefined : stockRaw,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Revisa los campos marcados',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const result = await createProduct(session.tenantId, parsed.data);
  if (!result.ok) {
    return { status: 'error', message: 'Ese SKU ya existe en tu empresa' };
  }

  // TODO(sprint-03): publicar evento
  revalidateInventory();
  return { status: 'success' };
}

export async function updateStockAction(
  productId: number,
  delta: number,
): Promise<ProductActionState> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const parsed = stockUpdateSchema.safeParse({ productId, delta });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Ajuste de stock inválido',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const result = await updateProductStock(
    session.tenantId,
    parsed.data.productId,
    parsed.data.delta,
  );

  if (!result.ok) {
    return { status: 'error', message: STOCK_ERROR_MESSAGES[result.error] };
  }

  // TODO(sprint-03): publicar evento
  revalidateInventory();
  return { status: 'success' };
}

export async function deleteProductAction(productId: number): Promise<ProductActionState> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const parsed = deleteProductSchema.safeParse({ productId });
  if (!parsed.success) {
    return { status: 'error', message: 'Producto inválido' };
  }

  const deleted = await deleteProduct(session.tenantId, parsed.data.productId);
  if (!deleted) {
    return {
      status: 'error',
      message: 'No se pudo eliminar: el producto no existe o no pertenece a tu empresa',
    };
  }

  // TODO(sprint-03): publicar evento
  revalidateInventory();
  return { status: 'success' };
}
