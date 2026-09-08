import { describe, expect, it } from 'vitest';
import {
  attendanceOf,
  effectivePartyMode,
  partyModesFor,
  partyQuestion,
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
          {
            // Un choix unique SANS libellé numérique : il ne peut se lire qu'en
            // oui/non. C'est la question de l'événement qui n'accepte qu'un
            // accompagnant.
            id: 'accompagne',
            type: 'radio',
            label: 'Serez-vous accompagné ?',
            options: [
              { value: 'option_1', label: 'Oui' },
              { value: 'option_2', label: 'Non' },
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

/**
 * Question d'effectif AVEC son étape : l'étape sert à savoir si la question a
 * été posée — une étape masquée masque ses champs.
 */
const party = (id: string) => {
  const found = field(id);
  if (!found) throw new Error(`Champ inconnu : ${id}`);
  return { schema, step: schema.steps[0]!, field: found };
};

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
    expect(presenceCandidates(schema).map((f) => f.id)).toEqual([
      'presence',
      'accompagnants',
      'accompagne',
    ]);
  });

  it('n’écarte de l’effectif que les questions qu’aucune lecture ne couvre', () => {
    // Un champ libre ne se compare ni ne se compte : « Nom » n'est pas
    // candidat. Le détail des lectures est vérifié plus bas.
    const candidates = partyCandidates(schema).map((f) => f.id);
    expect(candidates).not.toContain('nom');
    expect(candidates).toContain('total');
    expect(candidates).toContain('presence');
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
      attendanceOf(settings, { data: { presence: 'oui', accompagnants: 'a2' } }, party('accompagnants')).people,
    ).toBe(3);
  });

  it('lit le LIBELLÉ de l’option, pas sa valeur technique', () => {
    // Les valeurs sont des identifiants figés à la création (« a1 ») ; seul le
    // libellé porte le nombre.
    expect(
      attendanceOf(settings, { data: { presence: 'oui', accompagnants: 'a1' } }, party('accompagnants')).people,
    ).toBe(2);
  });

  it('compte le répondant seul quand il déclare zéro accompagnant', () => {
    expect(
      attendanceOf(settings, { data: { presence: 'oui', accompagnants: 'a0' } }, party('accompagnants')).people,
    ).toBe(1);
  });

  it('sait lire un total qui inclut déjà le répondant', () => {
    const total: AttendanceSettings = { ...BASE, partyField: 'total', partyMode: 'total' };
    expect(attendanceOf(total, { data: { presence: 'oui', total: 4 } }, party('total')).people).toBe(4);
  });

  it('ne descend jamais sous une personne en mode total', () => {
    // Une personne qui vient compte au moins pour elle-même, quoi qu'elle ait
    // saisi.
    const total: AttendanceSettings = { ...BASE, partyField: 'total', partyMode: 'total' };
    expect(attendanceOf(total, { data: { presence: 'oui', total: 0 } }, party('total')).people).toBe(1);
  });

  it('signale l’ambiguïté quand plusieurs cases sont cochées', () => {
    // Additionner « 1 » et « 3 », ou retenir le maximum, serait un arbitrage
    // que l'organisation n'a pas demandé.
    const multi: AttendanceSettings = { ...BASE, partyField: 'multi' };
    const row = attendanceOf(multi, { data: { presence: 'oui', multi: ['m1', 'm3'] } }, party('multi'));
    expect(row).toEqual({ status: 'attending', people: 1, ambiguous: true });
  });

  it('signale l’ambiguïté quand l’effectif n’a pas été renseigné', () => {
    const row = attendanceOf(settings, { data: { presence: 'oui' } }, party('accompagnants'));
    expect(row.ambiguous).toBe(true);
    expect(row.people).toBe(1);
  });

  it('n’ambiguïse pas un refus : son effectif est zéro, sans réserve', () => {
    const row = attendanceOf(settings, { data: { presence: 'non' } }, party('accompagnants'));
    expect(row).toEqual({ status: 'declined', people: 0, ambiguous: false });
  });

  it.each([
    ['un nombre hors bornes', { presence: 'oui', total: 5000 }, 'total'],
    ['un nombre non fini', { presence: 'oui', total: Number.NaN }, 'total'],
  ])('signale l’ambiguïté sur %s', (_label, data, id) => {
    const settings2: AttendanceSettings = { ...BASE, partyField: id, partyMode: 'total' };
    expect(attendanceOf(settings2, { data }, party(id)).ambiguous).toBe(true);
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

describe('question d’effectif masquée par une condition', () => {
  /**
   * Reproduction du formulaire réel qui a révélé le défaut : « Nombre de
   * personnes vous accompagnant » n'est affiché qu'à ceux qui ont répondu oui
   * à « Serez-vous accompagné ? ». Tous ceux qui venaient SEULS se
   * retrouvaient marqués « à vérifier », alors que leur effectif est
   * parfaitement déterminé — une personne.
   */
  const conditional: SurveySchema = (() => {
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
                { value: 'oui', label: 'Oui' },
                { value: 'non', label: 'Non' },
              ],
            },
            {
              id: 'accompagne',
              type: 'radio',
              label: 'Serez-vous accompagné ?',
              required: true,
              options: [
                { value: 'option_1', label: 'Oui' },
                { value: 'option_2', label: 'Non' },
              ],
              condition: { field: 'presence', op: 'equals', value: 'oui' },
            },
            {
              id: 'combien',
              type: 'select',
              label: 'Nombre de personnes vous accompagnant',
              options: [
                { value: 'option_1', label: '1' },
                { value: 'option_2', label: '2' },
              ],
              condition: { field: 'accompagne', op: 'equals', value: 'option_1' },
            },
          ],
        },
      ],
    });
    if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
    return result.schema;
  })();

  const settings: AttendanceSettings = {
    presenceField: 'presence',
    presenceValue: 'oui',
    partyField: 'combien',
  };
  const question = partyQuestion(conditional, settings);

  it('compte UNE personne sans réserve quand la question n’a pas été posée', () => {
    const row = attendanceOf(
      settings,
      { data: { presence: 'oui', accompagne: 'option_2' } },
      question,
    );
    expect(row).toEqual({ status: 'attending', people: 1, ambiguous: false });
  });

  it('signale la réserve quand la question A ÉTÉ posée et laissée vide', () => {
    // La différence est là, et elle est tout le sujet : ici le répondant a dit
    // qu'il venait accompagné, sans dire de combien.
    const row = attendanceOf(
      settings,
      { data: { presence: 'oui', accompagne: 'option_1' } },
      question,
    );
    expect(row).toEqual({ status: 'attending', people: 1, ambiguous: true });
  });

  it('compte normalement quand elle a été posée ET remplie', () => {
    const row = attendanceOf(
      settings,
      { data: { presence: 'oui', accompagne: 'option_1', combien: 'option_2' } },
      question,
    );
    expect(row).toEqual({ status: 'attending', people: 3, ambiguous: false });
  });

  it('n’ajoute aucune réserve aux totaux pour ceux qui viennent seuls', () => {
    const totals = countAttendance(conditional, settings, [
      { data: { presence: 'oui', accompagne: 'option_2' } },
      { data: { presence: 'oui', accompagne: 'option_2' } },
      { data: { presence: 'oui', accompagne: 'option_1', combien: 'option_1' } },
      { data: { presence: 'oui', accompagne: 'option_1' } },
    ]);
    expect(totals).toEqual({
      attending: 4,
      declined: 0,
      unknown: 0,
      // 1 + 1 + 2 + 1 (celui dont l'effectif est indéterminé)
      people: 5,
      ambiguous: 1,
    });
  });

  it('trouve la question désignée, et rien quand elle n’est pas désignée', () => {
    expect(partyQuestion(conditional, settings)?.field.id).toBe('combien');
    expect(partyQuestion(conditional, { ...settings, partyField: undefined })).toBeUndefined();
    expect(partyQuestion(conditional, { ...settings, partyField: 'inconnu' })).toBeUndefined();
  });
});

