import { describe, expect, it } from 'vitest';
import {
  attendanceOf,
  attendanceRows,
  countAttendance,
  isAttendanceConfigured,
  partyCandidates,
  presenceCandidates,
  presenceValues,
  type AttendanceSettings,
} from '@/lib/survey/attendance';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';

/**
 * Comptage des présents.
 *
 * L'enjeu est un chiffre qu'un traiteur ou un service d'accueil va utiliser :
 * il doit être juste, ou dire qu'il ne l'est pas. Ces tests fixent surtout ce
 * que le module REFUSE de deviner — un effectif ambigu sorti du total plutôt
 * qu'arbitré en silence.
 */

const schema: SurveySchema = (() => {
  const result = validateSurveySchema({
    version: 1,
    steps: [
      {
        id: 'etape_1',
        fields: [
          {
            id: 'presence',
            type: 'radio',
            label: 'Serez-vous présent ?',
            options: [
              { value: 'oui', label: 'Oui, je serai présent' },
              { value: 'non', label: 'Non, je ne pourrai pas venir' },
            ],
          },
          {
            id: 'accompagnants',
            type: 'select',
            label: 'Nombre de personnes vous accompagnant',
            options: [
              { value: 'a0', label: '0' },
              { value: 'a1', label: '1' },
              { value: 'a2', label: '2 personnes' },
            ],
          },
          { id: 'total', type: 'number', label: 'Combien serez-vous ?', min: 1, max: 20 },
          {
            id: 'multi',
            type: 'checkbox',
            label: 'Combien ? (cases)',
            options: [
              { value: 'm1', label: '1' },
              { value: 'm3', label: '3' },
            ],
          },
          { id: 'nom', type: 'text', label: 'Nom' },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
})();

const field = (id: string) => schema.steps[0]!.fields.find((f) => f.id === id);

const BASE: AttendanceSettings = { presenceField: 'presence', presenceValue: 'oui' };

describe('configuration', () => {
  it('n’est exploitable qu’avec la question ET la valeur', () => {
    expect(isAttendanceConfigured(undefined)).toBe(false);
    expect(isAttendanceConfigured({})).toBe(false);
    expect(isAttendanceConfigured({ presenceField: 'presence' })).toBe(false);
    expect(isAttendanceConfigured(BASE)).toBe(true);
  });

  it('ne propose comme question de présence que des choix uniques', () => {
    // Une réponse libre ne peut pas être comparée de façon fiable — même règle
    // que pour les conditions d'affichage.
    expect(presenceCandidates(schema).map((f) => f.id)).toEqual(['presence', 'accompagnants']);
  });

  it('propose comme question d’effectif un nombre ou un choix à libellés numériques', () => {
    expect(partyCandidates(schema).map((f) => f.id)).toEqual([
      'accompagnants',
      'total',
      'multi',
    ]);
  });

  it('n’expose les valeurs de présence que de la question désignée', () => {
    expect(presenceValues(schema, 'presence').map((v) => v.value)).toEqual(['oui', 'non']);
    expect(presenceValues(schema, 'nom')).toEqual([]);
    expect(presenceValues(schema, undefined)).toEqual([]);
    expect(presenceValues(schema, 'inconnu')).toEqual([]);
  });
});

describe('statut d’une réponse', () => {
  it('compte une personne pour un présent sans question d’effectif', () => {
    expect(attendanceOf(BASE, { data: { presence: 'oui' } }, undefined)).toEqual({
      status: 'attending',
      people: 1,
      ambiguous: false,
    });
  });

  it('reconnaît un refus', () => {
    expect(attendanceOf(BASE, { data: { presence: 'non' } }, undefined)).toEqual({
      status: 'declined',
      people: 0,
      ambiguous: false,
    });
  });

  it('distingue « sans réponse » d’un refus', () => {
    // Une question de présence facultative, ou masquée par une condition,
    // laisse la réponse sans statut. La confondre avec un refus fausserait le
    // décompte des déclinants.
    for (const data of [{}, { presence: '' }, { presence: null }]) {
      expect(attendanceOf(BASE, { data }, undefined).status).toBe('unknown');
    }
  });

  it('refuse de compter sans configuration', () => {
    expect(attendanceOf({}, { data: { presence: 'oui' } }, undefined).status).toBe('unknown');
  });
});

describe('effectif', () => {
  const settings: AttendanceSettings = { ...BASE, partyField: 'accompagnants' };

  it('ajoute les accompagnants au répondant', () => {
    expect(
      attendanceOf(settings, { data: { presence: 'oui', accompagnants: 'a2' } }, field('accompagnants')).people,
    ).toBe(3);
  });

  it('lit le LIBELLÉ de l’option, pas sa valeur technique', () => {
    // Les valeurs sont des identifiants figés à la création (« a1 ») ; seul le
    // libellé porte le nombre.
    expect(
      attendanceOf(settings, { data: { presence: 'oui', accompagnants: 'a1' } }, field('accompagnants')).people,
    ).toBe(2);
  });

  it('compte le répondant seul quand il déclare zéro accompagnant', () => {
    expect(
      attendanceOf(settings, { data: { presence: 'oui', accompagnants: 'a0' } }, field('accompagnants')).people,
    ).toBe(1);
  });

  it('sait lire un total qui inclut déjà le répondant', () => {
    const total: AttendanceSettings = { ...BASE, partyField: 'total', partyMode: 'total' };
    expect(attendanceOf(total, { data: { presence: 'oui', total: 4 } }, field('total')).people).toBe(4);
  });

  it('ne descend jamais sous une personne en mode total', () => {
    // Une personne qui vient compte au moins pour elle-même, quoi qu'elle ait
    // saisi.
    const total: AttendanceSettings = { ...BASE, partyField: 'total', partyMode: 'total' };
    expect(attendanceOf(total, { data: { presence: 'oui', total: 0 } }, field('total')).people).toBe(1);
  });

  it('signale l’ambiguïté quand plusieurs cases sont cochées', () => {
    // Additionner « 1 » et « 3 », ou retenir le maximum, serait un arbitrage
    // que l'organisation n'a pas demandé.
    const multi: AttendanceSettings = { ...BASE, partyField: 'multi' };
    const row = attendanceOf(multi, { data: { presence: 'oui', multi: ['m1', 'm3'] } }, field('multi'));
    expect(row).toEqual({ status: 'attending', people: 1, ambiguous: true });
  });

  it('signale l’ambiguïté quand l’effectif n’a pas été renseigné', () => {
    const row = attendanceOf(settings, { data: { presence: 'oui' } }, field('accompagnants'));
    expect(row.ambiguous).toBe(true);
    expect(row.people).toBe(1);
  });

  it('n’ambiguïse pas un refus : son effectif est zéro, sans réserve', () => {
    const row = attendanceOf(settings, { data: { presence: 'non' } }, field('accompagnants'));
    expect(row).toEqual({ status: 'declined', people: 0, ambiguous: false });
  });

  it.each([
    ['un nombre hors bornes', { presence: 'oui', total: 5000 }, 'total'],
    ['un nombre non fini', { presence: 'oui', total: Number.NaN }, 'total'],
  ])('signale l’ambiguïté sur %s', (_label, data, id) => {
    const settings2: AttendanceSettings = { ...BASE, partyField: id, partyMode: 'total' };
    expect(attendanceOf(settings2, { data }, field(id)).ambiguous).toBe(true);
  });
});

describe('totaux', () => {
  const settings: AttendanceSettings = { ...BASE, partyField: 'accompagnants' };
  const responses = [
    { data: { presence: 'oui', accompagnants: 'a2' } }, // 3 personnes
    { data: { presence: 'oui', accompagnants: 'a0' } }, // 1 personne
    { data: { presence: 'non' } },
    { data: {} },
    { data: { presence: 'oui' } }, // présent, effectif ambigu → 1
  ];

  it('additionne les personnes, pas les réponses', () => {
    expect(countAttendance(schema, settings, responses)).toEqual({
      attending: 3,
      declined: 1,
      unknown: 1,
      people: 5,
      ambiguous: 1,
    });
  });

  it('rend un total nul sans réponse', () => {
    expect(countAttendance(schema, settings, [])).toEqual({
      attending: 0,
      declined: 0,
      unknown: 0,
      people: 0,
      ambiguous: 0,
    });
  });

  it('produit une ligne par réponse, dans l’ordre reçu', () => {
    const rows = attendanceRows(schema, settings, responses);
    expect(rows).toHaveLength(responses.length);
    expect(rows.map((row) => row.status)).toEqual([
      'attending',
      'attending',
      'declined',
      'unknown',
      'attending',
    ]);
    expect(rows.map((row) => row.people)).toEqual([3, 1, 0, 0, 1]);
  });

  it('ignore une question d’effectif désignée mais disparue du schéma', () => {
    // Le champ a pu être supprimé de l'éditeur après la configuration : on
    // compte alors une personne par présent, sans prétendre à mieux.
    const stale: AttendanceSettings = { ...BASE, partyField: 'parti' };
    expect(countAttendance(schema, stale, responses).people).toBe(3);
  });
});
