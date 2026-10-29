import type { Metadata } from 'next';
import { SignInForm } from '@/components/auth/SignInForm';
import { safeAfterSignIn } from '@/lib/auth/after-sign-in';
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
  // Bornée DÈS la lecture : la valeur affichée dans le champ caché est déjà
  // celle que l'action acceptera, jamais celle qui a été demandée.
  const suite = safeAfterSignIn(
    typeof params['suite'] === 'string' ? params['suite'] : undefined,
  );

  return (
    <SignInForm
      action={signIn}
      error={authErrorMessage(errorCode)}
      notice={noticeCode ? (NOTICES[noticeCode] ?? null) : null}
      suite={suite === '/admin' ? null : suite}
    />
  );
}
