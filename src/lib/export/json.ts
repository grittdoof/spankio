import type { SurveySchema } from '@/lib/survey/schema';
import { toIsoString, type ExportableResponse } from './csv';

/**
 * Export JSON des réponses.
 *
 * Il complète le CSV plutôt que de le doubler : le CSV est fait pour être lu
 * par une personne dans un tableur — libellés, une colonne par ligne de
 * grille — le JSON pour être traité par un programme. Il conserve donc les
 * VALEURS techniques et embarque le schéma, ce qui le rend auto-descriptif :
 * un fichier exporté reste interprétable des années plus tard, même si le
 * sondage a changé depuis.
 */

export interface JsonExportMeta {
  readonly organisationName: string;
  readonly surveyTitle: string;
  readonly surveySlug: string;
  readonly exportedAt: string;
}

export interface JsonExport {
  readonly format: 'spankio.responses.v1';
  readonly survey: {
    readonly title: string;
    readonly slug: string;
    readonly organisation: string;
    readonly schema: SurveySchema;
  };
  readonly export: {
    readonly at: string;
    readonly responseCount: number;
  };
  readonly responses: readonly {
    readonly submittedAt: string;
    readonly consentGiven: boolean;
    readonly consentText: string | null;
    readonly answers: Readonly<Record<string, unknown>>;
  }[];
}

export function responsesToJsonExport(
  schema: SurveySchema,
  responses: readonly ExportableResponse[],
  meta: JsonExportMeta,
): JsonExport {
  return {
    // Identifiant de format versionné : un consommateur peut vérifier qu'il
    // sait lire le fichier avant de l'interpréter.
    format: 'spankio.responses.v1',
    survey: {
      title: meta.surveyTitle,
      slug: meta.surveySlug,
      organisation: meta.organisationName,
      schema,
    },
    export: {
      at: meta.exportedAt,
      responseCount: responses.length,
    },
    responses: responses.map((response) => ({
      submittedAt: toIsoString(response.submitted_at),
      consentGiven: response.consent_given,
      consentText: response.consent_text,
      answers: response.data,
    })),
  };
}

/** Sérialisation indentée : un export est fait pour être lu et versionné. */
export function serialiseJsonExport(value: JsonExport): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function jsonFileName(slug: string, at: Date): string {
  const date = at.toISOString().slice(0, 10);
  const base = slug.replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'reponses';
  return `${base}-${date}.json`;
}
