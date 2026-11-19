import { describe, expect, it } from 'vitest';
import { arrivalReport, type ArrivalRow } from '@/lib/checkin/report';
import { arrivalSummary, SUMMARY_HEADINGS } from '@/lib/checkin/summary';

/**
 * La synthèse partagée par l'écran, le papier et le document Word.
 *
 * Ce que ces tests fixent, c'est ce qu'elle TAIT : « 0 cadeau » sur une soirée
 * qui n'en prévoyait pas, et l'effectif annoncé quand la question de présence
 * n'est pas désignée. Les afficher laisserait croire, dans le premier cas,
 * qu'on attendait des cadeaux ; dans le second, qu'on compte des personnes
 * alors qu'on compte des réponses.
 */

const TZ = 'Europe/Paris';

function row(partial: Partial<ArrivalRow> & { id: string }): ArrivalRow {
  return {
    expected: 'attending',
    announced: 1,
    arrivedAt: null,
    entered: 0,
    walkIn: false,
    gifts: 0,
    giftsWithoutArrival: 0,
    ...partial,
  };
}

const ROWS: ArrivalRow[] = [
  row({ id: 'a', announced: 2, entered: 2, arrivedAt: '2026-11-06T18:02:00.000Z' }),
  row({ id: 'b', entered: 1, arrivedAt: '2026-11-06T18:07:00.000Z' }),
  row({ id: 'c' }),
  row({ id: 'd', expected: 'declined', entered: 1, arrivedAt: '2026-11-06T18:31:00.000Z' }),
];

const REPORT = arrivalReport(ROWS, TZ);

describe('arrivalSummary', () => {
  it('ouvre sur le chiffre qu’on vient chercher', () => {
    const summary = arrivalSummary(REPORT, [], { counting: true });
    expect(summary.headline.value).toBe(REPORT.peopleIn);
    expect(summary.headline.detail).toBe(
      `personnes entrées sur ${REPORT.peopleExpected} annoncées`,
    );
  });

  it('ne parle d’effectif annoncé que si la présence est désignée', () => {
    // Sans désignation, on compte des RÉPONSES : annoncer « sur 0 annoncées »
    // serait un chiffre inventé.
    const summary = arrivalSummary(REPORT, [], { counting: false });
    expect(summary.headline.detail).toBe('personnes entrées');
    expect(summary.figures.map((figure) => figure.label)).not.toContain(
      'Annoncées présentes',
    );
  });

  it('tait le cadeau quand il n’y en a pas eu', () => {
    const summary = arrivalSummary(REPORT, [], { counting: true });
    expect(summary.figures.map((figure) => figure.label)).not.toContain(
      'Cadeaux remis au départ',
    );
  });

  it('le dit dès qu’il y en a un', () => {
    const report = arrivalReport(
      [...ROWS, row({ id: 'e', gifts: 2, entered: 1, arrivedAt: '2026-11-06T22:00:00.000Z' })],
      TZ,
    );
    const summary = arrivalSummary(report, [], { counting: true });
    expect(summary.figures.find((figure) => figure.label === 'Cadeaux remis au départ')).toEqual(
      { label: 'Cadeaux remis au départ', value: 2 },
    );
  });

  it('porte l’accent sur le nombre d’arrivées de l’affluence', () => {
    // La phrase voyage en FRAGMENTS : l'écran en fait un `<strong>`, Word un
    // passage en gras. Recomposer la phrase de chaque côté l'aurait fait
    // diverger au premier mot changé.
    const summary = arrivalSummary(REPORT, [], { counting: true });
    const joined = summary.pace.lead.map((span) => span.text).join('');
    expect(joined).toContain('Tranches de 10 minutes');
    expect(summary.pace.lead.filter((span) => span.strong)).toHaveLength(1);
    expect(summary.pace.lead.find((span) => span.strong)?.text).toBe(
      String(REPORT.busiest?.count),
    );
  });

  it('reste muet sur l’affluence quand personne n’est arrivé', () => {
    const summary = arrivalSummary(arrivalReport([row({ id: 'z' })], TZ), [], {
      counting: true,
    });
    expect(summary.pace.lead.map((span) => span.text).join('')).toBe(
      'Tranches de 10 minutes.',
    );
    expect(summary.pace.busiestCount).toBe(0);
  });

  it('reprend les faits tels quels, sans en fabriquer', () => {
    const facts = ['Deux personnes sur trois étaient là avant 19:00.'];
    expect(arrivalSummary(REPORT, facts, { counting: true }).facts).toEqual(facts);
  });

  it('nomme les trois sections une seule fois pour les trois rendus', () => {
    expect(SUMMARY_HEADINGS.what).toBe('Ce qui s’est passé');
    expect(SUMMARY_HEADINGS.when).toBe('Quand les gens sont arrivés');
    expect(SUMMARY_HEADINGS.facts).toBe('À retenir');
  });
});
