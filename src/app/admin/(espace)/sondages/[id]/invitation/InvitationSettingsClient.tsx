'use client';

import { useCallback } from 'react';
import {
  InvitationSettings,
  type InvitationSettingsProps,
} from '@/components/admin/InvitationSettings';
import type { SurveySettings } from '@/lib/survey/settings';

/**
 * Enveloppe cliente : elle porte l'appel réseau, pour que le panneau reste une
 * fonction de ses propriétés — donc testable sans réseau.
 *
 * Les réglages sont réémis INTÉGRALEMENT : `updateSurvey` remplace `settings`
 * en entier, et n'envoyer que la page publique effacerait les textes
 * d'accueil, le comptage des présents et la liste d'accueil.
 */
export function InvitationSettingsClient({
  surveyId,
  settings,
  publicUrl,
  published,
}: {
  surveyId: string;
  settings: SurveySettings;
  publicUrl: string;
  published: boolean;
}) {
  const onSave = useCallback<InvitationSettingsProps['onSave']>(
    async (draft) => {
      try {
        const response = await fetch(`/api/admin/surveys/${surveyId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ settings: { ...settings, publicPage: draft } }),
        });

        if (response.ok) return { ok: true };

        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;

        return {
          ok: false,
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
    <InvitationSettings
      initial={settings.publicPage ?? {}}
      onSave={onSave}
      publicUrl={publicUrl}
      published={published}
    />
  );
}
