import { isKnownTimeZone } from './time';

/**
 * Mise en forme des dates d'un événement, POUR ÊTRE LUE.
 *
 * Une seule implémentation, partagée par la page publique et le courriel de
 * confirmation. Deux auraient divergé, et le courriel aurait fini par annoncer
 * une autre heure que l'invitation — sur la seule information qu'un invité
 * recopie dans son agenda.
 *
 * Tout est mis en forme dans le fuseau DE L'ÉVÉNEMENT, jamais celui du serveur
 * ni du navigateur : « 19 h 30 » veut dire 19 h 30 sur place, et c'est cette
 * heure-là qu'on compare à son propre agenda. Défaut réel corrigé : la page
 * publique formatait en `Europe/Paris` en dur alors que le champ « fuseau »
 * existait et était correctement enregistré.
 */

export interface EventWhen {
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly allDay: boolean;
  readonly timeZone: string;
}

/**
 * Formate un instant dans un fuseau, ou renvoie `null`.
 *
 * Le `try` couvre un fuseau que le moteur ne connaîtrait pas : on affiche alors
 * moins, jamais une erreur.
 */
export function formatInZone(
  value: string | null,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const zone = isKnownTimeZone(timeZone) ? timeZone : 'UTC';
  try {
    return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: zone }).format(date);
  } catch {
    return null;
  }
}

/** Date de début, en toutes lettres. Sans heure pour une journée entière. */
export function eventWhen(event: EventWhen): string | null {
  return formatInZone(
    event.startsAt,
    event.timeZone,
    event.allDay ? { dateStyle: 'full' } : { dateStyle: 'full', timeStyle: 'short' },
  );
}

/**
 * Précision d'horaire sous la date : l'heure de fin.
 *
 * Rien n'est inventé — sans heure de fin enregistrée, il n'y a pas de note. Une
 * fin le même jour se dit à l'heure seule ; un événement qui se termine le
 * lendemain reprend la date entière, sinon « fin à 2 h » serait ambigu.
 */
export function eventWhenNote(event: EventWhen): string | null {
  if (!event.endsAt || event.allDay) return null;
  const sameDay =
    formatInZone(event.startsAt, event.timeZone, { dateStyle: 'short' }) ===
    formatInZone(event.endsAt, event.timeZone, { dateStyle: 'short' });
  const end = formatInZone(
    event.endsAt,
    event.timeZone,
    sameDay ? { timeStyle: 'short' } : { dateStyle: 'long', timeStyle: 'short' },
  );
  return end ? `Fin prévue à ${end}` : null;
}
