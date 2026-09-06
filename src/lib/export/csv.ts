import { OTHER_VALUE, otherKey, type SurveySchema } from '@/lib/survey/schema';

/**
 * Export CSV des réponses.
 *
 * Deux exigences qui ne se voient pas dans un tableau à l'écran :
 *
 *  1. **BOM UTF-8.** Sans lui, Excel lit un fichier UTF-8 comme du Latin-1 et
 *     affiche « Ã© » à la place de « é ».
 *  2. **Neutralisation des formules.** Une réponse commençant par `=`, `+`,
 *     `-` ou `@` est interprétée comme une formule par Excel, LibreOffice et
 *     Google Sheets. `=HYPERLINK(...)` ou `=cmd|...` dans un export ouvert par
 *     un agent est une véritable exécution de code, pas une coquetterie
 *     d'affichage. On préfixe donc par une apostrophe.
 *
 * Le séparateur par défaut est le point-virgule : c'est celui qu'attend un
 * tableur configuré en français, et un export que l'utilisateur doit
 * reformater à la main n'est pas un export.
 */

/** Marque d'ordre des octets, reconnue par les tableurs comme « ceci est de l'UTF-8 ». */
export const UTF8_BOM = '﻿';

/** Caractères qui, en tête de cellule, déclenchent l'interprétation d'une formule. */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', String.fromCodePoint(0x09), String.fromCodePoint(0x0d)];

export interface CsvOptions {
  /** Séparateur de colonnes. `;` par défaut (tableurs francophones). */
  readonly separator?: ';' | ',' | '\t';
  /** Sépare les valeurs multiples d'une même cellule. */
  readonly multiValueSeparator?: string;
  /** Ajoute la marque d'ordre des octets. Vrai par défaut. */
  readonly bom?: boolean;
}

/**
 * Rend une cellule sûre : neutralisation de formule puis échappement CSV.
 * L'ordre compte — l'apostrophe doit se trouver À L'INTÉRIEUR des guillemets.
 */
