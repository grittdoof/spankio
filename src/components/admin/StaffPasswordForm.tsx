'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { CopyBox } from '@/components/ui/CopyBox';
import {
  IDLE_ACCOUNT_STATE,
  accessMessage,
  type StaffAccountState,
} from '@/lib/checkin/account';

/**
 * Remettre un mot de passe oublié — le seul recours, puisqu'il ne se relit pas.
 *
 * Rangé dans un `<details>` : la liste des personnes affectées doit rester
 * lisible d'un coup d'œil, et un formulaire déplié par rangée la noierait.
 * `<details>` fonctionne sans JavaScript, comme le reste de cet écran.
 *
 * N'est proposé que sur les comptes FABRIQUÉS par la plateforme. Un éditeur
 * affecté à la porte garde le sien : le lui remettre à zéro depuis cet écran
 * serait une prise de contrôle, et le service le refuse de toute façon.
 */
export interface StaffPasswordFormProps {
  surveyId: string;
  profileId: string;
  identifier: string;
  eventTitle: string;
  deskUrl: string;
  suggestedPassword: string;
  action: (state: StaffAccountState, formData: FormData) => Promise<StaffAccountState>;
}

export function StaffPasswordForm({
  surveyId,
  profileId,
  identifier,
  eventTitle,
  deskUrl,
  suggestedPassword,
  action,
}: StaffPasswordFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE_ACCOUNT_STATE);

  return (
    <details className="sp-staff__reset">
      <summary>Nouveau mot de passe</summary>

      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}

      {state.status === 'reset' ? (
        <div className="sp-access">
          <Alert tone="success">
            Mot de passe remplacé. L’ancien ne fonctionne plus.
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

      <form action={formAction}>
        <input name="surveyId" type="hidden" value={surveyId} />
        <input name="profileId" type="hidden" value={profileId} />

        <p className="sp-field">
          <label className="sp-label" htmlFor={`sp-pass-${profileId}`}>
            Mot de passe de {identifier}
          </label>
          <input
            autoComplete="off"
            className="sp-input"
            defaultValue={suggestedPassword}
            id={`sp-pass-${profileId}`}
            minLength={10}
            name="password"
            required
            type="text"
          />
        </p>

        <button className="sp-btn sp-btn--outline sp-btn--sm" disabled={pending} type="submit">
          {pending ? 'Remplacement…' : 'Remplacer le mot de passe'}
        </button>
      </form>
    </details>
  );
}
