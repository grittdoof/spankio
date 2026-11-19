import type { ArrivalReport, ArrivalSlice } from './report';

/**
 * La synthèse de la soirée, en un modèle que trois rendus partagent.
 *
 * L'écran la montre en cartes, la page imprimable la met sur du papier (donc
 * en PDF), et le document Word la rend en blocs natifs. Trois compositions
 * auraient divergé au premier chiffre ajouté — c'est exactement ce qui est
 * arrivé au nom composé, recopié à deux endroits avant d'être ramené à une
 * seule fonction.
 *
 * Module pur, comme `report.ts` : il ne lit ni horloge, ni réseau. Il ne
 * CALCULE d'ailleurs rien — tout vient déjà de `arrivalReport` ; il décide ce
 * qui se dit, dans quel ordre, et avec quels mots.
 *
 * **Un fait, jamais un conseil**, ici aussi : les phrases de `facts` sont
 * celles de `arrivalFacts`, qu'un test empêche déjà de virer à l'impératif.
 */

/** Un fragment de phrase, et s'il porte l'accent. Le gras est une EMPHASE. */
export interface RichSpan {
  readonly text: string;
  readonly strong?: boolean;
}

export interface SummaryFigure {
  readonly label: string;
  readonly value: number;
}

export interface ArrivalSummary {
  /** Le chiffre qu'on vient chercher, et ce qu'il qualifie. */
  readonly headline: { readonly value: number; readonly detail: string };
  readonly figures: readonly SummaryFigure[];
  readonly pace: {
    readonly lead: readonly RichSpan[];
    readonly sliceMinutes: number;
    readonly slices: readonly ArrivalSlice[];
    /** Plus grande valeur, pour dessiner des barres à la même échelle. */
    readonly busiestCount: number;
  };
  readonly facts: readonly string[];
}

function plural(count: number, one: string, many: string): string {
  return count > 1 ? many : one;
}

/**
 * Compose la synthèse.
 *
 * Deux absences volontaires, héritées de l'écran : « 0 cadeau » ne s'affiche
 * pas — une soirée sans cadeau laisserait croire qu'on en attendait — et
 * l'effectif annoncé disparaît quand la question de présence n'est pas
 * désignée, puisqu'on compterait alors des réponses et non des personnes.
 */
export function arrivalSummary(
  report: ArrivalReport,
  facts: readonly string[],
  options: { readonly counting: boolean },
): ArrivalSummary {
  const figures: SummaryFigure[] = [
    { label: 'Inscriptions pointées', value: report.arrived },
  ];
  if (options.counting) {
    figures.push({ label: 'Annoncées présentes', value: report.expected });
    figures.push({ label: 'Annoncées, non venues', value: report.noShow });
  }
  figures.push({ label: 'Venues sans l’avoir annoncé', value: report.unexpected });
  figures.push({ label: 'Effectifs corrigés à l’entrée', value: report.corrected });
  if (report.walkIns > 0) {
    figures.push({ label: 'Ajoutées à l’entrée', value: report.walkIns });
  }
  if (report.gifts > 0) {
    figures.push({ label: 'Cadeaux remis au départ', value: report.gifts });
  }

  const lead: RichSpan[] = [{ text: `Tranches de ${report.sliceMinutes} minutes` }];
  if (report.busiest) {
    lead.push({ text: ` — affluence ${report.busiest.fullLabel}, avec ` });
    lead.push({ text: String(report.busiest.count), strong: true });
    lead.push({
      text: ` ${plural(report.busiest.count, 'arrivée', 'arrivées')}.`,
    });
  } else {
    lead.push({ text: '.' });
  }

  return {
    headline: {
      value: report.peopleIn,
      detail: `${plural(report.peopleIn, 'personne entrée', 'personnes entrées')}${
        options.counting ? ` sur ${report.peopleExpected} annoncées` : ''
      }`,
    },
    figures,
    pace: {
      lead,
      sliceMinutes: report.sliceMinutes,
      slices: report.slices,
      busiestCount: report.slices.reduce((max, slice) => Math.max(max, slice.count), 0),
    },
    facts,
  };
}

/** Les trois titres de la synthèse, écrits une fois pour les trois rendus. */
export const SUMMARY_HEADINGS = {
  what: 'Ce qui s’est passé',
  when: 'Quand les gens sont arrivés',
  facts: 'À retenir',
} as const;
