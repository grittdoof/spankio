import type { AttendanceStatus } from '@/lib/survey/attendance';
import type { GuestRow } from '@/lib/survey/guests';
import type { CheckinState } from './reducer';

/**
 * Le rapport d'après-soirée.
 *
 * Module pur : il reçoit des rangées et des horodatages, jamais une horloge.
 * C'est la même règle que `responsePace`, et pour la même raison — un agrégat
 * qui lit l'heure se comporte différemment au rendu serveur et au rendu
 * client, et aucun test ne peut le fixer.
 *
 * **Un fait, jamais un conseil.** Tout ce qui sort d'ici est recalculable
 * depuis les données : combien sont entrés, combien avaient annoncé venir et
 * ne sont pas venus, quand l'affluence a eu lieu. On n'écrira pas « ouvrez un
 * second pupitre l'an prochain » — rien dans ces chiffres ne soutient une
 * recommandation, et un test refuse déjà tout impératif dans les énoncés de
 * `eventInsights`.
 */

export interface ArrivalRow {
  readonly id: string;
  /** Ce que l'invité avait ANNONCÉ. */
  readonly expected: AttendanceStatus;
  /** Effectif annoncé à l'inscription. */
  readonly announced: number;
  /** Première arrivée parmi les personnes de cette inscription. */
  readonly arrivedAt: string | null;
  /**
   * Personnes RÉELLEMENT entrées : le nombre de sièges pointés.
   *
   * Plus rien à deviner depuis qu'une ligne vaut une personne. L'ancien
   * « effectif entré, null si non précisé » existait parce qu'une arrivée
   * valait un groupe dont on ignorait la taille ; ce doute n'a plus lieu
   * d'être, et le chiffre est toujours exact.
   */
  readonly entered: number;
  /** Ajoutée à l'entrée, sans inscription préalable. */
  readonly walkIn: boolean;
  /** Cadeaux remis aux personnes de cette inscription : un par siège. */
  readonly gifts: number;
  /** Dont remis à une personne que la porte n'avait pas pointée. */
  readonly giftsWithoutArrival: number;
}

/** Compose les rangées du rapport depuis la liste et l'état des arrivées. */
export function arrivalRows(
  guests: readonly GuestRow[],
  states: readonly CheckinState[],
): ArrivalRow[] {
  // Les états arrivent par SIÈGE : on les regroupe par inscription, puisque
  // le rapport raisonne en inscriptions annoncées contre personnes entrées.
  const bySurvey = new Map<string, CheckinState[]>();
  for (const state of states) {
    const list = bySurvey.get(state.responseId);
    if (list) list.push(state);
    else bySurvey.set(state.responseId, [state]);
  }

  return guests.map((guest) => {
    const seats = bySurvey.get(guest.id) ?? [];
    const arrived = seats.filter((state) => state.arrivedAt !== null);
    const gifted = seats.filter((state) => state.giftAt != null);
    // La PREMIÈRE arrivée date l'inscription : c'est l'instant où ce groupe a
    // franchi la porte, et c'est lui que la courbe d'affluence doit placer.
    let first: string | null = null;
    for (const state of arrived) {
      if (state.arrivedAt && (first === null || state.arrivedAt < first)) {
        first = state.arrivedAt;
      }
    }
    return {
      id: guest.id,
      expected: guest.status,
      announced: guest.people,
      arrivedAt: first,
      entered: arrived.length,
      walkIn: guest.walkIn,
      gifts: gifted.length,
      giftsWithoutArrival: gifted.filter((state) => state.arrivedAt === null).length,
    };
  });
}

/**
 * Effectif retenu pour une rangée arrivée : les personnes réellement pointées.
 *
 * Il n'y a plus d'arbitrage ici, et c'est le gain de la ligne par personne :
 * on comptait auparavant l'effectif ANNONCÉ faute de mieux, en le disant.
 */
function countedFor(row: ArrivalRow): number {
  return row.entered;
}

/** Largeurs de tranche proposées, de la plus fine à la plus large. */
export const SLICE_MINUTES = [10, 30, 60] as const;

/** Au-delà, une courbe n'est plus lisible : on élargit la tranche. */
export const MAX_SLICES = 36;

export interface ArrivalSlice {
  /** Début de la tranche, en ISO. */
  readonly start: string;
  /** Étiquette courte, sous la colonne (« 19:10 »). */
  readonly label: string;
  /** Étiquette longue, pour le lecteur d'écran (« de 19:10 à 19:20 »). */
  readonly fullLabel: string;
  /** Rangées pointées dans la tranche. */
  readonly count: number;
  /** Personnes entrées dans la tranche. */
  readonly people: number;
}

