import type { Metadata } from 'next';
import { NewPasswordForm } from '@/components/auth/PasswordResetForm';
import { authErrorMessage, fr } from '@/lib/i18n/fr';
import { updatePassword } from '../actions';

export const metadata: Metadata = { title: fr.auth.newPassword.title };

export default async function NewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorCode = typeof params['erreur'] === 'string' ? params['erreur'] : undefined;

  return <NewPasswordForm action={updatePassword} error={authErrorMessage(errorCode)} />;
}
