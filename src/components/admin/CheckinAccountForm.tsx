'use client';

import { useActionState } from 'react';
import { CopyBox } from '@/components/ui/CopyBox';
import { Alert } from '@/components/ui/Alert';
import {
  IDLE_ACCOUNT_STATE,
  accessMessage,
  type StaffAccountState,
} from '@/lib/checkin/account';

/**
 * Créer un compte de pointage, et repartir avec de quoi le transmettre.
 *
 * C'est une demande du client, et elle contredit le chemin d'entrée normal de
 * la plateforme : une personne engagée pour une soirée ne crée pas de compte
 * depuis son téléphone, on lui remet un identifiant et un mot de passe. Le
 * formulaire fait donc les trois gestes d'un coup — compte, rattachement,
 * affectation à CET événement.
 *
 * L'identifiant est FABRIQUÉ à partir du nom saisi : aucune adresse n'est
 * demandée, puisque c'est tout l'intérêt. Le mot de passe est prégarni d'une
 * suggestion prononçable, modifiable — celui qui crée le compte est celui qui
 * le dictera.
 *
 * Après création, le couple s'affiche UNE fois, message déjà composé. Il n'est
 * stocké nulle part et ne se relit pas : on en remet un autre.
 */

export interface CheckinAccountFormProps {
  surveyId: string;
  eventTitle: string;
  deskUrl: string;
  /** Suggestion tirée au sort par le serveur à chaque rendu de l'écran. */
  suggestedPassword: string;
  action: (state: StaffAccountState, formData: FormData) => Promise<StaffAccountState>;
}

export function CheckinAccountForm({
  surveyId,
  eventTitle,
  deskUrl,
  suggestedPassword,
  action,
}: CheckinAccountFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE_ACCOUNT_STATE);

  return (
    <section className="sp-card">
      <h2>Créer un compte de pointage</h2>
      <p className="sp-hint">
        Pour quelqu’un qui n’a pas de compte et à qui vous remettez ses accès
        directement. La plateforme fabrique l’identifiant : aucune adresse
        électronique n’est demandée, rien n’est à confirmer, le compte sert
        immédiatement. Il ne donne accès qu’à la liste de cet événement.
      </p>

      {/* Une seule zone d'annonce à la fois : l'erreur OU le compte créé. */}
      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}

      {state.status === 'created' ? (
        <div className="sp-access">
          <Alert tone="success">
            Compte créé pour « {state.label} ». Transmettez ces accès maintenant :
            le mot de passe ne se réaffichera pas.
          </Alert>
          <CopyBox
            label="Message à transmettre"
            multiline
            value={accessMessage({
              eventTitle,
              deskUrl,
              identifier: state.identifier,
              password: state.password,
            })}
          />
        </div>
      ) : null}

      <form action={formAction} className="sp-staff__add">
        <input name="surveyId" type="hidden" value={surveyId} />

        <p className="sp-field">
          <label className="sp-label" htmlFor="sp-account-label">
            Nom du poste ou de la personne
          </label>
          <input
            autoComplete="off"
            className="sp-input"
            id="sp-account-label"
            maxLength={60}
            name="label"
            placeholder="Marie, Entrée principale, Vestiaire…"
            required
            type="text"
          />
          <span className="sp-hint">
            Il fabrique l’identifiant et désigne la personne dans la liste
            ci-dessous.
          </span>
        </p>

        <p className="sp-field">
          <label className="sp-label" htmlFor="sp-account-password">
            Mot de passe
          </label>
          <input
            autoComplete="off"
            className="sp-input"
            defaultValue={suggestedPassword}
            id="sp-account-password"
            minLength={10}
            name="password"
            required
            type="text"
          />
          <span className="sp-hint">
            Celui-ci est proposé parce qu’il se dicte au téléphone sans épeler.
            Remplacez-le si vous préférez. Il n’est conservé nulle part : pour en
            retrouver un, on en met un nouveau.
          </span>
        </p>

        <p className="sp-field">
          <label className="sp-label" htmlFor="sp-account-until">
            Accès jusqu’au <span className="sp-muted">(facultatif)</span>
          </label>
          <input className="sp-input" id="sp-account-until" name="expiresOn" type="date" />
          <span className="sp-hint">
            L’accès cesse à la fin de ce jour-là. Sans date, il ne cesse jamais de
            lui-même.
          </span>
        </p>

        <button className="sp-btn sp-btn--primary" disabled={pending} type="submit">
          {pending ? 'Création…' : 'Créer le compte'}
        </button>
      </form>
    </section>
  );
}
