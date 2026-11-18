import { describe, expect, it } from 'vitest';
import { touchedResponses, type CheckinState } from '@/lib/checkin/reducer';
import {
  answerText,
  deskRows,
  guestList,
  initialsOf,
  normaliseSearch,
  parseGuestFilter,
} from '@/lib/survey/guests';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';
import type { AttendanceSettings } from '@/lib/survey/attendance';

/**
 * Liste d'accueil.
 *
 * Ces tests fixent surtout deux refus : ne rien DEVINER (le nom d'un invité est
 * désigné, sans quoi la rangée est titrée par sa date) et ne jamais afficher la
 * VALEUR d'une option à la place de son libellé — celle-ci est un identifiant
 * figé à la création, qui ne veut rien dire pour une personne.
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
              { value: 'oui', label: 'Oui' },
              { value: 'non', label: 'Non' },
            ],
          },
          { id: 'accompagnants', type: 'number', label: 'Combien ?', min: 0, max: 10 },
          { id: 'nom', type: 'text', label: 'Nom et prénom' },
          { id: 'email', type: 'email', label: 'Adresse électronique' },
          {
            id: 'societe',
            type: 'select',
            label: 'Société',
            allowOther: true,
            options: [
              { value: 'option_1', label: 'Spie batignolles' },
              { value: 'option_2', label: 'Ville de Paris' },
            ],
          },
          {
            id: 'regimes',
            type: 'checkbox',
            label: 'Régimes',
            options: [
              { value: 'option_1', label: 'Végétarien' },
              { value: 'option_2', label: 'Sans gluten' },
            ],
          },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
})();

const field = (id: string) => schema.steps[0]!.fields.find((f) => f.id === id)!;

const SETTINGS: AttendanceSettings = {
  presenceField: 'presence',
  presenceValue: 'oui',
  partyField: 'accompagnants',
  partyMode: 'extra',
  identityField: 'nom',
  detailField: 'societe',
};

const response = (
  id: string,
  data: Record<string, unknown>,
  submittedAt = '2026-09-01T10:00:00Z',
) => ({ id, submitted_at: submittedAt, data });

describe('texte d’une réponse', () => {
  it('rend le LIBELLÉ d’une option, jamais sa valeur', () => {
    expect(answerText(field('societe'), { societe: 'option_1' })).toBe('Spie batignolles');
  });

  it('rend la saisie libre quand l’option « autre » a été choisie', () => {
    expect(
      answerText(field('societe'), { societe: 'other', societe__other: 'Atelier Sauvage' }),
    ).toBe('Atelier Sauvage');
  });

  it('ne rend rien pour un « autre » resté vide, plutôt que le mot « other »', () => {
    expect(answerText(field('societe'), { societe: 'other' })).toBeNull();
  });

  it('joint les libellés d’un choix multiple', () => {
    expect(answerText(field('regimes'), { regimes: ['option_2', 'option_1'] })).toBe(
      'Sans gluten, Végétarien',
    );
  });

  it('ne rend rien pour une absence de réponse', () => {
    expect(answerText(field('nom'), {})).toBeNull();
    expect(answerText(field('nom'), { nom: '' })).toBeNull();
  });
});

describe('initiales', () => {
  it('prend au plus deux lettres, une par mot', () => {
    expect(initialsOf('Camille Arnoult')).toBe('CA');
    expect(initialsOf('Jean Pierre Marie Dupont')).toBe('JP');
    expect(initialsOf('Nadia')).toBe('N');
  });

  it('compte les lettres accentuées pour une seule', () => {
    expect(initialsOf('Élodie Marchand')).toBe('ÉM');
  });

  it('ignore ce qui n’est pas une lettre', () => {
    expect(initialsOf('  42 ')).toBe('');
    expect(initialsOf('')).toBe('');
  });
});

describe('recherche', () => {
  it('ignore la casse ET les accents', () => {
    expect(normaliseSearch('  Élodie ')).toBe('elodie');
  });

  it('trouve « Élodie » en tapant « elodie »', () => {
    const list = guestList(
      schema,
      SETTINGS,
      [
        response('1', { presence: 'oui', nom: 'Élodie Marchand' }),
        response('2', { presence: 'oui', nom: 'Karim Zebiri' }),
      ],
      { search: 'elodie' },
    );
    expect(list.rows.map((row) => row.id)).toEqual(['1']);
  });

  it('cherche aussi dans ce qui n’est PAS affiché', () => {
    // « Sans gluten » n'apparaît sur aucune rangée : la chercher doit pourtant
    // ramener la ligne, sinon la recherche paraîtrait cassée.
    const list = guestList(
      schema,
      SETTINGS,
      [
        response('1', { presence: 'oui', nom: 'A', regimes: ['option_2'] }),
        response('2', { presence: 'oui', nom: 'B' }),
      ],
      { search: 'gluten' },
    );
    expect(list.rows.map((row) => row.id)).toEqual(['1']);
  });
});

describe('filtres', () => {
  const responses = [
    response('1', { presence: 'oui', nom: 'Camille Arnoult', societe: 'option_1', accompagnants: 2 }),
    response('2', { presence: 'non', nom: 'Karim Zebiri' }),
    response('3', { nom: 'Thomas Reverdy' }),
    response('4', { presence: 'oui', nom: 'Sofia Nunes' }),
  ];

  it('ne retient que des clés connues', () => {
    expect(parseGuestFilter('presents')).toBe('attending');
    expect(parseGuestFilter('nimporte')).toBe('all');
  });

  it('compte AVANT de filtrer : une puce ne change pas de valeur selon la puce active', () => {
    const filtered = guestList(schema, SETTINGS, responses, { filter: 'declined' });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.counts).toEqual({ all: 4, attending: 2, declined: 1, unknown: 1 });
    expect(filtered.hidden).toBe(3);
  });

  it('compose la rangée avec le nom, la seconde information et l’effectif', () => {
    const list = guestList(schema, SETTINGS, responses);
    expect(list.rows[0]).toMatchObject({
      name: 'Camille Arnoult',
      initials: 'CA',
      detail: 'Spie batignolles',
      status: 'attending',
      people: 3,
      ambiguous: false,
    });
  });

  it('conserve l’ordre reçu : la liste est déjà triée par la requête', () => {
    const list = guestList(schema, SETTINGS, responses);
    expect(list.rows.map((row) => row.id)).toEqual(['1', '2', '3', '4']);
  });
});

describe('sans désignation', () => {
  it('ne devine aucun nom : la rangée n’en a pas', () => {
    const list = guestList(
      schema,
      { presenceField: 'presence', presenceValue: 'oui' },
      [response('1', { presence: 'oui', nom: 'Camille Arnoult' })],
    );
    expect(list.rows[0]!.name).toBeNull();
    expect(list.rows[0]!.initials).toBe('');
    expect(list.rows[0]!.detail).toBeNull();
    // L'horodatage reste disponible : c'est lui qui titrera la rangée.
    expect(list.rows[0]!.submittedAt).toBe('2026-09-01T10:00:00Z');
  });

  it('sans comptage configuré, tout est « sans réponse » et personne n’est compté', () => {
    const list = guestList(schema, {}, [response('1', { presence: 'oui' })]);
    expect(list.rows[0]!.status).toBe('unknown');
    expect(list.rows[0]!.people).toBe(0);
  });

  it('signale un effectif indéterminé plutôt que de l’arbitrer', () => {
    // Ambiguïté RÉELLE : la question du nombre peut porter un effectif, elle
    // était affichée, et elle est restée vide.
    const list = guestList(schema, SETTINGS, [
      response('1', { presence: 'oui', nom: 'A' }),
    ]);
    expect(list.rows[0]!.ambiguous).toBe(true);
    expect(list.rows[0]!.people).toBe(1);
  });

  it('ne signale RIEN quand la désignation est simplement incohérente', () => {
    // « Régimes » est une case à cocher aux libellés non numériques : elle ne
    // peut porter aucun effectif. La désigner est une erreur de réglage, pas
    // une ambiguïté de réponse — et marquer « à vérifier » chaque rangée
    // ferait passer une désignation cassée pour un problème de données.
    const list = guestList(
      schema,
      { ...SETTINGS, partyField: 'regimes' },
      [response('1', { presence: 'oui', nom: 'A', regimes: ['option_1', 'option_2'] })],
    );
    expect(list.rows[0]!.ambiguous).toBe(false);
    expect(list.rows[0]!.people).toBe(1);
  });
});

describe('nom composé sur plusieurs questions', () => {
  const twoPart: AttendanceSettings = {
    ...SETTINGS,
    identityFields: ['nom', 'societe'],
    identityField: undefined,
  };

  function nameFor(settings: AttendanceSettings, data: Record<string, unknown>): string | null {
    const rows = guestList(schema, settings, [
      { id: 'r1', submitted_at: '2026-11-01T10:00:00.000Z', data },
    ]).rows;
    return rows[0]?.name ?? null;
  }

  it('joint les réponses désignées, dans l’ordre', () => {
    // C'est le besoin réel : un formulaire qui demande le nom et le prénom
    // séparément doit titrer « Dupont Spie batignolles », pas l'un des deux.
    expect(nameFor(twoPart, { nom: 'Dupont', societe: 'option_1' })).toBe(
      'Dupont Spie batignolles',
    );
  });

  it('saute une réponse vide au lieu de laisser un blanc', () => {
    expect(nameFor(twoPart, { nom: 'Dupont' })).toBe('Dupont');
    expect(nameFor(twoPart, { societe: 'option_1' })).toBe('Spie batignolles');
  });

  it('ne nomme rien quand aucune des questions n’a de réponse', () => {
    expect(nameFor(twoPart, {})).toBeNull();
  });

  it('prend les initiales du nom COMPOSÉ', () => {
    // « DS » et non « DD » : la pastille doit suivre ce qui est affiché.
    const rows = guestList(schema, twoPart, [
      { id: 'r1', submitted_at: '2026-11-01T10:00:00.000Z', data: { nom: 'Dupont', societe: 'option_2' } },
    ]).rows;
    expect(rows[0]?.initials).toBe('DV');
  });

  it('continue d’honorer la désignation historique', () => {
    expect(nameFor({ ...SETTINGS }, { nom: 'Dupont', societe: 'option_1' })).toBe('Dupont');
  });

  it('ignore une question désignée qui n’existe plus au schéma', () => {
    // Même règle que partout : muet plutôt que faux.
    const orphan: AttendanceSettings = { ...SETTINGS, identityFields: ['nom', 'disparue'] };
    expect(nameFor(orphan, { nom: 'Dupont' })).toBe('Dupont');
  });
});

/**
 * Ce que la PORTE a à connaître.
 *
 * Le pointage ne concerne que les gens qui viennent : une personne qui a
 * annoncé ne pas venir n'a rien à faire dans une liste qu'on parcourt debout,
 * d'une main, entre deux invités réels.
 *
 * Le piège est à l'autre bout, et c'est lui que ces tests gardent : le filtre
 * doit RETIRER les refus, surtout pas « ne garder que les présents annoncés ».
 * Un invité ajouté à l'entrée n'a pas répondu à la question de présence — son
 * statut est « sans réponse » — et le garder dehors ferait disparaître de
 * l'écran la personne qu'on vient tout juste d'y inscrire.
 */
