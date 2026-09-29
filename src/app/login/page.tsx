import { redirect } from 'next/navigation';
import { getSession } from '@/src/lib/auth';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect('/dashboard');
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Iniciar sesión
        </h1>
        <LoginForm />
      </div>
    </main>
  );
}
