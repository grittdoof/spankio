/**
 * Génération de fichiers iCalendar (RFC 5545).
 *
 * Trois détails font la différence entre un fichier accepté partout et un
 * fichier refusé par un client sur trois :
 *
 *  1. **Fins de ligne CRLF**, sans exception (§3.1).
 *  2. **Pliage à 75 OCTETS**, pas 75 caractères : un accent pèse deux octets,
 *     un emoji quatre. Plier au caractère produit des lignes trop longues,
 *     et couper au milieu d'un caractère produit un fichier corrompu.
 *  3. **Échappement du texte** : `\`, `;`, `,` et les sauts de ligne (§3.3.11).
 *     Il ne s'applique PAS aux dates, aux URI ni aux coordonnées.
 *
 * Ce module ne fabrique aucune donnée. En particulier, un événement sans heure
 * de fin n'en reçoit pas une inventée : la RFC autorise l'absence de `DTEND`,
 * et supposer « une heure » ferait dire au fichier ce que l'organisateur n'a
 * pas écrit.
 */

/** Longueur maximale d'une ligne, en octets, hors CRLF (RFC 5545 §3.1). */
const MAX_OCTETS = 75;

const CRLF = '\r\n';

export interface IcsOrganiser {
  readonly name?: string | null;
  readonly email?: string | null;
}

export interface IcsEvent {
  /** Identifiant stable et unique. Doit rester le même entre deux versions. */
  readonly uid: string;
  readonly title: string;
  readonly start: Date;
  readonly end?: Date | null;
  /** Événement sur la journée entière : les dates sont alors sans heure. */
  readonly allDay?: boolean;
  readonly description?: string | null;
  readonly location?: string | null;
  readonly organiser?: IcsOrganiser | null;
  readonly url?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  /** Horodatage de génération. Injectable pour rendre la sortie déterministe. */
  readonly stamp?: Date;
  /** Incrémenté à chaque modification de l'événement (RFC 5545 §3.8.7.4). */
  readonly sequence?: number;
  readonly cancelled?: boolean;
}

/** Échappement des valeurs de type TEXT (§3.3.11). L'ordre importe. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?|\n/g, '\\n');
}

const encoder = new TextEncoder();

function octetLength(value: string): number {
  return encoder.encode(value).length;
}

/**
 * Plie une ligne à 75 octets, les continuations commençant par une espace.
 *
 * Le découpage se fait par point de code : une ligne coupée au milieu d'un
 * caractère multi-octets produirait un fichier illisible.
 */
export function foldIcsLine(line: string): string {
  if (octetLength(line) <= MAX_OCTETS) return line;

  const parts: string[] = [];
  let current = '';
  let currentOctets = 0;
  // La première ligne dispose de 75 octets, les suivantes de 74 : l'espace de
  // continuation compte dans la limite.
  let budget = MAX_OCTETS;

  for (const character of line) {
    const size = octetLength(character);
    if (currentOctets + size > budget) {
      parts.push(current);
      current = character;
      currentOctets = size;
      budget = MAX_OCTETS - 1;
    } else {
      current += character;
      currentOctets += size;
    }
  }
  parts.push(current);

  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join(CRLF);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** `AAAAMMJJ` en UTC, pour un événement sur la journée entière. */
export function formatIcsDate(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/** `AAAAMMJJTHHMMSSZ` : instant en UTC, sans ambiguïté de fuseau. */
export function formatIcsDateTime(date: Date): string {
  return (
    `${formatIcsDate(date)}T` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Jour suivant, en UTC : la fin d'un événement « journée entière » est exclusive. */
function nextDay(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

function textProperty(name: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const escaped = escapeIcsText(value.trim());
  return escaped === '' ? null : `${name}:${escaped}`;
}

export class IcsError extends Error {}

/**
 * Construit un fichier iCalendar contenant un seul événement.
 * Lève `IcsError` si les données ne permettent pas un fichier valide.
 */
export function buildIcs(event: IcsEvent): string {
  if (event.uid.trim() === '') {
    throw new IcsError('Un identifiant (UID) est obligatoire.');
  }
  if (Number.isNaN(event.start.getTime())) {
    throw new IcsError('La date de début est invalide.');
  }
  if (event.end && Number.isNaN(event.end.getTime())) {
    throw new IcsError('La date de fin est invalide.');
  }
  if (event.end && event.end.getTime() < event.start.getTime()) {
    throw new IcsError('La date de fin précède la date de début.');
  }
  if (event.title.trim() === '') {
    throw new IcsError('Un intitulé (SUMMARY) est obligatoire.');
  }

  const stamp = event.stamp ?? new Date();
  const lines: (string | null)[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    // Identifiant de producteur : générique, sans nom de client.
    'PRODID:-//Plateforme de sondages et d’inscriptions//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid.trim())}`,
    `DTSTAMP:${formatIcsDateTime(stamp)}`,
  ];

  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(event.start)}`);
    // Fin exclusive : un événement d'une journée finit le lendemain.
    lines.push(`DTEND;VALUE=DATE:${formatIcsDate(nextDay(event.end ?? event.start))}`);
  } else {
    lines.push(`DTSTART:${formatIcsDateTime(event.start)}`);
    if (event.end) {
      lines.push(`DTEND:${formatIcsDateTime(event.end)}`);
    }
  }

  lines.push(textProperty('SUMMARY', event.title));
  lines.push(textProperty('DESCRIPTION', event.description));
  lines.push(textProperty('LOCATION', event.location));

  // ORGANIZER exige une adresse : un `CN` seul produit une propriété invalide,
  // donc on l'omet plutôt que d'écrire quelque chose de faux.
  const organiserEmail = event.organiser?.email?.trim();
  if (organiserEmail) {
    const name = event.organiser?.name?.trim();
    const cn = name ? `;CN=${escapeIcsText(name)}` : '';
    lines.push(`ORGANIZER${cn}:mailto:${organiserEmail}`);
  }

  // Les URI ne sont pas des valeurs TEXT : elles ne sont pas échappées.
  const url = event.url?.trim();
  if (url) lines.push(`URL:${url}`);

  if (
    event.latitude !== null &&
    event.latitude !== undefined &&
    event.longitude !== null &&
    event.longitude !== undefined
  ) {
    lines.push(`GEO:${event.latitude};${event.longitude}`);
  }

  lines.push(`SEQUENCE:${event.sequence ?? 0}`);
  lines.push(`STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('TRANSP:OPAQUE');
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return (
    lines
      .filter((line): line is string => line !== null)
      .map(foldIcsLine)
      .join(CRLF) + CRLF
  );
}

/**
 * Nom de fichier proposé au téléchargement. Réduit à l'ASCII : les en-têtes
 * `Content-Disposition` non ASCII demandent un encodage que tous les clients
 * ne gèrent pas correctement.
 */
export function icsFileName(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${base === '' ? 'evenement' : base}.ics`;
}
