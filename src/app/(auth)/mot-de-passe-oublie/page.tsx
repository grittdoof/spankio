import type { Metadata } from 'next';
import { PasswordResetRequestForm } from '@/components/auth/PasswordResetForm';
import { authErrorMessage, fr } from '@/lib/i18n/fr';
import { requestPasswordReset } from '../actions';

export const metadata: Metadata = { title: fr.auth.forgotPassword.title };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorCode = typeof params['erreur'] === 'string' ? params['erreur'] : undefined;

  return (
    <PasswordResetRequestForm
      action={requestPasswordReset}
      error={authErrorMessage(errorCode)}
      notice={params['ok'] === 'envoye' ? fr.auth.forgotPassword.sent : null}
    />
  );
}