describe('lecture en oui/non (un seul accompagnant)', () => {
  /**
   * Le scénario demandé : l'événement n'accepte qu'un accompagnant, donc
   * « Serez-vous accompagné ? » suffit — inutile de demander un nombre. Une
   * réponse « oui » ajoute UNE personne.
   */
  const settings: AttendanceSettings = {
    ...BASE,
    partyField: 'presence_plus',
    partyMode: 'one',
    partyValue: 'oui_accompagne',
  };

  const yesNo: SurveySchema = (() => {
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
                { value: 'oui', label: 'Oui' },
                { value: 'non', label: 'Non' },
              ],
            },
            {
              id: 'presence_plus',
              type: 'radio',
              label: 'Serez-vous accompagné ?',
              required: true,
              options: [
                { value: 'oui_accompagne', label: 'Oui' },
                { value: 'non_accompagne', label: 'Non' },
              ],
            },
          ],
        },
      ],
    });
    if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
    return result.schema;
  })();

  const question = partyQuestion(yesNo, settings);

  it('compte DEUX personnes sur la réponse désignée', () => {
    const row = attendanceOf(
      settings,
      { data: { presence: 'oui', presence_plus: 'oui_accompagne' } },
      question,
    );
    expect(row).toEqual({ status: 'attending', people: 2, ambiguous: false });
  });

  it('compte UNE personne sur toute autre réponse', () => {
    const row = attendanceOf(
      settings,
      { data: { presence: 'oui', presence_plus: 'non_accompagne' } },
      question,
    );
    expect(row).toEqual({ status: 'attending', people: 1, ambiguous: false });
  });

  it('signale la réserve quand la question est restée vide', () => {
    const row = attendanceOf(settings, { data: { presence: 'oui' } }, question);
    expect(row).toEqual({ status: 'attending', people: 1, ambiguous: true });
  });

  it('reste muet plutôt que faux si aucune réponse n’est désignée', () => {
    // Comparer à rien ne se déclencherait jamais : une personne par réponse,
    // sans réserve — un total muet vaut mieux qu'un total faux.
    const incomplete: AttendanceSettings = { ...settings, partyValue: undefined };
    const row = attendanceOf(
      incomplete,
      { data: { presence: 'oui', presence_plus: 'oui_accompagne' } },
      partyQuestion(yesNo, incomplete),
    );
    expect(row).toEqual({ status: 'attending', people: 1, ambiguous: false });
  });

  it('additionne correctement sur un ensemble', () => {
    const totals = countAttendance(yesNo, settings, [
      { data: { presence: 'oui', presence_plus: 'oui_accompagne' } },
      { data: { presence: 'oui', presence_plus: 'non_accompagne' } },
      { data: { presence: 'oui', presence_plus: 'oui_accompagne' } },
      { data: { presence: 'non' } },
    ]);
    expect(totals).toEqual({
      attending: 3,
      declined: 1,
      unknown: 0,
      people: 5,
      ambiguous: 0,
    });
  });
});

