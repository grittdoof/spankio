import { Field } from '@/components/ui/Field';
import { fr } from '@/lib/i18n/fr';
import { ASSIGNABLE_ROLES } from '@/lib/services/membership';

export interface PendingRequest {
  id: string;
  requesterName: string | null;
  requesterEmail: string;
  organisationLabel: string;
  createsOrganisation: boolean;
  requestedRole: string;
  message: string | null;
  createdAt: string;
}

export interface ModuleOption {
  key: string;
  name: string;
  isCore: boolean;
}

/**
 * Décision sur une demande de rattachement.
 *
 * Un seul écran, deux boutons : le rôle ET les modules autorisés sont choisis
 * ici, au moment de la validation. Les modules `core` sont affichés mais non
 * décochables : ils sont toujours autorisés, le prétendre optionnel serait
 * mensonger.
 */
export function MembershipDecision({
  request,
  modules,
  approveAction,
  rejectAction,
}: {
  request: PendingRequest;
  modules: readonly ModuleOption[];
  approveAction: (formData: FormData) => void | Promise<void>;
  rejectAction: (formData: FormData) => void | Promise<void>;
}) {
  const roleFieldId = `role-${request.id}`;
  const noteFieldId = `note-${request.id}`;
  const slugFieldId = `slug-${request.id}`;

  return (
    <li className="sp-card sp-stack">
      <div>
        <h2 className="sp-card__title">{request.requesterName ?? request.requesterEmail}</h2>
        <p className="sp-muted">{request.requesterEmail}</p>
      </div>

      <dl className="sp-definition">
        <div>
          <dt>Organisation</dt>
          <dd>
            {request.organisationLabel}
            {request.createsOrganisation ? (
              <span className="sp-badge sp-badge--warning" style={{ marginLeft: '0.5rem' }}>
                à créer
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Rôle demandé</dt>
          <dd>{fr.auth.roles[request.requestedRole as keyof typeof fr.auth.roles] ?? request.requestedRole}</dd>
        </div>
        <div>
          <dt>Déposée le</dt>
          <dd>
            <time dateTime={request.createdAt}>
              {new Date(request.createdAt).toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </time>
          </dd>
        </div>
      </dl>

      {request.message ? <blockquote className="sp-quote">{request.message}</blockquote> : null}

      <form action={approveAction} className="sp-stack">
        <input type="hidden" name="requestId" value={request.id} />

        <Field id={roleFieldId} label="Rôle accordé" required>
          {(attributes) => (
            <select
              {...attributes}
              className="sp-select"
              name="role"
              defaultValue={request.requestedRole}
            >
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {fr.auth.roles[role]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <fieldset className="sp-fieldset">
          <legend className="sp-label">Modules autorisés pour ce compte</legend>
          <div className="sp-stack" style={{ '--sp-stack-gap': '0.5rem' } as React.CSSProperties}>
            {modules.map((module) => (
              <label className="sp-choice" key={module.key}>
                <input
                  type="checkbox"
                  name="moduleKeys"
                  value={module.key}
                  defaultChecked={module.isCore}
                  disabled={module.isCore}
                />
                <span className="sp-choice__label">
                  {module.name}
                  {module.isCore ? (
                    <span className="sp-choice__desc">Toujours autorisé.</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {request.createsOrganisation ? (
          <Field
            id={slugFieldId}
            label="Identifiant d’URL de l’organisation"
            hint="Laisser vide pour le déduire du nom demandé."
          >
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                name="organisationSlug"
                type="text"
                maxLength={62}
                spellCheck={false}
              />
            )}
          </Field>
        ) : null}

        <Field id={noteFieldId} label="Message joint à la décision" hint="Facultatif.">
          {(attributes) => (
            <textarea {...attributes} className="sp-textarea" name="note" rows={2} maxLength={2000} />
          )}
        </Field>

        <div className="sp-actions">
          <button className="sp-btn" type="submit">
            Valider la demande
          </button>
          <button className="sp-btn sp-btn--outline" type="submit" formAction={rejectAction}>
            Refuser
          </button>
        </div>
      </form>
    </li>
  );
}
