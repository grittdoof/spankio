'use client';

import { useCallback } from 'react';
import {
  ResponseEditor,
  type ResponseEditorProps,
} from '@/components/admin/ResponseEditor';
import type { SurveySchema } from '@/lib/survey/schema';

/**
 * Enveloppe cliente : elle porte l'appel réseau, pour que l'éditeur reste une
 * fonction de ses propriétés — donc testable sans réseau.
 */
export function ResponseEditorClient({
  responseId,
  surveyId,
  schema,
  initial,
  submittedAt,
}: {
  responseId: string;
  surveyId: string;
  schema: SurveySchema;
  initial: Readonly<Record<string, unknown>>;
  submittedAt: string;
}) {
  const onSave = useCallback<ResponseEditorProps['onSave']>(
    async (data) => {
      try {
        const response = await fetch(`/api/admin/responses/${responseId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ surveyId, data }),
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
    [responseId, surveyId],
  );

  return (
    <ResponseEditor
      initial={initial}
      onSave={onSave}
      schema={schema}
      submittedAt={submittedAt}
    />
  );
}