export function escapeCsvCell(value: string, separator: string): string {
  // La décision de mettre entre guillemets porte sur la valeur REÇUE, pas sur
  // la valeur préfixée : sinon l'apostrophe de neutralisation masquerait une
  // espace de bord, et le contenu exact ne serait plus restitué.
  const needsQuotes =
    value.includes(separator) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value !== value.trim();

  let cell = value;
  if (cell !== '' && FORMULA_TRIGGERS.some((trigger) => cell.startsWith(trigger))) {
    cell = `'${cell}`;
  }

  return needsQuotes ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCsv(
  rows: readonly (readonly string[])[],
  options: CsvOptions = {},
): string {
  const separator = options.separator ?? ';';
  const body = rows
    .map((row) => row.map((cell) => escapeCsvCell(cell, separator)).join(separator))
    // CRLF : c'est ce qu'attend RFC 4180, et ce que préfèrent les tableurs.
    .join('\r\n');

  return `${options.bom === false ? '' : UTF8_BOM}${body}${body === '' ? '' : '\r\n'}`;
}

export interface ExportColumn {
  /** Clé technique, pour retrouver la valeur dans `data`. */
  readonly key: string;
  /** En-tête affiché. */
  readonly header: string;
  /** Ligne d'une grille, quand la colonne en représente une. */
  readonly gridRow?: string;
}

/**
 * Colonnes de métadonnées, présentes avant les réponses.
 *
 * L'EXPORT les emporte toutes : le texte de consentement affiché est la preuve
 * auditable de ce qui a été annoncé au répondant, et un export qui l'omettrait
 * ne servirait pas de pièce.
 *
 * L'ÉCRAN n'en garde qu'une, la date. Le même paragraphe répété à l'identique
 * sur chaque ligne n'apprend rien, occupe la moitié du tableau, et repousse
 * hors de vue ce qu'on est venu lire — les réponses.
 */
const META_COLUMNS: readonly ExportColumn[] = [
  { key: '__submitted_at', header: 'Date de réponse' },
  { key: '__consent_given', header: 'Consentement' },
  { key: '__consent_text', header: 'Texte du consentement affiché' },
];

const SCREEN_META_COLUMNS: readonly ExportColumn[] = [
  { key: '__submitted_at', header: 'Date de réponse' },
];

/** Jeu de métadonnées : complet pour un fichier, réduit pour un écran. */
export type MetaScope = 'export' | 'screen';

/**
 * Colonnes déduites du SCHÉMA, pas des réponses.
 *
 * C'est un choix important : un export dont les colonnes dépendent des données
 * change de forme à chaque réponse, ce qui casse tout traitement en aval. Ici,
 * deux exports du même sondage ont toujours les mêmes colonnes, dans le même
 * ordre — même si personne n'a répondu à une question.
 */
export function exportColumns(
  schema: SurveySchema,
  meta: MetaScope = 'export',
): ExportColumn[] {
  const columns: ExportColumn[] = [
    ...(meta === 'export' ? META_COLUMNS : SCREEN_META_COLUMNS),
  ];

  for (const step of schema.steps) {
    for (const field of step.fields) {
      if (field.type === 'checkbox_grid') {
        // Une colonne par ligne de grille : une cellule contenant la grille
        // entière serait illisible et intraitable.
        for (const row of field.rows) {
          columns.push({
            key: field.id,
            header: `${field.label} — ${row.label}`,
            gridRow: row.value,
          });
        }
        continue;
      }

      columns.push({ key: field.id, header: field.label });

      if ('allowOther' in field && field.allowOther) {
        columns.push({ key: otherKey(field.id), header: `${field.label} (autre)` });
      }
    }
  }

  return columns;
}

/** Libellés des options, pour traduire les valeurs stockées. */
function optionLabels(schema: SurveySchema): Map<string, Map<string, string>> {
  const byField = new Map<string, Map<string, string>>();

  for (const step of schema.steps) {
    for (const field of step.fields) {
      if (field.type === 'select' || field.type === 'radio' || field.type === 'checkbox') {
        const labels = new Map(field.options.map((option) => [option.value, option.label]));
        if (field.allowOther) labels.set(OTHER_VALUE, 'Autre');
        byField.set(field.id, labels);
      } else if (field.type === 'checkbox_grid') {
        byField.set(field.id, new Map(field.columns.map((column) => [column.value, column.label])));
      }
    }
  }

  return byField;
}

export interface ExportableResponse {
  /**
   * Horodatage tel qu'il sort de la base. Le type accepte `Date` autant que
   * `string` parce que les deux adaptateurs du port DIVERGENT : PostgREST
   * renvoie une chaîne ISO, un pilote PostgreSQL direct un objet `Date`.
   * Prétendre que c'est toujours une chaîne produisait un export qui
   * fonctionnait en production et cassait en test.
   */
  readonly submitted_at: string | Date;
  readonly consent_given: boolean;
  readonly consent_text: string | null;
  readonly data: Readonly<Record<string, unknown>>;
}

/** Horodatage normalisé en ISO 8601, quelle que soit sa forme d'origine. */
export function toIsoString(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  return value;
}

function renderValue(
  value: unknown,
  labels: Map<string, string> | undefined,
  multiValueSeparator: string,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return labels?.get(value) ?? value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (Array.isArray(value)) {
    const entries: unknown[] = value;
    return entries
      .map((entry) => (typeof entry === 'string' ? (labels?.get(entry) ?? entry) : String(entry)))
      .join(multiValueSeparator);
  }
  return '';
}

/**
 * Réponses mises à plat en tableau de chaînes, en-tête compris.
 *
 * Extrait de la génération CSV pour que le tableau de bord affiche les mêmes
 * colonnes, dans le même ordre, avec les mêmes libellés que l'export : deux
 * mises en forme distinctes finiraient par diverger, et l'écran montrerait
 * autre chose que le fichier téléchargé.
 */
export function responseRows(
  schema: SurveySchema,
  responses: readonly ExportableResponse[],
  options: CsvOptions & { meta?: MetaScope } = {},
): string[][] {
  const multiValueSeparator = options.multiValueSeparator ?? ' | ';
  const columns = exportColumns(schema, options.meta ?? 'export');
  const labels = optionLabels(schema);

  const rows: string[][] = [columns.map((column) => column.header)];

  for (const response of responses) {
    rows.push(
      columns.map((column) => {
        switch (column.key) {
          case '__submitted_at':
            return toIsoString(response.submitted_at);
          case '__consent_given':
            return response.consent_given ? 'Oui' : 'Non';
          case '__consent_text':
            return response.consent_text ?? '';
          default:
            break;
        }

        const value = response.data[column.key];

        if (column.gridRow !== undefined) {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return '';
          const rowValue = (value as Record<string, unknown>)[column.gridRow];
          return renderValue(rowValue, labels.get(column.key), multiValueSeparator);
        }

        return renderValue(value, labels.get(column.key), multiValueSeparator);
      }),
    );
  }

  return rows;
}

/**
 * Construit le CSV complet d'un sondage.
 *
 * Les libellés du schéma sont exportés plutôt que les valeurs techniques :
 * l'export est destiné à être lu par une personne. Les valeurs restent
 * disponibles telles quelles dans l'export JSON.
 */
export function responsesToCsv(
  schema: SurveySchema,
  responses: readonly ExportableResponse[],
  options: CsvOptions = {},
): string {
  return toCsv(responseRows(schema, responses, options), options);
}

/** Nom de fichier proposé : ASCII, daté, sans espace. */
export function csvFileName(slug: string, at: Date): string {
  const date = at.toISOString().slice(0, 10);
  const base = slug.replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'reponses';
  return `${base}-${date}.csv`;
}
