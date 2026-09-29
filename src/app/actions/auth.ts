'use server';

import { redirect } from 'next/navigation';
import { getUserByEmail } from '@/src/lib/dal';
import { verifyPassword } from '@/src/lib/password';
import { createSession, destroySession } from '@/src/lib/auth';

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
    console.warn(`[auth] login fallido: email no registrado (${email})`);
    return { status: 'error', message: INVALID_CREDENTIALS_MESSAGE };
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    console.warn(`[auth] login fallido: password incorrecto (${user.email})`);
    return { status: 'error', message: INVALID_CREDENTIALS_MESSAGE };
  }

  await createSession({ id: user.id, tenantId: user.tenantId, role: user.role });
  redirect('/dashboard');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/login');
}
