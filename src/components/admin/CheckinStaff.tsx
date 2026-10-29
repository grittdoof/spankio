import { EmptyState } from '@/components/ui/EmptyState';
import type { StaffMember } from '@/lib/checkin/readiness';
import type { OrganisationMember } from '@/lib/services/checkin';

/**
 * Qui tient la porte — et surtout, qui s'est déjà connecté.
 *
 * La colonne qui compte n'est pas la liste des noms : c'est « a déjà ouvert
 * son poste ». Elle transforme le plus gros risque opérationnel du module en
 * fait visible la veille, quand il reste du temps pour appeler la personne.
 *
 * Affecter et retirer sont de vrais `<form action>` : l'écran fonctionne sans
 * JavaScript, comme la recherche et la suppression groupée des réponses.
 */

const MOMENT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const JOUR = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' });

function moment(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : MOMENT.format(date);
}

function jour(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : JOUR.format(date);
}

/** Le nom, et à défaut l'adresse : une rangée sans intitulé ne désigne rien. */
function nameOf(member: { name: string | null; email: string | null }): string {
  return member.name ?? member.email ?? 'Compte sans nom';
}

export interface CheckinStaffProps {
  surveyId: string;
  staff: readonly StaffMember[];
  /** Membres actifs de l'organisation pas encore affectés. */
  assignable: readonly OrganisationMember[];
  assignAction: (formData: FormData) => void | Promise<void>;
  revokeAction: (formData: FormData) => void | Promise<void>;
}

export function CheckinStaff({
  surveyId,
  staff,
  assignable,
  assignAction,
  revokeAction,
}: CheckinStaffProps) {
  return (
    <section className="sp-card">
      <h2>Personnes affectées</h2>
      <p className="sp-hint">
        Une personne affectée voit la liste des invités de CET événement, et rien
        d’autre : ni les autres formulaires, ni les autres réponses de
        l’organisation. L’affectation se retire à tout moment, et peut s’arrêter
        d’elle-même à une date.
      </p>

      {staff.length === 0 ? (
        <EmptyState
          lead="Personne ne tient encore la porte. Affectez au moins une personne : sans affectation, aucun poste ne peut s’ouvrir."
          title="Aucune affectation"
        />
      ) : (
        <ul className="sp-staff">
          {staff.map((member) => (
            <li className="sp-staff__row" key={member.profileId}>
              <span className="sp-staff__who">
                <span className="sp-staff__name">{nameOf(member)}</span>
                <span className="sp-staff__meta">
                  {[
                    member.name && member.email ? member.email : null,
                    member.expiresAt
                      ? `accès jusqu’au ${jour(member.expiresAt)}`
                      : 'accès sans date de fin',
                  ]
                    .filter((part): part is string => Boolean(part))
                    .join(' · ')}
                </span>
              </span>

              {/* Le fait qui vaut l'écran entier, écrit en toutes lettres. */}
              <span
                className={`sp-staff__seen${
                  member.firstSeenAt ? '' : ' sp-staff__seen--never'
                }`}
              >
                {member.firstSeenAt
                  ? `S’est connectée — dernière ouverture le ${moment(
                      member.lastSeenAt ?? member.firstSeenAt,
                    )}`
                  : 'Ne s’est jamais connectée'}
              </span>

              <form action={revokeAction}>
                <input name="surveyId" type="hidden" value={surveyId} />
                <input name="profileId" type="hidden" value={member.profileId} />
                <button className="sp-btn sp-btn--ghost sp-btn--danger-text" type="submit">
                  <span aria-hidden="true">Retirer</span>
                  <span className="sp-visually-hidden">
                    Retirer l’affectation de {nameOf(member)}
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={assignAction} className="sp-staff__add">
        <input name="surveyId" type="hidden" value={surveyId} />

        <p className="sp-field">
          <label className="sp-label" htmlFor="sp-staff-person">
            Personne à affecter
          </label>
          <select
            className="sp-select"
            defaultValue=""
            id="sp-staff-person"
            name="profileId"
            required
          >
            {/* Une option vide explicite : un `select` dont la valeur ne
                correspond à aucune option affiche la première, et l'écran
                mentirait sur ce qui est sur le point d'être envoyé. */}
            <option disabled value="">
              Choisir une personne…
            </option>
            {assignable.map((member) => (
              <option key={member.profileId} value={member.profileId}>
                {nameOf(member)}
              </option>
            ))}
          </select>
        </p>

        <p className="sp-field">
          <label className="sp-label" htmlFor="sp-staff-until">
            Accès jusqu’au <span className="sp-muted">(facultatif)</span>
          </label>
          <input className="sp-input" id="sp-staff-until" name="expiresOn" type="date" />
          <span className="sp-hint">
            L’accès cesse à la fin de ce jour-là. Sans date, il ne cesse jamais de
            lui-même — or une liste nominative sur un téléphone personnel n’a pas
            de raison de rester accessible après la soirée.
          </span>
        </p>

        <button
          className="sp-btn sp-btn--primary"
          disabled={assignable.length === 0}
          type="submit"
        >
          Affecter
        </button>

        {assignable.length === 0 ? (
          <p className="sp-hint">
            Tous les membres actifs de l’organisation sont déjà affectés. Un
            nouveau compte se crée en s’inscrivant, puis en demandant son
            rattachement à l’organisation.
          </p>
        ) : null}
      </form>
    </section>
  );
}
