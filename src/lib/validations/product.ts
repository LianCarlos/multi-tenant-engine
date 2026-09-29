import { z } from 'zod';

/**
 * Validación de formularios y Server Actions de inventario. Nunca valida ni
 * acepta `tenantId`: siempre viene de la sesión verificada (getSession()),
 * jamás de un input del formulario.
 */

const productIdSchema = z.coerce
  .number()
  .int('Identificador de producto inválido')
  .positive('Identificador de producto inválido');

export const productSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, 'El SKU es obligatorio')
    .max(64, 'El SKU no puede superar 64 caracteres'),
  name: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(128, 'El nombre no puede superar 128 caracteres'),
  // Centavos: entero, opcional (producto sin precio fijo).
  price: z.coerce
    .number()
    .int('El precio debe ser un número entero de centavos')
    .nonnegative('El precio no puede ser negativo')
    .optional(),
  stock: z.coerce
    .number()
    .int('El stock debe ser un número entero')
    .nonnegative('El stock no puede ser negativo')
    .default(0),
});

export type ProductInput = z.infer<typeof productSchema>;

/**
 * Movimiento de stock expresado como delta (+/-), no como valor absoluto:
 * es lo único que permite el compare-and-swap atómico de updateProductStock
 * (DAL) sin perder el valor leído entre el cálculo y la escritura.
 */
export const stockUpdateSchema = z.object({
  productId: productIdSchema,
  delta: z.coerce
    .number()
    .int('El ajuste debe ser un número entero')
    .refine((value) => value !== 0, 'El ajuste no puede ser 0'),
});

export type StockUpdateInput = z.infer<typeof stockUpdateSchema>;

export const deleteProductSchema = z.object({
  productId: productIdSchema,
});

export type DeleteProductInput = z.infer<typeof deleteProductSchema>;