export interface ArrivalReport {
  /** Rangées pointées comme arrivées. */
  readonly arrived: number;
  /** Rangées ayant annoncé venir. */
  readonly expected: number;
  /** Ont annoncé venir et ne sont jamais arrivés. */
  readonly noShow: number;
  /** Arrivés sans avoir annoncé venir — refus ou sans réponse. */
  readonly unexpected: number;
  /** Personnes entrées. */
  readonly peopleIn: number;
  /** Personnes annoncées par ceux qui disaient venir. */
  readonly peopleExpected: number;
  /** Rangées dont l'effectif entré a été corrigé à la main. */
  readonly corrected: number;
  /** Personnes ajoutées à l'entrée et pointées — un sous-ensemble de `unexpected`. */
  readonly walkIns: number;
  /** Cadeaux remis au départ, un par personne. */
  readonly gifts: number;
  /** Dont remis à des personnes que la porte n'avait pas pointées. */
  readonly giftsWithoutArrival: number;
  /** Largeur retenue, en minutes. */
  readonly sliceMinutes: number;
  readonly slices: readonly ArrivalSlice[];
  /** Tranche la plus fournie, ou `null` si personne n'est arrivé. */
  readonly busiest: ArrivalSlice | null;
  readonly firstArrival: string | null;
  readonly lastArrival: string | null;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

/**
 * Choisit la largeur de tranche.
 *
 * Dix minutes disent où a eu lieu l'affluence d'une soirée ordinaire. Mais une
 * arrivée tardive isolée étirerait la fenêtre sur des heures, et trente-six
 * colonnes de plus ne se lisent pas : on élargit alors plutôt que de tronquer,
 * parce que couper la fenêtre ferait DISPARAÎTRE des arrivées réelles.
 */
function chooseSlice(spanMs: number): number {
  for (const minutes of SLICE_MINUTES) {
    if (spanMs / (minutes * 60_000) + 1 <= MAX_SLICES) return minutes;
  }
  return SLICE_MINUTES[SLICE_MINUTES.length - 1]!;
}

export function arrivalReport(
  rows: readonly ArrivalRow[],
  timeZone: string,
): ArrivalReport {
  let arrived = 0;
  let expected = 0;
  let noShow = 0;
  let unexpected = 0;
  let peopleIn = 0;
  let peopleExpected = 0;
  let corrected = 0;
  let walkIns = 0;
  let gifts = 0;
  let giftsWithoutArrival = 0;

  const instants: number[] = [];

  for (const row of rows) {
    // Le cadeau se compte indépendamment de l'arrivée : quelqu'un qu'on a
    // oublié de pointer à l'entrée et qui repart avec son cadeau a bien reçu
    // un cadeau. Le rapport le dit, il ne l'efface pas.
    gifts += row.gifts;
    giftsWithoutArrival += row.giftsWithoutArrival;

    // Le rétrécissement de type sur `row.arrivedAt` suffit : l'assertion que
    // j'avais écrite ici ne changeait rien et ESLint avait raison de la
    // refuser.
    const at = row.arrivedAt === null ? Number.NaN : Date.parse(row.arrivedAt);
    const came = row.arrivedAt !== null;

    if (row.expected === 'attending') {
      expected += 1;
      peopleExpected += Math.max(1, row.announced);
      if (!came) noShow += 1;
    } else if (came) {
      // Quelqu'un qui avait décliné et qui vient quand même EST dans la salle.
      // Le traiteur et la sécurité comptent des corps, pas des intentions.
      unexpected += 1;
    }

    if (came) {
      arrived += 1;
      peopleIn += countedFor(row);
      // « Corrigé » ne veut plus dire « saisi à la main » mais « entré
      // différent de l'annoncé » — un invité annoncé accompagné venu seul, ou
      // l'inverse. C'est le chiffre qui sert à dimensionner la soirée
      // suivante, et il est désormais exact au lieu d'être déclaratif.
      // Une personne ajoutée à la porte n'a rien annoncé : la compter comme
      // « effectif corrigé » mêlerait deux faits que le rapport sépare.
      if (row.walkIn) walkIns += 1;
      else if (row.entered !== Math.max(1, row.announced)) corrected += 1;
      if (!Number.isNaN(at)) instants.push(at);
    }
  }

  instants.sort((left, right) => left - right);
  const first = instants[0] ?? null;
  const last = instants[instants.length - 1] ?? null;

  if (first === null || last === null) {
    return {
      arrived,
      expected,
      noShow,
      unexpected,
      peopleIn,
      peopleExpected,
      corrected,
      walkIns,
      gifts,
      giftsWithoutArrival,
      sliceMinutes: SLICE_MINUTES[0],
      slices: [],
      busiest: null,
      firstArrival: null,
      lastArrival: null,
    };
  }

  const minutes = chooseSlice(last - first);
  const width = minutes * 60_000;
  // La première tranche commence sur un multiple de sa largeur : « 19:07 »
  // comme étiquette de colonne ne dit rien, « 19:00 » si.
  const origin = Math.floor(first / width) * width;
  const count = Math.floor((last - origin) / width) + 1;

  const time = formatter(timeZone);
  const slices: ArrivalSlice[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = origin + index * width;
    slices.push({
      start: new Date(start).toISOString(),
      label: time.format(new Date(start)),
      fullLabel: `de ${time.format(new Date(start))} à ${time.format(new Date(start + width))}`,
      count: 0,
      people: 0,
    });
  }

  const mutable = slices as { count: number; people: number }[];
  for (const row of rows) {
    if (row.arrivedAt === null) continue;
    const at = Date.parse(row.arrivedAt);
    if (Number.isNaN(at)) continue;
    const index = Math.floor((at - origin) / width);
    const slice = mutable[index];
    if (!slice) continue;
    slice.count += 1;
    slice.people += countedFor(row);
  }

  let busiest: ArrivalSlice | null = null;
  for (const slice of slices) {
    if (slice.count === 0) continue;
    if (busiest === null || slice.count > busiest.count) busiest = slice;
  }

  return {
    arrived,
    expected,
    noShow,
    unexpected,
    peopleIn,
    peopleExpected,
    corrected,
    walkIns,
    gifts,
    giftsWithoutArrival,
    sliceMinutes: minutes,
    slices,
    busiest,
    firstArrival: new Date(first).toISOString(),
    lastArrival: new Date(last).toISOString(),
  };
}

/**
 * Les faits à retenir d'une soirée, en phrases.
 *
 * Mêmes règles qu'`eventInsights` : aucun impératif, aucune recommandation,
 * et rien qui ne se recalcule depuis les données affichées juste au-dessus.
 */
export function arrivalFacts(report: ArrivalReport, timeZone: string): string[] {
  const facts: string[] = [];
  const time = formatter(timeZone);

  if (report.arrived === 0) {
    facts.push('Aucune arrivée n’a été pointée.');
    return facts;
  }

  facts.push(
    `${report.peopleIn} personne${report.peopleIn > 1 ? 's' : ''} ${
      report.peopleIn > 1 ? 'sont entrées' : 'est entrée'
    }, pour ${report.peopleExpected} annoncée${report.peopleExpected > 1 ? 's' : ''}.`,
  );

  if (report.busiest) {
    facts.push(
      `L’affluence a eu lieu ${report.busiest.fullLabel} : ${report.busiest.count} arrivée${
        report.busiest.count > 1 ? 's' : ''
      }.`,
    );
  }

  if (report.firstArrival && report.lastArrival) {
    facts.push(
      `Première arrivée à ${time.format(new Date(report.firstArrival))}, dernière à ${time.format(
        new Date(report.lastArrival),
      )}.`,
    );
  }

  if (report.noShow > 0) {
    facts.push(
      `${report.noShow} personne${report.noShow > 1 ? 's' : ''} ${
        report.noShow > 1 ? 'avaient annoncé venir et ne sont pas arrivées' : 'avait annoncé venir et n’est pas arrivée'
      }.`,
    );
  }

  if (report.unexpected > 0) {
    facts.push(
      `${report.unexpected} ${
        report.unexpected > 1 ? 'personnes sont venues' : 'personne est venue'
      } sans avoir annoncé sa présence.`,
    );
  }

  if (report.walkIns > 0) {
    facts.push(
      `${report.walkIns} ${
        report.walkIns > 1 ? 'personnes ont été ajoutées' : 'personne a été ajoutée'
      } à l’entrée, sans inscription.`,
    );
  }

  if (report.gifts > 0) {
    facts.push(
      `${report.gifts} cadeau${report.gifts > 1 ? 'x' : ''} remis au départ${
        report.giftsWithoutArrival > 0
          ? `, dont ${report.giftsWithoutArrival} à ${
              report.giftsWithoutArrival > 1 ? 'des personnes' : 'une personne'
            } que la porte n’avait pas pointée${report.giftsWithoutArrival > 1 ? 's' : ''}`
          : ''
      }.`,
    );
  }

  if (report.corrected > 0) {
    facts.push(
      `${report.corrected} effectif${report.corrected > 1 ? 's ont' : ' a'} été corrigé${
        report.corrected > 1 ? 's' : ''
      } à l’entrée.`,
    );
  }

  return facts;
}