describe('lectures applicables à une question', () => {
  it('un champ numérique se lit en accompagnants ou en total, jamais en oui/non', () => {
    expect(partyModesFor(field('total'))).toEqual(['extra', 'total']);
  });

  it('un choix à libellés numériques accepte les trois lectures', () => {
    expect(partyModesFor(field('accompagnants'))).toEqual(['extra', 'total', 'one']);
  });

  it('un choix sans libellé numérique ne se lit QU’en oui/non', () => {
    // « Serez-vous accompagné ? » n'est pas un nombre : proposer « le total »
    // donnerait un comptage qui ne se déclenche jamais.
    expect(partyModesFor(field('presence'))).toEqual(['one']);
  });

  it('une case à cocher multiple ne peut pas être un oui/non', () => {
    expect(partyModesFor(field('multi'))).toEqual(['extra', 'total']);
  });

  it('ne propose rien pour un champ inutilisable, ni pour rien du tout', () => {
    expect(partyModesFor(field('nom'))).toEqual([]);
    expect(partyModesFor(undefined)).toEqual([]);
  });

  it('les candidats sont exactement les questions ayant au moins une lecture', () => {
    expect(partyCandidates(schema).map((f) => f.id)).toEqual([
      'presence',
      'accompagnants',
      'accompagne',
      'total',
      'multi',
    ]);
  });
});

