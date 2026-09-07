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

export interface CountdownParts {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  /** L'échéance est-elle atteinte ou dépassée ? */
  readonly reached: boolean;
  /** Phrase complète, pour la restitution écrite du compteur. */
  readonly label: string;
}

/**
 * Décompte jours / heures / minutes / secondes jusqu'à un instant.
 *
 * Ici, contrairement à `countdown`, l'écart est bien un écart d'INSTANTS : un
 * compteur qui affiche des secondes ne peut pas raisonner en jours de
 * calendrier. Les deux coexistent parce qu'ils répondent à deux questions
 * différentes — « dans combien de jours ? » et « dans combien de temps ? ».
 *
 * Aucun appel à l'horloge à l'intérieur : le serveur calcule une première
 * valeur, le navigateur poursuit à partir de la même. Sans ce paramètre, le
 * rendu serveur et le premier rendu client différeraient d'une seconde et
 * React signalerait une divergence d'hydratation.
 */
export function countdownParts(
  startsAt: string | null,
  now: Date,
): CountdownParts | null {
  if (!startsAt) return null;
  const target = new Date(startsAt).getTime();
  if (Number.isNaN(target) || Number.isNaN(now.getTime())) return null;

  const remaining = target - now.getTime();
  if (remaining <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, reached: true, label: 'C’est maintenant' };
  }

  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;

  // Les secondes sont volontairement absentes de la phrase écrite : une zone
  // annoncée qui change chaque seconde rendrait un lecteur d'écran inutilisable.
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} jour${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} heure${hours > 1 ? 's' : ''}`);
  if (days === 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);

  return {
    days,
    hours,
    minutes,
    seconds: rest,
    reached: false,
    label: `Dans ${parts.join(', ')}`,
  };
}
