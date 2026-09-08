import { describe, expect, it } from 'vitest';
import {
  dedupCandidates,
  dedupCoverageIsPartial,
  dedupDesignation,
} from '@/lib/survey/dedup';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';

function schemaOf(fields: unknown[]): SurveySchema {
  const result = validateSurveySchema({
    version: 1,
    steps: [{ id: 'etape_1', fields }],
  });
  if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
}

const schema = schemaOf([
  {
    id: 'presence',
    type: 'radio',
    label: 'Serez-vous présent ?',
    required: true,
    options: [
      { value: 'oui', label: 'Oui' },
      { value: 'non', label: 'Non' },
    ],
  },
  {
    id: 'adresse_electronique',
    type: 'email',
    label: 'Votre adresse',
    required: true,
    condition: { field: 'presence', op: 'equals', value: 'oui' },
  },
  { id: 'telephone', type: 'tel', label: 'Votre téléphone', required: true },
  { id: 'nom', type: 'text', label: 'Votre nom', required: true },
]);

describe('clé anti-doublon', () => {
  it('ne propose qu’une adresse ou un numéro', () => {
    // Un texte libre identifierait mal : deux invités peuvent porter le même
    // nom, et le second serait refusé sans comprendre pourquoi.
    expect(dedupCandidates(schema).map((field) => field.id)).toEqual([
      'adresse_electronique',
      'telephone',
    ]);
  });

  it('sans clé, la désignation est vide', () => {
    expect(dedupDesignation(schema, null)).toEqual({ kind: 'off' });
    expect(dedupDesignation(schema, '')).toEqual({ kind: 'off' });
    expect(dedupDesignation(schema, undefined)).toEqual({ kind: 'off' });
  });

  it('retrouve la question désignée', () => {
    const designation = dedupDesignation(schema, 'telephone');
    expect(designation.kind).toBe('field');
    if (designation.kind !== 'field') throw new Error('inattendu');
    expect(designation.field.label).toBe('Votre téléphone');
  });

  it('signale une désignation que le schéma ne contient plus', () => {
    // Le cas de production : les questions ont été refaites, la clé pointait
    // toujours sur « email ». L'unicité est INAPPLICABLE, et le dire est la
    // seule chose utile — l'appliquer sur autre chose serait une invention.
    expect(dedupDesignation(schema, 'email')).toEqual({ kind: 'missing', id: 'email' });
  });

  it('distingue une couverture partielle d’une couverture complète', () => {
    const conditional = dedupDesignation(schema, 'adresse_electronique');
    const always = dedupDesignation(schema, 'telephone');
    if (conditional.kind !== 'field' || always.kind !== 'field') throw new Error('inattendu');

    // Posée aux seuls présents : ceux qui déclinent n'emportent aucune clé.
    expect(dedupCoverageIsPartial(conditional.field)).toBe(true);
    expect(dedupCoverageIsPartial(always.field)).toBe(false);

    const optional = dedupDesignation(
      schemaOf([{ id: 'telephone', type: 'tel', label: 'Téléphone', required: false }]),
      'telephone',
    );
    if (optional.kind !== 'field') throw new Error('inattendu');
    expect(dedupCoverageIsPartial(optional.field)).toBe(true);
  });
});
