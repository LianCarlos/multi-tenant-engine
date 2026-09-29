# Seguridad

Modelo: **SQLite local + Drizzle ORM**, multi-tenancy vía `tenant_id`, autenticación local con JWT en cookie.

## Modelo de confianza
Toda la autorización parte de la sesión JWT verificada en el servidor con `getSession()` (`src/lib/auth.ts`). El frontend solo reacciona a los datos permitidos y no contiene lógica de seguridad. El `tenantId` SIEMPRE viene de la sesión verificada, JAMÁS de parámetros del cliente (query, body o headers).

## Aislamiento multi-tenant
Cada fila de `users` y `products` lleva `tenant_id` (FK a `tenants.id`). Toda consulta y mutación debe filtrar por el `tenantId` de la sesión; cualquier `tenantId` de origen cliente es falsificable y rompería el aislamiento.

## Credenciales
Contraseñas solo como hash bcrypt (`bcryptjs`, cost 12). Nunca en texto plano ni en logs.

## Sesión
Cookie `session` httpOnly, `sameSite=lax`, `secure` en producción. JWT HS256 firmado con `JWT_SECRET`, obligatorio en producción (en desarrollo hay fallback efímero con warning).
