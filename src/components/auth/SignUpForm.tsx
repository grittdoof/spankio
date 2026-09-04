import Link from 'next/link';
import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
import { fr } from '@/lib/i18n/fr';
import { AuthShell } from './AuthShell';

/** Création de compte. Le compte créé est inerte : aucun droit sans validation. */
export function SignUpForm({
  action,
  error,
  notice,
}: {
  action: (formData: FormData) => void | Promise<void>;
  error?: string | null;
  notice?: string | null;
}) {
  const t = fr.auth.signUp;

  return (
    <AuthShell
      title={t.title}
      description={t.description}
      footer={
        <p>
          {t.haveAccount} <Link href="/connexion">{t.signInLink}</Link>
        </p>
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
        <Field id="nom" label={t.fullNameLabel} required>
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              name="fullName"
              type="text"
              autoComplete="name"
              maxLength={160}
              required
            />
          )}
        </Field>

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

        <Field id="mot-de-passe" label={t.passwordLabel} hint={t.passwordHint} required>
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

        <button className="sp-btn sp-btn--block sp-btn--lg" type="submit">
          {t.submit}
        </button>
      </form>
    </AuthShell>
  );
}
