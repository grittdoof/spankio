'use client';

import { useCallback } from 'react';
import {
  EventSettings,
  type EventDraft,
  type EventSettingsProps,
} from '@/components/admin/EventSettings';
import type { SurveySchema } from '@/lib/survey/schema';
import type { SurveySettings } from '@/lib/survey/settings';

/**
 * Enveloppe cliente : elle porte l'appel réseau, pour que le panneau de
 * réglages reste une fonction de ses propriétés — donc testable sans réseau.
 *
 * Seuls les champs de l'événement sont envoyés. Transmettre l'objet complet
 * écraserait le schéma ou les mentions d'information, que cet écran n'a jamais
 * chargés.
 */
export function EventSettingsClient({
  organisationId,
  surveyId,
  initial,
  schema,
  settings,
}: {
  organisationId: string;
  surveyId: string;
  initial: EventDraft;
  /** Schéma du formulaire : il fournit les questions à désigner. */
  schema: SurveySchema;
  /**
   * Réglages ACTUELS du formulaire, réémis intégralement à l'enregistrement.
   *
   * `updateSurvey` remplace `settings` en entier : n'envoyer que le comptage
   * effacerait les textes d'accueil et de remerciement.
   */
  settings: SurveySettings;
}) {
  const onSave = useCallback<EventSettingsProps['onSave']>(
    async (draft) => {
      try {
        const response = await fetch(`/api/admin/surveys/${surveyId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            bannerPath: draft.bannerPath,
            eventStartsAt: draft.eventStartsAt,
            eventEndsAt: draft.eventEndsAt,
            eventAllDay: draft.eventAllDay,
            eventTimezone: draft.eventTimezone,
            eventLocationLabel: draft.eventLocationLabel,
            eventAddress: draft.eventAddress,
            eventLat: draft.eventLat,
            eventLng: draft.eventLng,
            eventOrganiser: draft.eventOrganiser,
            eventDetails: draft.eventDetails,
            // Réglages complets : `updateSurvey` remplace `settings` en
            // entier, un envoi partiel effacerait le reste.
            settings: { ...settings, attendance: draft.attendance },
          }),
        });

        if (response.ok) return { ok: true };

        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string; fields?: Record<string, string> } }
          | null;

        return {
          ok: false,
          ...(body?.error?.fields ? { fields: body.error.fields } : {}),
          ...(body?.error?.message ? { message: body.error.message } : {}),
        };
      } catch {
        return {
          ok: false,
          message: 'La connexion a échoué. Vos modifications sont conservées : réessayez.',
        };
      }
    },
    [settings, surveyId],
  );

  return (
    <EventSettings
      organisationId={organisationId}
      surveyId={surveyId}
      initial={initial}
      schema={schema}
      onSave={onSave}
    />
  );
}
