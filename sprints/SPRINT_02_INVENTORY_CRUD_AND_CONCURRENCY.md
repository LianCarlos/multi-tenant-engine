# SPRINT 02 — CRUD de Inventario con concurrencia optimista y stock no negativo

> **Depende de:** Sprint 01 · **Estado:** Pendiente

## 1. Objetivo

Gestión completa de inventario: Server Actions de CRUD (`createProduct`, `updateStock`, `deleteProduct`), formularios con validación Zod, UI de tabla interactiva con estados de carga optimistas (`useOptimistic`) y rechazo estricto cuando el stock intenta bajar de 0.

## 2. Alcance

**Dentro:** CRUD de productos del tenant actual, validación Zod, actualización optimista de UI, control de concurrencia (compare-and-swap), errores amigables.
**Fuera:** Auditoría (Sprint 04), tiempo real SSE (Sprint 03; este sprint deja el punto de enganche listo).

## 3. Archivos a crear / modificar

| Archivo | Acción | Descripción |
|---|---|---|
| `package.json` | Modificar | Añadir dependencia `zod` (`npm install zod`) |
| `src/lib/validation.ts` | Crear | Schemas Zod: producto y movimiento de stock |
| `src/app/actions/products.ts` | Crear | Server Actions `createProduct`, `updateStock`, `deleteProduct` |
| `src/lib/dal.ts` | Modificar | Agregar `createProduct`, `updateProductStock` (CAS), `deleteProduct`, `getProductById` |
| `app/dashboard/inventory/page.tsx` | Crear | Página server que lista productos del tenant |
| `src/components/inventory/ProductForm.tsx` | Crear | Formulario cliente de alta de producto (Zod + `useActionState`) |
| `src/components/inventory/InventoryTable.tsx` | Crear | Tabla cliente interactiva con `useOptimistic` |
| `app/dashboard/page.tsx` | Modificar | Enlazar a `/dashboard/inventory` |

## 4. Requisitos de código

### 4.1 Validación Zod (`src/lib/validation.ts`)
- `productSchema`: `sku` (1–64, trim), `name` (1–128), `price` (int ≥ 0, opcional, **centavos**), `stock` (int ≥ 0, default 0).
- `stockUpdateSchema`: `productId` (int > 0), `delta` (int ≠ 0).
- Mensajes de error en español, listos para mostrar en UI.
- Los Server Actions usan `safeParse` y devuelven `{ status: 'error', fieldErrors }` o `{ status: 'success' }` (nunca lanzan excepciones de validación).

### 4.2 DAL (`src/lib/dal.ts`)
- `createProduct(tenantId, data)`, `getProductById(tenantId, productId)`, `deleteProduct(tenantId, productId)` (devuelve si borró o no), `updateProductStock(tenantId, productId, delta)`.
- **Concurrencia optimista (compare-and-swap)** en `updateProductStock`:
  1. Lee el producto con filtro `tenant_id` (si no existe o es de otro tenant → `null`).
  2. Calcula `newStock = stock + delta`; si `newStock < 0` → error de dominio `STOCK_NEGATIVE` (nunca llega a la BD).
  3. Ejecuta `UPDATE ... SET stock = <newStock> WHERE id = ? AND tenant_id = ? AND stock = <valor leído>` e inspecciona `changes`: si `0` → conflicto `STOCK_CONFLICT` (otra transacción ganó).
- Todo con `.where(eq(..., tenantId))` obligatorio; errores de dominio tipados (no excepciones genéricas).

### 4.3 Server Actions (`src/app/actions/products.ts`)
- Archivo `'use server'`, funciones `async`.
- Patrón común: `getSession()` → si no hay sesión `redirect('/login')` → `safeParse` → llamar DAL con `session.tenantId` → en éxito `revalidatePath('/dashboard/inventory')` y devolver `{ status: 'success' }`.
- Mapeo de errores de dominio a mensajes:
  - Stock negativo → "El stock no puede quedar por debajo de 0".
  - Conflicto → "El stock cambió en otra pestaña o por otro usuario. Reintenta.".
  - SKU duplicado (constraint) → "Ese SKU ya existe en tu empresa".
- `deleteProduct`: el WHERE por `tenant_id` garantiza que no se borran productos de otros tenants; si `changes = 0`, mensaje claro.
- Punto de enganche para Sprints 03/04: dejar comentario `// TODO(sprint-03): publicar evento` tras cada mutación exitosa.

### 4.4 UI optimista (`InventoryTable.tsx`)
- Client Component que recibe `initialProducts` desde el server.
- `useOptimistic` para stock (suma delta al vuelo) y para borrado (filtra fila al instante); `useTransition` para estados pendientes (filas atenuadas, botones deshabilitados).
- Si el servidor responde error, el estado optimista revierte automáticamente y se muestra el mensaje del action (sin recargar la página).
- `ProductForm.tsx`: campos con errores por campo, botón con estado de carga.

## 5. Criterios de Aceptación / Verificación

- [ ] Crear producto con SKU válido → aparece en tabla sin recarga completa; SKU duplicado dentro del tenant → error amigable; mismo SKU en otro tenant → permitido.
- [ ] `updateStock` +5 / −2 funciona; la fila se actualiza optimistamente y persiste tras refrescar.
- [ ] Stock 5, delta −10 → error visible "no puede quedar por debajo de 0" y el stock sigue en 5 (verificar en BD).
- [ ] Concurrencia: abrir el mismo producto en 2 pestañas, bajar stock en ambas casi a la vez → exactamente una operación gana; la perdedora recibe el mensaje de conflicto y la UI revierte.
- [ ] Borrar producto propio lo elimina; intentar borrar un producto de otro tenant (simulado) → no-op con mensaje.
- [ ] `useOptimistic`: mientras la acción está pendiente la UI ya refleja el cambio; si falla, revierte.
- [ ] `npx tsc --noEmit` ✓ y `npm run lint` ✓.

## 6. Validación técnica

```bash
npm install zod
npx tsc --noEmit
npm run lint
npm run dev   # probar la matriz manual de la sección 5
```

## 7. Riesgos / Notas

- Precios en centavos (`integer`): el formulario convierte la entrada de moneda a centavos y la muestra formateada.
- SQLite serializa escrituras: el CAS protege contra lecturas obsoletas; no usar `REPLACE` ni `INSERT OR REPLACE` (borrarían filas y romperían el filtro por tenant).
- El mensaje de conflicto debe ofrecer reintento (botón o instrucción), no solo informar.
