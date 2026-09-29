import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

/**
 * REGLA DE ARQUITECTURA (multi-tenant):
 * El `tenantId` SIEMPRE debe obtenerse de la sesión verificada en el
 * servidor mediante getSession(). JAMÁS debe usarse un tenantId enviado
 * por el cliente (query params, body, headers): cualquier tenantId de
 * origen cliente es falsificable y rompería el aislamiento entre tenants.
 *
 * Este módulo es server-only: debe invocarse desde Server Actions o
 * Route Handlers, nunca desde Client Components.
 */

export const SESSION_COOKIE_NAME = 'session';
/**
 * 7 días en segundos (máximo especificado para la cookie y el JWT).
 * Nota: en jose v6, setExpirationTime interpreta un `number` como
 * timestamp epoch absoluto; la duración relativa se pasa como string
 * con unidad (p. ej. `${SESSION_MAX_AGE_SECONDS}s`).
 */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const JWT_ALGORITHM = 'HS256';

export interface SessionPayload {
  /** ID del usuario (subject del JWT, string por convención de jose). */
  sub: string;
  tenantId: number;
  role: string;
}

/** Subconjunto de la fila `users` necesario para crear la sesión. */
export interface SessionUser {
  id: number;
  tenantId: number;
  role: string;
}

// === Secreto de firma ===

/**
 * Resuelve la clave de firma HMAC (HS256) de los JWT.
 *
 * - Producción: JWT_SECRET es obligatorio. Si no está definido, se lanza
 *   un error (fail fast): firmar sesiones con un secreto predecible las
 *   haría falsificables.
 * - Desarrollo: si JWT_SECRET no está definido, se genera una clave
 *   aleatoria de 256 bits UNA VEZ por proceso y se avisa con una única
 *   console.warn. Limitación documentada: en dev con múltiples procesos
 *   o workers, cada proceso firma con una clave distinta y las sesiones
 *   se invalidan entre reinicios/workers; es un tradeoff de conveniencia
 *   solo aceptable fuera de producción.
 */
const globalForAuth = globalThis as unknown as {
  __devJwtSecret?: string;
  __devJwtSecretWarned?: boolean;
};

function getJwtSecret(): Uint8Array {
  const configured = process.env.JWT_SECRET;

  if (configured) {
    return new TextEncoder().encode(configured);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET no está definido. En producción es obligatorio definir JWT_SECRET (clave aleatoria de al menos 256 bits).',
    );
  }

  if (!globalForAuth.__devJwtSecretWarned) {
    console.warn(
      '[auth] JWT_SECRET no está definido: usando una clave aleatoria efímera de desarrollo. ' +
        'Las sesiones no sobrevivirán a reinicios del servidor ni serán compartidas entre workers. ' +
        'En producción es obligatorio definir JWT_SECRET.',
    );
    globalForAuth.__devJwtSecretWarned = true;
  }

  globalForAuth.__devJwtSecret ??= randomBytes(32).toString('hex');
  return new TextEncoder().encode(globalForAuth.__devJwtSecret);
}

// === Validación del payload ===

function isSessionPayload(
  payload: JWTPayload,
): payload is SessionPayload & JWTPayload {
  return (
    typeof payload.sub === 'string' &&
    typeof payload.tenantId === 'number' &&
    typeof payload.role === 'string'
  );
}

// === API de sesión ===

/**
 * Crea la sesión: firma un JWT HS256 (expiración 7 días) y lo escribe en
 * la cookie httpOnly `session` (sameSite 'lax', secure en producción).
 *
 * Debe llamarse desde una Server Action o Route Handler: Next.js lanza
 * error si se mutan cookies desde un Server Component (fase de render),
 * por eso el set está envuelto en try/catch con mensaje explícito.
 */
export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({
    sub: String(user.id),
    tenantId: user.tenantId,
    role: user.role,
  } satisfies SessionPayload)
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getJwtSecret());

  const store = await cookies();
  try {
    store.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  } catch (error) {
    throw new Error(
      'createSession: debe llamarse desde una Server Action o Route Handler, no desde un Server Component',
      { cause: error },
    );
  }
}

/**
 * Lee la cookie `session`, verifica firma y expiración del JWT y devuelve
 * el payload, o `null` si no hay sesión válida.
 *
 * Nunca se confía en datos del cliente: cualquier fallo (firma inválida,
 * token expirado, malformado o payload con forma incorrecta) devuelve null.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: [JWT_ALGORITHM],
    });

    if (!isSessionPayload(payload)) {
      return null;
    }

    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

/**
 * Elimina la cookie `session` (cierre de sesión).
 *
 * Igual que createSession, debe llamarse desde una Server Action o
 * Route Handler, no desde un Server Component.
 */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  try {
    store.delete(SESSION_COOKIE_NAME);
  } catch (error) {
    throw new Error(
      'destroySession: debe llamarse desde una Server Action o Route Handler, no desde un Server Component',
      { cause: error },
    );
  }
}
