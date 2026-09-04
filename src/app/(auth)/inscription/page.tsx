import type { Metadata } from 'next';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { authErrorMessage, fr } from '@/lib/i18n/fr';
import { isEmailConfigured } from '@/lib/config/env';
import { signUp } from '../actions';

export const metadata: Metadata = { title: fr.auth.signUp.title };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorCode = typeof params['erreur'] === 'string' ? params['erreur'] : undefined;
  const confirmed = params['ok'] === 'confirmation';

  return (
    <SignUpForm
      action={signUp}
      error={authErrorMessage(errorCode)}
      notice={
        confirmed
          ? // On ne promet pas un courriel qui ne partira pas : sans expéditeur
            // configuré, l'écran dit la vérité et oriente vers l'administrateur.
            isEmailConfigured()
            ? fr.auth.signUp.confirmationSent
            : fr.auth.signUp.confirmationSentNoEmail
          : null
      }
    />
  );
}
