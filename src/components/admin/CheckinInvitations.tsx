import type { InvitationRow } from '@/lib/services/checkin';

/**
 * Les invitations en cours.
 *
 * Ce bloc existe pour la personne qui n'a PAS de compte — l'écart que le
 * reste de l'écran ne couvre pas, puisqu'on n'y affecte que des membres
 * existants. C'est le cas ordinaire d'une hôtesse engagée pour une soirée.
 *
 * Le jeton n'apparaît jamais ici, et c'est volontaire : il part par courriel
 * et n'existe en clair qu'à cet instant-là. L'écran le DIT, parce qu'un lien
 * qu'on croit pouvoir retrouver plus tard est un lien qu'on ne renvoie pas à
 * temps.
 */

const MOMENT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const JOUR = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' });

function moment(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : MOMENT.format(date);
}

function jour(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : JOUR.format(date);
}

export interface CheckinInvitationsProps {
  surveyId: string;
  invitations: readonly InvitationRow[];
  /** Instant de référence, fourni : un composant ne lit pas l'horloge. */
  now: string;
  inviteAction: (formData: FormData) => void | Promise<void>;
  revokeAction: (formData: FormData) => void | Promise<void>;
}

export function CheckinInvitations({
  surveyId,
  invitations,
  now,
  inviteAction,
  revokeAction,
}: CheckinInvitationsProps) {
  const reference = new Date(now).getTime();

  return (
    <section className="sp-card">
      <h2>Inviter quelqu’un qui n’a pas de compte</h2>
      <p className="sp-hint">
        L’invitation rattache la personne à votre organisation en rôle
        « Accueil » et l’affecte à cet événement. Elle ne crée pas son compte :
        celui-ci se crée par l’inscription ordinaire, avec l’adresse invitée.
      </p>

      {invitations.length > 0 ? (
        <ul className="sp-staff">
          {invitations.map((invitation) => {
            const expired =
              invitation.claimedAt === null &&
              new Date(invitation.expiresAt).getTime() <= reference;
            const state = invitation.claimedAt
              ? `Utilisée le ${moment(invitation.claimedAt)}`
              : expired
                ? `Expirée le ${jour(invitation.expiresAt)}`
                : `En attente — expire le ${jour(invitation.expiresAt)}`;

            return (
              <li className="sp-staff__row" key={invitation.id}>
                <span className="sp-staff__who">
                  <span className="sp-staff__name">{invitation.email}</span>
                  <span className="sp-staff__meta">
                    Envoyée le {moment(invitation.createdAt)}
                  </span>
                </span>

                {/* L'état est ÉCRIT, comme partout dans ce module. */}
                <span
                  className={`sp-staff__seen${
                    invitation.claimedAt ? '' : ' sp-staff__seen--never'
                  }`}
                >
                  {state}
                </span>

                <form action={revokeAction}>
                  <input name="surveyId" type="hidden" value={surveyId} />
                  <input name="invitationId" type="hidden" value={invitation.id} />
                  <button className="sp-btn sp-btn--ghost sp-btn--danger-text" type="submit">
                    <span aria-hidden="true">Retirer</span>
                    <span className="sp-visually-hidden">
                      Retirer l’invitation de {invitation.email}
                    </span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : null}

      <form action={inviteAction} className="sp-staff__add">
        <input name="surveyId" type="hidden" value={surveyId} />

        <p className="sp-field">
          <label className="sp-label" htmlFor="sp-invite-email">
            Adresse électronique
          </label>
          <input
            autoComplete="off"
            className="sp-input"
            id="sp-invite-email"
            maxLength={254}
            name="email"
            required
            type="email"
          />
          <span className="sp-hint">
            Le lien n’ouvrira QUE pour un compte créé avec cette adresse. C’est
            ce qui empêche un lien transféré d’ouvrir la liste à quelqu’un
            d’autre.
          </span>
        </p>

        <p className="sp-field">
          <label className="sp-label" htmlFor="sp-invite-until">
            Accès jusqu’au <span className="sp-muted">(facultatif)</span>
          </label>
          <input className="sp-input" id="sp-invite-until" name="expiresOn" type="date" />
        </p>

        <button className="sp-btn sp-btn--primary" type="submit">
          Envoyer l’invitation
        </button>

        <p className="sp-hint">
          Le lien part par courriel et n’est affiché nulle part : il n’existe en
          clair qu’au moment de l’envoi. Si le courriel n’arrive pas, retirez
          l’invitation et recommencez — le lien ne peut pas être réaffiché.
        </p>
      </form>
    </section>
  );
}