describe('rangées du poste', () => {
  const responses = [
    response('1', { presence: 'oui', nom: 'Camille Arnoult' }),
    response('2', { presence: 'non', nom: 'Karim Zebiri' }),
    response('3', { nom: 'Thomas Reverdy' }),
    response('4', { presence: 'oui', nom: 'Sofia Nunes' }),
  ];

  it('retire ceux qui ont annoncé ne pas venir', () => {
    const rows = deskRows(guestList(schema, SETTINGS, responses).rows);
    expect(rows.map((row) => row.name)).not.toContain('Karim Zebiri');
  });

  it('GARDE une rangée sans réponse : c’est celle d’un ajout à l’entrée', () => {
    const rows = deskRows(guestList(schema, SETTINGS, responses).rows);
    expect(rows.map((row) => row.name)).toContain('Thomas Reverdy');
    expect(rows.map((row) => row.id)).toEqual(['1', '3', '4']);
  });

  it('ne touche ni à l’ordre ni au contenu des rangées conservées', () => {
    const list = guestList(schema, SETTINGS, responses);
    const rows = deskRows(list.rows);
    expect(rows[0]).toBe(list.rows[0]);
    expect(rows).toHaveLength(3);
  });

  it('rend une liste vide plutôt que tout, quand personne ne vient', () => {
    const refus = [response('9', { presence: 'non', nom: 'Karim Zebiri' })];
    expect(deskRows(guestList(schema, SETTINGS, refus).rows)).toHaveLength(0);
  });

  /*
   * L'exception, et c'est elle qui compte le soir même : quelqu'un décline,
   * vient quand même, une hôtesse le pointe. Le retirer au rafraîchissement
   * suivant l'effacerait de l'écran ET du compteur de salle, pendant que le
   * rapport continuerait de le compter.
   */
  it('GARDE une rangée déclinée que la porte a déjà touchée', () => {
    const rows = deskRows(guestList(schema, SETTINGS, responses).rows, new Set(['2']));
    expect(rows.map((row) => row.id)).toEqual(['1', '2', '3', '4']);
  });

  it('ne garde pas les autres refus pour autant', () => {
    const avec = [...responses, response('5', { presence: 'non', nom: 'Léa Fabre' })];
    const rows = deskRows(guestList(schema, SETTINGS, avec).rows, new Set(['2']));
    expect(rows.map((row) => row.name)).not.toContain('Léa Fabre');
  });
});

