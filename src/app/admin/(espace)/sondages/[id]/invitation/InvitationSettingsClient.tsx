'use client';

import { useCallback } from 'react';
import {
  InvitationSettings,
  type InvitationSettingsProps,
} from '@/components/admin/InvitationSettings';
import type { SurveySchema } from '@/lib/survey/schema';
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
  schema,
  publicUrl,
  published,
}: {
  surveyId: string;
  settings: SurveySettings;
  /** Schéma du formulaire : il fournit les questions à désigner. */
  schema: SurveySchema;
  publicUrl: string;
  published: boolean;
}) {
  const onSave = useCallback<InvitationSettingsProps['onSave']>(
    async (draft, texts) => {
      try {
        const response = await fetch(`/api/admin/surveys/${surveyId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            settings: {
              ...settings,
              publicPage: draft,
              // `thankYou` est réécrit en entier : le panneau en est la seule
              // source, et un texte effacé doit disparaître de l'objet plutôt
              // que rester en chaîne vide.
              ...(texts.thankYou && Object.keys(texts.thankYou).length > 0
                ? { thankYou: texts.thankYou }
                : { thankYou: undefined }),
              ...(texts.confirmation && Object.keys(texts.confirmation).length > 0
                ? { confirmation: texts.confirmation }
                : { confirmation: undefined }),
            },
          }),
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
      initialTexts={{
        thankYou: settings.thankYou,
        confirmation: settings.confirmation,
      }}
      schema={schema}
      onSave={onSave}
      publicUrl={publicUrl}
      published={published}
    />
  );
}
