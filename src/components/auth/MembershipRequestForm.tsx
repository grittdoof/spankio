import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
import { fr } from '@/lib/i18n/fr';
import { ASSIGNABLE_ROLES } from '@/lib/services/membership';
import { AuthShell } from './AuthShell';

export interface OrganisationOption {
  id: string;
  name: string;
}

/**
 * Demande de rattachement.
 *
 * La liste déroulante est une VRAIE `<select>` native : elle est utilisable au
 * clavier, lue correctement par les lecteurs d'écran, et bénéficie du sélecteur
 * natif sur mobile. L'option « mon organisation n'est pas dans la liste »
 * ouvre le champ de création — sans JavaScript, les deux champs restent
 * simplement disponibles, et le serveur arbitre.
 */
export function MembershipRequestForm({
  action,
  organisations,
  error,
  notice,
  pending,
}: {
  action: (formData: FormData) => void | Promise<void>;
  organisations: readonly OrganisationOption[];
  error?: string | null;
  notice?: string | null;
  pending?: boolean;
}) {
  const t = fr.auth.membershipRequest;

  if (pending) {
    return (
      <AuthShell title={t.title}>
        <Alert tone="info">{t.pending}</Alert>
      </AuthShell>
    );
  }

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
        <Field id="organisation" label={t.existingOrganisationLabel}>
          {(attributes) => (
            <select {...attributes} className="sp-select" name="organisationId" defaultValue="">
              <option value="">{t.existingOrganisationPlaceholder}</option>
              {organisations.map((organisation) => (
                <option key={organisation.id} value={organisation.id}>
                  {organisation.name}
                </option>
              ))}
              <option value="__nouvelle">{t.newOrganisationOption}</option>
            </select>
          )}
        </Field>

        <Field id="nouvelle-organisation" label={t.newOrganisationLabel}>
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              name="organisationName"
              type="text"
              maxLength={160}
              autoComplete="organization"
            />
          )}
        </Field>

        <Field id="role" label={t.roleLabel} hint={t.roleHint}>
          {(attributes) => (
            <select {...attributes} className="sp-select" name="requestedRole" defaultValue="editor">
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {fr.auth.roles[role]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field id="message" label={t.messageLabel} hint={t.messageHint}>
          {(attributes) => (
            <textarea
              {...attributes}
              className="sp-textarea"
              name="message"
              maxLength={2000}
              rows={4}
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
