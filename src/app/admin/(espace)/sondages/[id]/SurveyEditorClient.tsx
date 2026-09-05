'use client';

import { useCallback } from 'react';
import { SurveyBuilder, type SurveyBuilderProps, type SurveyDraft } from '@/components/admin/SurveyBuilder';

/**
 * Enveloppe cliente de l'éditeur : elle porte l'appel réseau, pour que
 * l'éditeur reste une fonction de ses propriétés — donc testable sans réseau.
 *
 * Elle n'envoie QUE les champs de l'éditeur. Envoyer l'objet complet écraserait
 * les réglages d'événement ou la bannière, qui se règlent ailleurs, avec des
 * valeurs que cet écran n'a jamais chargées.
 */
export function SurveyEditorClient({
  surveyId,
  initial,
  publicUrl,
  eventStartsAt,
}: {
  surveyId: string;
  initial: SurveyDraft;
  publicUrl: string;
  /** `undefined` pour un sondage : l'éditeur n'exige alors aucune date. */
  eventStartsAt?: string | null;
}) {
  const onSave = useCallback<SurveyBuilderProps['onSave']>(
    async (draft) => {
      try {
        const response = await fetch(`/api/admin/surveys/${surveyId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: draft.title,
            slug: draft.slug,
            description: draft.description,
            status: draft.status,
            schema: draft.schema,
            settings: draft.settings,
            purpose: draft.purpose,
            legalBasis: draft.legalBasis,
            retentionDays: draft.retentionDays,
            recipients: draft.recipients,
            requireConsent: draft.requireConsent,
            dedupField: draft.dedupField,
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
        // Panne réseau : le brouillon reste en mémoire, l'utilisateur peut
        // réessayer sans avoir tout ressaisi.
        return { ok: false, message: 'La connexion a échoué. Vos modifications sont conservées : réessayez.' };
      }
    },
    [surveyId],
  );

  return (
    <SurveyBuilder
      surveyId={surveyId}
      initial={initial}
      publicUrl={publicUrl}
      eventStartsAt={eventStartsAt}
      onSave={onSave}
    />
  );
}
