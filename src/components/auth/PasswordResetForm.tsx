import Link from 'next/link';
import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
import { fr } from '@/lib/i18n/fr';
import { AuthShell } from './AuthShell';

/**
 * Demande de réinitialisation.
 *
 * La confirmation est la MÊME que l'adresse existe ou non : répondre « compte
 * inconnu » permettrait d'énumérer les comptes de la plateforme.
 */
export function PasswordResetRequestForm({
  action,
  error,
  notice,
}: {
  action: (formData: FormData) => void | Promise<void>;
  error?: string | null;
  notice?: string | null;
}) {
  const t = fr.auth.forgotPassword;

  return (
    <AuthShell
      title={t.title}
      description={t.description}
      footer={<Link href="/connexion">{t.backToSignIn}</Link>}
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
        <Field id="email" label={fr.auth.signIn.emailLabel} required>
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

        <button className="sp-btn sp-btn--block sp-btn--lg" type="submit">
          {t.submit}
        </button>
      </form>
    </AuthShell>
  );
}

/** Saisie du nouveau mot de passe, après ouverture du lien reçu par courriel. */
export function NewPasswordForm({
  action,
  error,
  notice,
}: {
  action: (formData: FormData) => void | Promise<void>;
  error?: string | null;
  notice?: string | null;
}) {
  const t = fr.auth.newPassword;

  return (
    <AuthShell title={t.title} description={t.description}>
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
        <Field
          id="mot-de-passe"
          label={t.passwordLabel}
          hint={fr.auth.signUp.passwordHint}
          required
        >
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          )}
        </Field>

        <Field id="confirmation" label={t.confirmLabel} required>
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              name="passwordConfirmation"
              type="password"
              autoComplete="new-password"
              minLength={12}
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
