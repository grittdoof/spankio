import Link from 'next/link';
import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
import { fr } from '@/lib/i18n/fr';
import { AuthShell } from './AuthShell';

/**
 * Formulaire de connexion.
 *
 * Rendu côté serveur et soumis à une action serveur : il fonctionne SANS
 * JavaScript. C'est un choix d'accessibilité et de robustesse, pas une
 * nostalgie — un formulaire d'authentification qui dépend d'un bundle est
 * inutilisable dès que celui-ci échoue.
 */
export function SignInForm({
  action,
  error,
  notice,
}: {
  action: (formData: FormData) => void | Promise<void>;
  error?: string | null;
  notice?: string | null;
}) {
  const t = fr.auth.signIn;

  return (
    <AuthShell
      title={t.title}
      description={t.description}
      footer={
        <>
          <p>
            <Link href="/mot-de-passe-oublie">{t.forgotPassword}</Link>
          </p>
          <p>
            {t.noAccount} <Link href="/inscription">{t.createAccount}</Link>
          </p>
        </>
      }
    >
      {notice ? (
        <div style={{ marginBottom: '1rem' }}>
          <Alert tone="success">{notice}</Alert>
        </div>
      ) : null}
      {error ? (
        <div style={{ marginBottom: '1rem' }}>
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      <form action={action} noValidate>
        <Field id="email" label={t.emailLabel} required>
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          )}
        </Field>

        <Field id="mot-de-passe" label={t.passwordLabel} required>
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          )}
        </Field>

        <button className="sp-btn sp-btn--block sp-btn--lg" type="submit">
          {t.submit}
        </button>
      </form>
    </AuthShell>
  );
}