describe('lecture incohérente avec la question', () => {
  /**
   * Le cas rencontré en production, en DEUX temps.
   *
   * Après avoir refait ses questions, l'organisation gardait
   * `partyMode: 'extra'` sur « Serez-vous accompagné ? », dont les libellés
   * sont « Oui » et « Non ». Lus comme un nombre, ils ne donnent rien — et
   * chaque présent ressortait « à vérifier ». Premier correctif : ignorer la
   * lecture impossible. Le comptage devenait muet, mais l'écran de réglages,
   * lui, annonçait « Un oui ou non » : deux réponses différentes à la même
   * question, et un accompagnant qui n'était jamais compté.
   *
   * Une question qui n'admet qu'UNE lecture reçoit donc celle-là. Ce n'est pas
   * une invention : son type la détermine, et l'écran l'annonce déjà.
   */
  const settings: AttendanceSettings = {
    ...BASE,
    partyField: 'accompagne',
    partyMode: 'extra',
    partyValue: 'option_1',
  };

  it('retient la seule lecture possible plutôt que le réglage périmé', () => {
    expect(effectivePartyMode(field('accompagne'), 'extra')).toBe('one');
    expect(
      attendanceOf(
        settings,
        { data: { presence: 'oui', accompagne: 'option_1' } },
        partyQuestion(schema, settings),
      ),
    ).toEqual({ status: 'attending', people: 2, ambiguous: false });
  });

  it('compte une personne pour qui vient seul, sans réserve', () => {
    expect(
      attendanceOf(
        settings,
        { data: { presence: 'oui', accompagne: 'option_2' } },
        partyQuestion(schema, settings),
      ),
    ).toEqual({ status: 'attending', people: 1, ambiguous: false });
  });

  it('additionne les accompagnants sur l’ensemble', () => {
    const totals = countAttendance(schema, settings, [
      { data: { presence: 'oui', accompagne: 'option_1' } },
      { data: { presence: 'oui', accompagne: 'option_2' } },
      { data: { presence: 'non' } },
    ]);
    expect(totals.people).toBe(3);
    expect(totals.ambiguous).toBe(0);
  });

  it('reste muet, jamais faux, sans réponse désignée', () => {
    // Aucune valeur ne vaut « oui » : la comparaison ne se déclencherait
    // jamais. Une personne par réponse, sans réserve.
    const silent: AttendanceSettings = { ...settings, partyValue: undefined };
    expect(
      attendanceOf(
        silent,
        { data: { presence: 'oui', accompagne: 'option_1' } },
        partyQuestion(schema, silent),
      ),
    ).toEqual({ status: 'attending', people: 1, ambiguous: false });
  });

  it('n’arbitre pas quand plusieurs lectures restent possibles', () => {
    // « Nombre de personnes vous accompagnant » porte des libellés numériques :
    // elle se lit en nombre d'accompagnants OU en total. Un réglage absurde n'y
    // désigne donc aucune lecture — choisir entre les deux serait un arbitrage
    // que personne n'a demandé.
    expect(effectivePartyMode(field('accompagnants'), 'extra')).toBe('extra');
    expect(effectivePartyMode(field('multi'), 'one')).toBe(null);
    expect(effectivePartyMode(field('nom'), 'extra')).toBe(null);
    expect(effectivePartyMode(undefined, 'extra')).toBe(null);
  });

  it('sans réglage enregistré, retient le nombre d’accompagnants', () => {
    // Défaut historique : le seul qui ne change pas le sens d'un comptage déjà
    // en place.
    expect(effectivePartyMode(field('accompagnants'), undefined)).toBe('extra');
    // Sauf si la question ne peut pas le porter.
    expect(effectivePartyMode(field('accompagne'), undefined)).toBe('one');
  });
});
