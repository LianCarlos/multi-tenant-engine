'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/src/db/client';
import { getSession } from '@/src/lib/auth';
import {
  createAuditLog,
  createProduct,
  deleteProduct,
  getProductById,
  updateProductStock,
  type StockUpdateError,
} from '@/src/lib/dal';
import { publishInventoryEvent } from '@/src/lib/events';
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

  const result = db.transaction((tx) => {
    const txResult = createProduct(session.tenantId, parsed.data, tx);
    if (txResult.ok) {
      createAuditLog(
        {
          tenantId: session.tenantId,
          userId: Number(session.sub),
          action: 'product_created',
          details: {
            productId: txResult.product.id,
            sku: txResult.product.sku,
            stock: txResult.product.stock,
            price: txResult.product.price,
          },
        },
        tx,
      );
    }
    return txResult;
  });

  if (!result.ok) {
    return { status: 'error', message: 'Ese SKU ya existe en tu empresa' };
  }

  publishInventoryEvent(session.tenantId, {
    type: 'product_created',
    payload: { productId: result.product.id },
  });
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

  const result = db.transaction((tx) => {
    const txResult = updateProductStock(
      session.tenantId,
      parsed.data.productId,
      parsed.data.delta,
      tx,
    );
    if (txResult.ok) {
      createAuditLog(
        {
          tenantId: session.tenantId,
          userId: Number(session.sub),
          action: 'product_updated',
          details: {
            productId: txResult.product.id,
            sku: txResult.product.sku,
            stockAnterior: txResult.product.stock - parsed.data.delta,
            stockNuevo: txResult.product.stock,
            delta: parsed.data.delta,
          },
        },
        tx,
      );
    }
    return txResult;
  });

  if (!result.ok) {
    return { status: 'error', message: STOCK_ERROR_MESSAGES[result.error] };
  }

  publishInventoryEvent(session.tenantId, {
    type: 'product_updated',
    payload: { productId: parsed.data.productId },
  });
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

  // Lectura del SKU DENTRO de la transacción (con `tx`): evita una carrera
  // entre la lectura previa y el DELETE, y garantiza que el detalle auditado
  // es exactamente la fila que se va a borrar.
  const deleted = db.transaction((tx) => {
    const existing = getProductById(session.tenantId, parsed.data.productId, tx);
    const txDeleted = deleteProduct(session.tenantId, parsed.data.productId, tx);
    if (txDeleted && existing) {
      createAuditLog(
        {
          tenantId: session.tenantId,
          userId: Number(session.sub),
          action: 'product_deleted',
          details: { productId: existing.id, sku: existing.sku },
        },
        tx,
      );
    }
    return txDeleted;
  });

  if (!deleted) {
    return {
      status: 'error',
      message: 'No se pudo eliminar: el producto no existe o no pertenece a tu empresa',
    };
  }

  publishInventoryEvent(session.tenantId, {
    type: 'product_deleted',
    payload: { productId: parsed.data.productId },
  });
  revalidateInventory();
  return { status: 'success' };
}
