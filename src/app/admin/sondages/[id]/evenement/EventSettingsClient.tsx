'use client';

import { useCallback } from 'react';
import {
  EventSettings,
  type EventDraft,
  type EventSettingsProps,
} from '@/components/admin/EventSettings';

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
}: {
  organisationId: string;
  surveyId: string;
  initial: EventDraft;
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
    [surveyId],
  );

  return (
    <EventSettings
      organisationId={organisationId}
      surveyId={surveyId}
      initial={initial}
      onSave={onSave}
    />
  );
}
