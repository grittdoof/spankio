/**
 * Conversion entre l'heure locale d'un fuseau et l'instant absolu.
 *
 * Pourquoi ce module existe : un champ `datetime-local` produit une heure de
 * calendrier sans fuseau (« le 12 mars à 18 h 30 »), alors que la base stocke
 * un instant absolu. Convertir l'un dans l'autre en se fiant au fuseau du
 * NAVIGATEUR rendrait le champ « fuseau de l'événement » purement décoratif :
 * un organisateur en déplacement enregistrerait un horaire décalé, et le
 * fichier iCalendar enverrait tout le monde à la mauvaise heure.
 *
 * On s'appuie donc sur `Intl.DateTimeFormat`, seule source de vérité
 * disponible sur les règles de fuseau — y compris les changements d'heure,
 * qu'aucun décalage constant ne saurait représenter.
 */

/** Format « YYYY-MM-DDTHH:mm », celui d'un champ `datetime-local`. */
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isWallClock(value: string): boolean {
  return WALL_CLOCK.test(value);
}

/** Le fuseau est-il connu du moteur ? Une valeur inventée doit être refusée. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Heure de calendrier affichée par ce fuseau à cet instant.
 * Renvoie « YYYY-MM-DDTHH:mm », directement utilisable par un champ
 * `datetime-local`.
 */
export function instantToWallClock(instant: Date, timeZone: string): string | null {
  if (Number.isNaN(instant.getTime()) || !isKnownTimeZone(timeZone)) return null;

  const parts = new Map(
    partsFormatter(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );

  const year = parts.get('year');
  const month = parts.get('month');
  const day = parts.get('day');
  // Certaines implémentations rendent minuit « 24 » plutôt que « 00 ».
  const hour = parts.get('hour') === '24' ? '00' : parts.get('hour');
  const minute = parts.get('minute');

  if (!year || !month || !day || !hour || !minute) return null;
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/** Décalage du fuseau à cet instant, en millisecondes. */
function offsetAt(instant: Date, timeZone: string): number | null {
  const wall = instantToWallClock(instant, timeZone);
  if (!wall) return null;
  // `wall` lu comme s'il était en UTC : la différence avec l'instant réel EST
  // le décalage du fuseau.
  return Date.parse(`${wall}:00Z`) - instant.getTime();
}

/**
 * Instant absolu correspondant à une heure de calendrier dans un fuseau.
 *
 * Deux passes : la première estime le décalage, la seconde le corrige quand
 * l'estimation tombe de l'autre côté d'un changement d'heure.
 *
 * Comportement aux frontières, mesuré et non supposé (Europe/Paris, 2026) :
 *  * heure AMBIGUË — « 25 octobre 02 h 30 », jouée deux fois — résolue vers la
 *    SECONDE occurrence, celle en heure d'hiver (`01:30Z`) ;
 *  * heure INEXISTANTE — « 29 mars 02 h 30 », sautée — glissée d'une heure,
 *    vers 03 h 30 locales (`01:30Z`).
 *
 * Ni l'un ni l'autre n'est « juste » dans l'absolu : deux heures par an, une
 * heure de calendrier ne désigne pas un instant unique. Un instant
 * déterministe vaut mieux qu'un refus que personne ne saurait corriger.
 */
export function wallClockToInstant(wallClock: string, timeZone: string): Date | null {
  if (!isWallClock(wallClock) || !isKnownTimeZone(timeZone)) return null;

  const asUtc = Date.parse(`${wallClock}:00Z`);
  if (Number.isNaN(asUtc)) return null;

  const firstOffset = offsetAt(new Date(asUtc), timeZone);
  if (firstOffset === null) return null;

  const candidate = new Date(asUtc - firstOffset);
  const secondOffset = offsetAt(candidate, timeZone);
  if (secondOffset === null) return null;
  if (secondOffset === firstOffset) return candidate;

  return new Date(asUtc - secondOffset);
}

/** Instant absolu en ISO 8601 avec décalage, tel que l'API l'attend. */
export function wallClockToIso(wallClock: string, timeZone: string): string | null {
  const instant = wallClockToInstant(wallClock, timeZone);
  return instant ? instant.toISOString() : null;
}

/** Heure de calendrier d'un instant ISO, pour remplir un champ. */
export function isoToWallClock(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const instant = new Date(iso);
  return instantToWallClock(instant, timeZone) ?? '';
}

/**
 * Fuseaux proposés. `Intl.supportedValuesOf` donne la liste complète de la
 * base IANA quand le moteur la connaît ; sinon on retombe sur une poignée de
 * fuseaux, plutôt que sur une liste vide qui rendrait le champ inutilisable.
 */
export function availableTimeZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;

  if (typeof supported === 'function') {
    try {
      return supported('timeZone');
    } catch {
      // Moteur partiel : on continue vers la liste de repli.
    }
  }

  return [
    'Europe/Paris',
    'Europe/Brussels',
    'Europe/Luxembourg',
    'Europe/Zurich',
    'Europe/London',
    'Europe/Lisbon',
    'Europe/Madrid',
    'Europe/Berlin',
    'Atlantic/Reykjavik',
    'UTC',
  ];
}
