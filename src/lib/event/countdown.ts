import { isKnownTimeZone } from './time';

/**
 * Compte à rebours jusqu'à un événement, exprimé en JOURS DE CALENDRIER.
 *
 * En jours de calendrier et non en multiples de 24 h : « J-1 » veut dire
 * « demain », pas « dans 24 heures ». Une soirée qui commence à 19 h serait
 * annoncée « J-0 » toute la journée de la veille si l'on divisait un écart de
 * millisecondes par 86 400 000.
 *
 * Le fuseau retenu est celui de l'ÉVÉNEMENT : c'est là que la question « on est
 * à combien de jours ? » se pose. Un organisateur en déplacement doit lire le
 * même chiffre que sur place.
 */

const DAY_MS = 86_400_000;

function dayNumber(instant: Date, timeZone: string): number | null {
  if (Number.isNaN(instant.getTime())) return null;
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  const midnight = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(midnight.getTime()) ? null : midnight.getTime() / DAY_MS;
}

/**
 * Jours restants : positif avant, `0` le jour même, négatif après.
 * `null` si la date ou le fuseau manquent — rien n'est deviné.
 */
export function daysUntil(
  startsAt: string | null,
  options: { readonly now: Date; readonly timeZone?: string },
): number | null {
  if (!startsAt) return null;
  const timeZone =
    options.timeZone && isKnownTimeZone(options.timeZone) ? options.timeZone : 'UTC';
  const start = dayNumber(new Date(startsAt), timeZone);
  const today = dayNumber(options.now, timeZone);
  if (start === null || today === null) return null;
  return Math.round(start - today);
}

export interface Countdown {
  /** Forme courte de la pastille : « J-12 », « Jour J », « Passé ». */
  readonly badge: string;
  /** Phrase complète, dite au lecteur d'écran. */
  readonly label: string;
  readonly days: number;
  readonly past: boolean;
}

export function countdown(
  startsAt: string | null,
  options: { readonly now: Date; readonly timeZone?: string },
): Countdown | null {
  const days = daysUntil(startsAt, options);
  if (days === null) return null;
  if (days === 0) return {
      badge: 'Jour J',
      label: 'L’événement a lieu aujourd’hui',
      days,
      past: false,
    };
  if (days < 0) {
    const past = Math.abs(days);
    return {
      badge: 'Passé',
      label: `L’événement a eu lieu il y a ${past} jour${past > 1 ? 's' : ''}`,
      days,
      past: true,
    };
  }
  return {
    badge: `J-${days}`,
    label: `Dans ${days} jour${days > 1 ? 's' : ''}`,
    days,
    past: false,
  };
}
