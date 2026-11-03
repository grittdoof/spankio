import { describe, expect, it } from 'vitest';
import {
  arrivalFacts,
  arrivalReport,
  arrivalRows,
  MAX_SLICES,
  type ArrivalRow,
} from '@/lib/checkin/report';
import type { GuestRow } from '@/lib/survey/guests';
import type { CheckinState } from '@/lib/checkin/reducer';
import { responseRows } from '@/lib/export/csv';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';

/**
 * Le rapport d'après-soirée.
 *
 * Deux exigences se croisent ici : les chiffres doivent être justes, et les
 * phrases ne doivent énoncer que des FAITS. La seconde est aussi facile à
 * enfreindre que la première — « relancez plus tôt l'an prochain » se glisse
 * naturellement dans un rapport, et rien dans ces données ne le soutient.
 */

const TZ = 'Europe/Paris';

/**
 * Par défaut, TOUTES les personnes annoncées d'une inscription arrivée sont
 * pointées — c'est le cas courant. Les tests qui veulent un écart le disent
 * en passant `entered` explicitement.
 */
function row(partial: Partial<ArrivalRow> & { id: string }): ArrivalRow {
  const base = { expected: 'attending' as const, announced: 1, arrivedAt: null, ...partial };
  return {
    ...base,
    entered: partial.entered ?? (base.arrivedAt ? Math.max(1, base.announced) : 0),
  };
}

describe('les écarts entre annoncé et constaté', () => {
  it('compte ceux qui avaient dit venir et ne sont pas venus', () => {
    const report = arrivalReport(
      [
        row({ id: 'a', arrivedAt: '2026-11-18T19:05:00.000Z' }),
        row({ id: 'b' }),
        row({ id: 'c' }),
      ],
      TZ,
    );
    expect(report.expected).toBe(3);
    expect(report.arrived).toBe(1);
    expect(report.noShow).toBe(2);
  });

  it('compte ceux qui sont venus sans l’avoir annoncé', () => {
    const report = arrivalReport(
      [
        row({ id: 'a', expected: 'declined', arrivedAt: '2026-11-18T19:05:00.000Z' }),
        row({ id: 'b', expected: 'unknown', arrivedAt: '2026-11-18T19:10:00.000Z' }),
      ],
      TZ,
    );
    // Quelqu'un qui avait décliné et qui vient EST dans la salle : le traiteur
    // compte des corps, pas des intentions.
    expect(report.unexpected).toBe(2);
    expect(report.peopleIn).toBe(2);
    expect(report.noShow).toBe(0);
  });

  it('compte les personnes RÉELLEMENT pointées, sans écart à signaler', () => {
    // Trois annoncés, trois pointés : le compte tombe juste, et il n'y a rien
    // à vérifier. C'est désormais un fait, plus une présomption.
    const report = arrivalReport(
      [row({ id: 'a', announced: 3, arrivedAt: '2026-11-18T19:05:00.000Z' })],
      TZ,
    );
    expect(report.peopleIn).toBe(3);
    expect(report.corrected).toBe(0);
  });

  it('signale l’écart quand il manque des personnes à l’entrée', () => {
    // « Mme X annoncée +2, arrive seule » : c'est le chiffre que le traiteur
    // demande à 21 h, et on le TIENT au lieu de le supposer.
    const report = arrivalReport(
      [row({ id: 'a', announced: 3, entered: 1, arrivedAt: '2026-11-18T19:05:00.000Z' })],
      TZ,
    );
    expect(report.peopleIn).toBe(1);
    expect(report.corrected).toBe(1);
  });

  it('signale aussi l’écart dans l’autre sens', () => {
    // Annoncé seul, arrivé à deux : la salle compte deux corps.
    const report = arrivalReport(
      [row({ id: 'a', announced: 1, entered: 2, arrivedAt: '2026-11-18T19:05:00.000Z' })],
      TZ,
    );
    expect(report.peopleIn).toBe(2);
    expect(report.corrected).toBe(1);
  });
});

