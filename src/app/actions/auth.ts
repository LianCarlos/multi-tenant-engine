'use server';

import { redirect } from 'next/navigation';
import { createAuditLog, getUserByEmail } from '@/src/lib/dal';
import { verifyPassword } from '@/src/lib/password';
import { createSession, destroySession, getSession } from '@/src/lib/auth';

/**
 * Mismo mensaje para email inexistente y password incorrecto: no filtrar
 * al cliente cuál de las dos credenciales falló.
 */
const INVALID_CREDENTIALS_MESSAGE = 'Credenciales inválidas';

export interface LoginActionState {
  status: 'idle' | 'error';
  message?: string;
}

export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const emailInput = formData.get('email');
  const passwordInput = formData.get('password');

  if (typeof emailInput !== 'string' || typeof passwordInput !== 'string') {
    return { status: 'error', message: INVALID_CREDENTIALS_MESSAGE };
  }

  const email = emailInput.trim();
  const password = passwordInput;

  if (email === '' || password === '') {
    return { status: 'error', message: INVALID_CREDENTIALS_MESSAGE };
  }

  const user = await getUserByEmail(email);
  if (!user) {
    // No se audita: sin usuario no existe tenantId (la FK tenant_id es NOT NULL)
    // y no hay un tenant al que aislar el evento. Mantener el warning operacional.
    console.warn(`[auth] login fallido: email no registrado (${email})`);
    return { status: 'error', message: INVALID_CREDENTIALS_MESSAGE };
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    console.warn(`[auth] login fallido: password incorrecto (${user.email})`);
    // Se audita el email del intento (permitido por la spec); NUNCA el hash.
    // Si la auditoría falla, el error se propaga: el login NO se completa.
    await createAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'login_failed',
      details: { email },
    });
    return { status: 'error', message: INVALID_CREDENTIALS_MESSAGE };
  }

  await createSession({ id: user.id, tenantId: user.tenantId, role: user.role });
  // La auditoría va tras createSession y ANTES del redirect. No se captura el
  // error: si falla, la acción se interrumpe y el login no se completa (spec).
  await createAuditLog({
    tenantId: user.tenantId,
    userId: user.id,
    action: 'login_success',
    details: { email: user.email },
  });
  redirect('/dashboard');
}

export async function logoutAction(): Promise<void> {
  // No hace falta db.transaction aquí: junto al audit no hay mutación de BD
  // (destroySession solo borra la cookie httpOnly) y el insert de auditoría
  // es una única sentencia atómica en SQLite. Si el audit falla, el error se
  // propaga y el logout no se completa (spec transaccional).
  const session = await getSession();
  if (session) {
    await createAuditLog({
      tenantId: session.tenantId,
      userId: Number(session.sub),
      action: 'logout',
      details: {},
    });
  }
  await destroySession();
  redirect('/login');
}
