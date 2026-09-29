# SPRINT 01 — Sistema de Autenticación local y DAL con aislamiento por `tenant_id`

> **Depende de:** — (sprint base) · **Estado:** Núcleo parcialmente implementado

## 1. Objetivo

Implementar el sistema de autenticación local y la Capa de Acceso a Datos (DAL) con aislamiento inquebrantable por `tenant_id`, dejando listas las pantallas `/login` y `/dashboard` base, y un seed reproducible con 2 tenants y usuarios de prueba.

## 2. Contexto actual (no reinventar)

- `src/lib/auth.ts` ✅ existe: sesión JWT HS256 (`jose`), cookie `session`, `getSession()` / `createSession()` / `destroySession()`.
- `src/lib/password.ts` ✅ existe: `hashPassword()` / `verifyPassword()` (bcrypt cost 12).
- `src/db/schema.ts` ✅ existe: tablas `tenants`, `users`, `products` con `tenant_id`, índices únicos compuestos `(tenant_id, email)` y `(tenant_id, sku)`.
- `src/db/client.ts` ✅ existe: singleton `globalThis`, WAL, FKs activas, `busy_timeout`.
- `app/` solo tiene `layout.tsx`, `page.tsx`, `globals.css` — faltan `/login` y `/dashboard`.

## 3. Archivos a crear / modificar

| Archivo | Acción | Descripción |
|---|---|---|
| `src/lib/dal.ts` | Crear | DAL: capa única de acceso a datos con filtro de tenant obligatorio |
| `src/app/actions/auth.ts` | Crear | Server Actions `loginAction` y `logoutAction` (`'use server'`) |
| `app/login/page.tsx` | Crear | Página de login (Server Component + formulario cliente) |
| `app/dashboard/page.tsx` | Crear | Dashboard base protegido por sesión |
| `src/db/seed.ts` | Crear | Seed idempotente: 2 tenants + usuarios de prueba |
| `package.json` | Modificar | Script `"seed": "tsx src/db/seed.ts"` + devDependency `tsx` |
| `.env.example` | Modificar (opcional) | Documentar `DATABASE_URL` (por defecto `./sqlite.db`) |

## 4. Requisitos de código

### 4.1 `src/lib/dal.ts`
- Módulo server-only (importa `src/db/client.ts` y `src/db/schema.ts`).
- API mínima:
  - `getUserByEmail(email)` — único caso global sin tenant (el tenant sale del usuario encontrado).
  - `getTenantById(tenantId)`.
  - `listProducts(tenantId)` y `getProductCount(tenantId)` (Sprint 02 agregará `createProduct`, `updateProductStock`, `deleteProduct`).
- **Regla inquebrantable**: toda función de negocio recibe `tenantId` desde la sesión verificada y TODA consulta usa `.where(eq(tabla.tenantId, tenantId))`. Prohibido leer `tenantId` de cualquier input del cliente.
- Documentar la regla con un comentario JSDoc en el encabezado del archivo.

### 4.2 `src/app/actions/auth.ts`
- Archivo con `'use server'` al inicio; todas las funciones `async`.
- `loginAction(prevState, formData)`:
  - Lee `email` y `password` de `formData`; validación manual ligera (no vacíos; Zod llega en Sprint 02).
  - `getUserByEmail` → `verifyPassword` → en éxito `createSession({ id, tenantId, role })` → `redirect('/dashboard')`.
  - En fallo devuelve `{ status: 'error', message: 'Credenciales inválidas' }` — mismo mensaje para email inexistente y password incorrecto (no filtrar qué falló).
  - Nunca loguear passwords; los emails solo en logs de fallo deliberados.
- `logoutAction()`: `destroySession()` → `redirect('/login')`.
- Usar `useActionState` del lado cliente para mostrar errores.
- **Pitfall Next 16**: `cookies()` es async (`await cookies()`); las mutaciones de cookie solo funcionan en Actions/Route Handlers (no en Server Components).

### 4.3 `app/login/page.tsx` + formulario
- Server Component que llama `getSession()`: si hay sesión, `redirect('/dashboard')`.
- `LoginForm` como Client Component (`'use client'`): inputs email/password, `useActionState(loginAction, ...)`, mensaje de error accesible (`role="alert"`), botón deshabilitado mientras `isPending`.
- Tailwind limpio acorde a `docs/UI_UX.md` (utilitario, sin animaciones innecesarias).

### 4.4 `app/dashboard/page.tsx`
- Protegido: `getSession()` → si `null`, `redirect('/login')`.
- Muestra: nombre del tenant (`getTenantById`), email del usuario (de la sesión), contador de productos del tenant y botón de logout (form que invoca `logoutAction`).
- Base lista para que Sprint 02 incorpore la tabla de inventario.

### 4.5 `src/db/seed.ts`
- Script ejecutable con `tsx` (`npm run seed`), idempotente: borrar datos previos en orden por FKs y reinsertar.
- 2 tenants (ej. `ACME Industria` y `Beta Logística`), 2 usuarios por tenant (roles `owner` / `member`), emails y passwords de prueba claros, impresos en consola al final en formato tabla.
- Hashear con `hashPassword()` (bcrypt cost 12). Nunca passwords en texto plano.
- Reutilizar `src/db/client.ts` y el schema (nada de SQL duplicado a mano).

### 4.6 `package.json`
- Añadir devDependency `tsx` y script `"seed": "tsx src/db/seed.ts"`.

## 5. Criterios de Aceptación / Verificación

- [ ] `npm run seed` crea 2 tenants y 4 usuarios sin errores; ejecutado 2 veces seguidas no duplica ni falla (idempotente).
- [ ] Login correcto con un usuario de prueba → cookie `session` httpOnly creada → redirige a `/dashboard`.
- [ ] Login con password incorrecto → mensaje de error visible; login con email inexistente → mismo mensaje (no filtra información).
- [ ] `/dashboard` sin sesión redirige a `/login`; con sesión muestra el tenant correcto del usuario.
- [ ] Logout elimina la cookie y redirige a `/login`.
- [ ] Usuario del tenant A jamás ve productos de B: `listProducts(tenantIdA)` no devuelve filas de B (verificar con datos del seed).
- [ ] `npx tsc --noEmit` ✓ y `npm run lint` ✓.
- [ ] Revisión grep: ningún archivo nuevo lee `tenantId` desde `formData`, query params o body.

## 6. Validación técnica

```bash
npm install            # instala tsx
npm run seed
npx tsc --noEmit
npm run lint
npm run dev            # probar flujo login → dashboard → logout
```

## 7. Riesgos / Notas

- jose v6: la expiración va como string (`` `${SESSION_MAX_AGE_SECONDS}s` ``); un `number` se interpreta como epoch absoluto (sesiones expiradas al instante). `src/lib/auth.ts` ya lo hace bien — no tocar.
- En dev sin `JWT_SECRET`, la clave es efímera: tras reiniciar `next dev`, la cookie vieja queda inválida (comportamiento esperado y documentado).
- El seed reemplaza datos: avisar en el README que borra la BD de desarrollo.