describe('le rythme des arrivées', () => {
  it('découpe en tranches de dix minutes, alignées sur l’heure ronde', () => {
    const report = arrivalReport(
      [
        row({ id: 'a', arrivedAt: '2026-11-18T18:07:00.000Z' }),
        row({ id: 'b', arrivedAt: '2026-11-18T18:12:00.000Z' }),
        row({ id: 'c', arrivedAt: '2026-11-18T18:14:00.000Z' }),
      ],
      'UTC',
    );
    expect(report.sliceMinutes).toBe(10);
    // « 18:07 » comme étiquette de colonne ne dit rien ; « 18:00 » si.
    expect(report.slices[0]!.label).toBe('18:00');
    expect(report.slices.map((slice) => slice.count)).toEqual([1, 2]);
    expect(report.busiest?.count).toBe(2);
  });

  it('ÉLARGIT la tranche plutôt que de tronquer la fenêtre', () => {
    // Une arrivée tardive isolée étirerait la fenêtre sur des heures. Couper
    // ferait DISPARAÎTRE une arrivée réelle ; on élargit donc.
    const report = arrivalReport(
      [
        row({ id: 'a', arrivedAt: '2026-11-18T18:00:00.000Z' }),
        row({ id: 'z', arrivedAt: '2026-11-19T02:00:00.000Z' }),
      ],
      'UTC',
    );
    expect(report.sliceMinutes).toBeGreaterThan(10);
    expect(report.slices.length).toBeLessThanOrEqual(MAX_SLICES);
    // Les deux arrivées sont toujours là.
    expect(report.slices.reduce((sum, slice) => sum + slice.count, 0)).toBe(2);
  });

  it('met les heures en forme dans le fuseau DE L’ÉVÉNEMENT', () => {
    const report = arrivalReport(
      [row({ id: 'a', arrivedAt: '2026-11-18T18:00:00.000Z' })],
      'Europe/Paris',
    );
    // 18:00 UTC vaut 19:00 à Paris en novembre. Une soirée hors de France
    // serait annoncée à côté si l'on se fiait au fuseau du serveur.
    expect(report.slices[0]!.label).toBe('19:00');
  });

  it('ne fabrique aucune tranche quand personne n’est arrivé', () => {
    const report = arrivalReport([row({ id: 'a' })], TZ);
    expect(report.slices).toEqual([]);
    expect(report.busiest).toBeNull();
    expect(report.firstArrival).toBeNull();
  });

  it('ignore un horodatage illisible sans fausser le reste', () => {
    const report = arrivalReport(
      [
        row({ id: 'a', arrivedAt: 'pas une date' }),
        row({ id: 'b', arrivedAt: '2026-11-18T19:00:00.000Z' }),
      ],
      TZ,
    );
    // La rangée reste comptée comme arrivée — elle l'est — mais elle ne
    // déplace pas la fenêtre.
    expect(report.arrived).toBe(2);
    expect(report.slices.reduce((sum, slice) => sum + slice.count, 0)).toBe(1);
  });
});

describe('les faits énoncés', () => {
  const report = arrivalReport(
    [
      row({ id: 'a', announced: 2, arrivedAt: '2026-11-18T19:00:00.000Z' }),
      row({ id: 'b', entered: 1, arrivedAt: '2026-11-18T19:05:00.000Z' }),
      row({ id: 'c' }),
      row({ id: 'd', expected: 'declined', arrivedAt: '2026-11-18T19:20:00.000Z' }),
    ],
    TZ,
  );

  it('n’énonce AUCUN impératif', () => {
    const facts = arrivalFacts(report, TZ);
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      // Même garde-fou que `eventInsights` : un rapport ne conseille pas.
      expect(fact).not.toMatch(
        /\b(relancez|ouvrez|pensez|prévoyez|augmentez|réduisez|anticipez|devriez)\b/i,
      );
    }
  });

  it('dit l’écart, l’affluence et les bornes', () => {
    const facts = arrivalFacts(report, TZ).join(' ');
    expect(facts).toMatch(/personnes sont entrées/);
    expect(facts).toMatch(/affluence a eu lieu/);
    expect(facts).toMatch(/Première arrivée/);
    expect(facts).toMatch(/avait annoncé venir et n’est pas arrivée/);
    expect(facts).toMatch(/sans avoir annoncé sa présence/);
  });

  it('se tait plutôt que d’inventer quand rien n’a été pointé', () => {
    const vide = arrivalReport([row({ id: 'a' })], TZ);
    expect(arrivalFacts(vide, TZ)).toEqual(['Aucune arrivée n’a été pointée.']);
  });
});

