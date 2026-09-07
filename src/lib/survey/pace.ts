/**
 * Rythme d'arrivée des réponses.
 *
 * Module pur : il reçoit des horodatages et un « maintenant », et renvoie des
 * seaux. Aucun appel à `Date.now()` à l'intérieur — sans quoi le résultat
 * changerait entre le rendu serveur et le rendu client, et aucun test ne
 * pourrait le fixer.
 *
 * Deux fenêtres, et deux granularités qui en découlent : sept jours se lisent
 * jour par jour, un mois se lit semaine par semaine. Trente colonnes sur un
 * téléphone ne se lisent pas, et étiqueter une colonne sur cinq reviendrait à
 * cacher l'information qu'on est venu chercher.
 */

export type PaceWindow = '7j' | '30j';

export const PACE_WINDOWS: readonly PaceWindow[] = ['7j', '30j'];

export const PACE_WINDOW_LABELS: Readonly<Record<PaceWindow, string>> = {
  '7j': '7 jours',
  '30j': '30 jours',
};

export function parsePaceWindow(raw: string | undefined): PaceWindow {
  return PACE_WINDOWS.find((window) => window === raw) ?? '7j';
}

export interface PaceBucket {
  /** Début du seau, à minuit dans le fuseau retenu, en ISO. */
  readonly start: string;
  /** Étiquette courte, sous le point (« lun. », « S18 »). */
  readonly label: string;
  /** Étiquette longue, dite au lecteur d'écran et dans le résumé. */
  readonly fullLabel: string;
  readonly count: number;
}

export interface Pace {
  readonly window: PaceWindow;
  readonly buckets: readonly PaceBucket[];
  /** Réponses tombées dans la fenêtre. */
  readonly total: number;
  /** Le seau le plus fourni, ou `null` si la fenêtre est vide. */
  readonly busiest: PaceBucket | null;
}

export interface PaceInput {
  readonly submitted_at: string;
}

const DAY_MS = 86_400_000;

/**
 * Minuit du jour d'un instant, dans un fuseau donné.
 *
 * Le décalage est LU dans le fuseau plutôt que supposé : `setHours(0)` sur un
 * `Date` travaille dans le fuseau de la machine, ce qui déplacerait la
 * frontière des jours d'une à plusieurs heures sur un serveur en UTC.
 */
function startOfDay(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return new Date(`${parts}T00:00:00Z`);
}

/**
 * Les bornes de seau sont déjà des minuits ramenés à UTC : ces trois formats
 * travaillent donc en UTC. Les formater dans le fuseau de l'événement les
 * décalerait une seconde fois.
 */
const SHORT_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });
const LONG_DAY = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
/** Compact et non ambigu sous un point de graphique : « 12/06 ». */
const NUMERIC_DAY = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});

/**
 * Répartit les réponses en seaux.
 *
 * `timeZone` sert à décider où commence un jour ; les étiquettes, elles, sont
 * mises en forme en UTC parce que les bornes sont déjà des minuits ramenés à
 * UTC. Les formater de nouveau dans le fuseau les décalerait une seconde fois.
 */
export function responsePace(
  responses: readonly PaceInput[],
  options: { readonly now: Date; readonly window: PaceWindow; readonly timeZone?: string },
): Pace {
  const timeZone = options.timeZone ?? 'Europe/Paris';
  const today = startOfDay(options.now, timeZone);

  const bucketCount = options.window === '7j' ? 7 : 6;
  const bucketDays = options.window === '7j' ? 1 : 5;
  const span = bucketCount * bucketDays;
  const firstStart = today.getTime() - (span - 1) * DAY_MS;

  const counts = new Array<number>(bucketCount).fill(0);
  let total = 0;

  for (const response of responses) {
    const at = new Date(response.submitted_at);
    if (Number.isNaN(at.getTime())) continue;
    const day = startOfDay(at, timeZone).getTime();
    if (day < firstStart || day > today.getTime()) continue;
    const index = Math.floor((day - firstStart) / (bucketDays * DAY_MS));
    if (index < 0 || index >= bucketCount) continue;
    counts[index] = (counts[index] ?? 0) + 1;
    total += 1;
  }

  const buckets: PaceBucket[] = counts.map((count, index) => {
    const start = new Date(firstStart + index * bucketDays * DAY_MS);
    const end = new Date(start.getTime() + (bucketDays - 1) * DAY_MS);
    if (bucketDays === 1) {
      return {
        start: start.toISOString(),
        // « lun. » → « lun » : le point d'abréviation, répété sept fois sous un
        // graphique, ne sert qu'à encombrer.
        label: SHORT_DAY.format(start).replace('.', ''),
        fullLabel: LONG_DAY.format(start),
        count,
      };
    }
    return {
      start: start.toISOString(),
      label: NUMERIC_DAY.format(start),
      fullLabel: `du ${LONG_DAY.format(start)} au ${LONG_DAY.format(end)}`,
      count,
    };
  });

  const busiest = buckets.reduce<PaceBucket | null>((best, bucket) => {
    if (bucket.count === 0) return best;
    return best === null || bucket.count > best.count ? bucket : best;
  }, null);

  return { window: options.window, buckets, total, busiest };
}

/** Réponses arrivées dans les `days` derniers jours, bornes du fuseau comprises. */
export function recentResponses<T extends PaceInput>(
  responses: readonly T[],
  options: { readonly now: Date; readonly days: number; readonly timeZone?: string },
): readonly T[] {
  const timeZone = options.timeZone ?? 'Europe/Paris';
  const today = startOfDay(options.now, timeZone).getTime();
  const first = today - (options.days - 1) * DAY_MS;
  return responses.filter((response) => {
    const at = new Date(response.submitted_at);
    if (Number.isNaN(at.getTime())) return false;
    const day = startOfDay(at, timeZone).getTime();
    return day >= first && day <= today;
  });
}
