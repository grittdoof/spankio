import type { Metadata } from 'next';
import { SignInForm } from '@/components/auth/SignInForm';
import { authErrorMessage, fr } from '@/lib/i18n/fr';
import { signIn } from '../actions';

export const metadata: Metadata = { title: fr.auth.signIn.title };

const NOTICES: Readonly<Record<string, string>> = {
  motDePasse: fr.auth.newPassword.updated,
  confirmation: fr.auth.signUp.confirmationSent,
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorCode = typeof params['erreur'] === 'string' ? params['erreur'] : undefined;
  const noticeCode = typeof params['ok'] === 'string' ? params['ok'] : undefined;

  return (
    <SignInForm
      action={signIn}
      error={authErrorMessage(errorCode)}
      notice={noticeCode ? (NOTICES[noticeCode] ?? null) : null}
    />
  );
}