describe('la composition des rangées', () => {
  it('rapproche la liste des invités de l’état des arrivées', () => {
    const guests: GuestRow[] = [
      {
        id: 'r1',
        submittedAt: '2026-11-01T10:00:00.000Z',
        name: 'Élodie',
        initials: 'É',
        detail: null,
        companion: null,
        status: 'attending',
        people: 2,
        ambiguous: false,
      },
      {
        id: 'r2',
        submittedAt: '2026-11-01T11:00:00.000Z',
        name: 'Karim',
        initials: 'K',
        detail: null,
        companion: null,
        status: 'declined',
        people: 0,
        ambiguous: false,
      },
    ];
    const states: CheckinState[] = [
      {
        responseId: 'r1',
        seat: 0,
        arrivedAt: '2026-11-18T19:00:00.000Z',
        version: 1,
        updatedAt: '2026-11-18T19:00:00.000Z',
      },
      // Son accompagnante est entrée aussi : l'inscription vaut donc DEUX
      // personnes entrées, et c'est le comptage des sièges qui le dit.
      {
        responseId: 'r1',
        seat: 1,
        arrivedAt: '2026-11-18T19:04:00.000Z',
        version: 1,
        updatedAt: '2026-11-18T19:04:00.000Z',
      },
    ];

    const rows = arrivalRows(guests, states);
    expect(rows[0]!.arrivedAt).toBe('2026-11-18T19:00:00.000Z');
    // Une réponse sans ligne d'arrivée n'est pas arrivée : l'absence de ligne
    // EST l'information.
    expect(rows[1]!.arrivedAt).toBeNull();
    expect(rows[0]!.announced).toBe(2);
  });
});

describe('les colonnes d’arrivée de l’export', () => {
  // Un schéma VALIDÉ, pas un littéral bricolé : écrire l'objet à la main
  // aurait laissé passer une forme que le produit n'accepte pas.
  const schema: SurveySchema = (() => {
    const result = validateSurveySchema({
      version: 1,
      steps: [
        {
          id: 'etape_1',
          fields: [{ id: 'nom', type: 'text', label: 'Nom', required: true }],
        },
      ],
    });
    if (!result.ok) throw new Error('schéma de test invalide');
    return result.schema;
  })();

  const responses = [
    {
      id: 'r1',
      submitted_at: '2026-11-01T10:00:00.000Z',
      consent_given: true,
      consent_text: 'texte',
      data: { nom: 'Élodie' },
    },
    {
      id: 'r2',
      submitted_at: '2026-11-01T11:00:00.000Z',
      consent_given: true,
      consent_text: 'texte',
      data: { nom: 'Karim' },
    },
  ];

  it('garde EXACTEMENT la forme d’avant quand aucune arrivée n’est fournie', () => {
    const rows = responseRows(schema, responses);
    // Un traitement en aval qui relit ce fichier ne doit pas voir apparaître
    // deux colonnes parce qu'un module a été installé.
    expect(rows[0]).not.toContain('Arrivée');
    expect(rows[0]).not.toContain('Personnes entrées');
  });

  it('ajoute les deux colonnes dès qu’une arrivée est fournie, pour TOUTES les lignes', () => {
    const rows = responseRows(schema, responses, {
      arrivals: new Map([['r1', { arrivedAt: '2026-11-18T19:00:00.000Z', entered: 2 }]]),
    });

    expect(rows[0]!.slice(-2)).toEqual(['Arrivée', 'Personnes entrées']);
    expect(rows[1]!.slice(-2)).toEqual(['2026-11-18T19:00:00.000Z', '2']);
    // La réponse non pointée garde ses colonnes, vides : des colonnes qui
    // apparaîtraient ligne par ligne casseraient le fichier.
    expect(rows[2]!.slice(-2)).toEqual(['', '']);
  });

  it('laisse VIDE l’effectif d’une inscription dont personne n’est venu', () => {
    // Un tableur additionnerait les zéros, et le total serait faux. Personne
    // n'a dit que ce groupe s'était présenté à zéro : il ne s'est pas
    // présenté du tout.
    const rows = responseRows(schema, responses, {
      arrivals: new Map([['r1', { arrivedAt: null, entered: 0 }]]),
    });
    expect(rows[1]!.slice(-1)).toEqual(['']);
  });

  it('écrit le nombre de personnes réellement entrées', () => {
    // Deux sièges pointés sur cette inscription : le fichier dit deux, et
    // c'est un fait compté, plus un effectif annoncé puis supposé.
    const rows = responseRows(schema, responses, {
      arrivals: new Map([['r1', { arrivedAt: '2026-11-18T19:00:00.000Z', entered: 2 }]]),
    });
    expect(rows[1]!.slice(-1)).toEqual(['2']);
  });
});