/**
 * Ce qui compte comme « touché par la porte ».
 *
 * Une ligne d'état existe dès qu'un geste a eu lieu, et elle SURVIT au
 * dé-pointage — `set_checkin` repasse `arrived_at` à nul sans supprimer la
 * ligne. Lire la présence de la ligne plutôt que son contenu garderait donc à
 * l'écran quelqu'un dont on vient justement de dire qu'il n'est pas là.
 */
describe('inscriptions déjà touchées par la porte', () => {
  const state = (partial: Partial<CheckinState> & { responseId: string }): CheckinState => ({
    seat: 0,
    arrivedAt: null,
    giftAt: null,
    version: 1,
    updatedAt: '2026-11-18T19:00:00.000Z',
    ...partial,
  });

  it('retient une arrivée, et un cadeau même sans arrivée', () => {
    const touched = touchedResponses([
      state({ responseId: 'r1', arrivedAt: '2026-11-18T19:05:00.000Z' }),
      state({ responseId: 'r2', giftAt: '2026-11-18T23:40:00.000Z' }),
    ]);
    expect([...touched].sort()).toEqual(['r1', 'r2']);
  });

  it('ne retient PAS une ligne laissée par un dé-pointage', () => {
    expect(touchedResponses([state({ responseId: 'r3' })]).has('r3')).toBe(false);
  });

  it('suffit qu’UN siège porte le geste : la rangée est celle de l’inscription', () => {
    const touched = touchedResponses([
      state({ responseId: 'r4', seat: 0 }),
      state({ responseId: 'r4', seat: 1, arrivedAt: '2026-11-18T19:10:00.000Z' }),
    ]);
    expect(touched.has('r4')).toBe(true);
  });
});
