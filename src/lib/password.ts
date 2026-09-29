import bcrypt from 'bcryptjs';

/**
 * Cost factor de bcrypt: 12 rondas (~250 ms por hash en hardware moderno).
 * Equilibra seguridad y latencia percibida en login.
 */
const BCRYPT_COST = 12;

/**
 * Genera un hash bcrypt del password recibido.
 *
 * Manejo de errores:
 * - Lanza si el password está vacío: hashear una cadena vacía es un bug
 *   de llamador, no un caso de negocio.
 * - Lanza si el password excede 72 bytes (límite intrínseco de bcrypt):
 *   guardar el hash truncado permitiría logins con un password distinto
 *   del real, así que se falla explícitamente en lugar de truncar en silencio.
 * - Si el hashing falla (p. ej. falta de entropía del generador), propaga
 *   un error con contexto mediante `cause` para que el llamador decida.
 */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length === 0) {
    throw new Error('hashPassword: el password no puede estar vacío');
  }

  const plainBytes = new TextEncoder().encode(plain);
  if (plainBytes.length > 72) {
    throw new Error(
      'hashPassword: el password excede el límite de 72 bytes de bcrypt',
    );
  }

  try {
    return await bcrypt.hash(plain, BCRYPT_COST);
  } catch (error) {
    throw new Error('hashPassword: no se pudo generar el hash', { cause: error });
  }
}

/**
 * Compara un password en texto plano contra un hash bcrypt almacenado.
 *
 * Manejo de errores:
 * - Un hash malformado en la BD o cualquier fallo interno devuelve `false`
 *   (nunca lanza): el resultado es indistinguible de un password incorrecto
 *   y no bloquea el flujo de login. Se registra en consola para poder
 *   depurar datos corruptos.
 * - La comparación en sí es de tiempo constante respecto del hash (bcrypt
 *   re-deriva la clave con la salt del hash almacenado).
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch (error) {
    console.error(
      '[password] verifyPassword: hash malformado o comparación fallida',
      error,
    );
    return false;
  }
}
