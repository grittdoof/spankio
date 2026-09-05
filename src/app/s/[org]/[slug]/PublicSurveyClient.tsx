'use client';

import { useCallback } from 'react';
import { SurveyRenderer, type SurveyRendererProps } from '@/components/public/SurveyRenderer';

/**
 * Enveloppe cliente : elle porte l'appel réseau, pour que le moteur de rendu
 * reste une fonction pure de ses propriétés — donc testable sans réseau.
 */
export function PublicSurveyClient(
  props: Omit<SurveyRendererProps, 'onSubmit'> & {
    organisationSlug: string;
    surveySlug: string;
  },
) {
  const { organisationSlug, surveySlug, ...rendererProps } = props;

  const onSubmit = useCallback<SurveyRendererProps['onSubmit']>(
    async ({ data, consentGiven }) => {
      try {
        const response = await fetch('/api/public/submit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organisationSlug, surveySlug, data, consentGiven }),
        });

        if (response.ok) return { ok: true };

        const body = (await response.json().catch(() => null)) as
          | { error?: { code?: string; fields?: Record<string, string> } }
          | null;

        return {
          ok: false,
          ...(body?.error?.code ? { code: body.error.code } : {}),
          ...(body?.error?.fields ? { fields: body.error.fields } : {}),
        };
      } catch {
        // Panne réseau : les réponses restent en mémoire, l'utilisateur peut
        // réessayer sans tout ressaisir.
        return { ok: false, code: 'server_error' };
      }
    },
    [organisationSlug, surveySlug],
  );

  return <SurveyRenderer {...rendererProps} onSubmit={onSubmit} />;
}
