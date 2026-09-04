import { formatIcsDate, formatIcsDateTime } from './ics';

/**
 * Liens « ajouter à mon agenda » et « itinéraire ».
 *
 * Ils complètent le fichier ICS sans le remplacer : un lien fonctionne d'un
 * clic sur mobile, un fichier fonctionne hors ligne et dans les clients
 * lourds. Le cahier des charges demande les deux, sur l'accueil ET sur la
 * confirmation.
 *
 * Aucune donnée n'est inventée : un champ absent est simplement omis du lien.
 */

export interface CalendarTarget {
  readonly title: string;
  readonly start: Date;
  readonly end?: Date | null;
  readonly allDay?: boolean;
  readonly description?: string | null;
  readonly location?: string | null;
}

/** Fin utilisée dans les liens quand l'organisateur n'en a pas indiqué. */
function endOrStart(target: CalendarTarget): Date {
  return target.end ?? target.start;
}

/** Fin exclusive du lendemain, pour un événement sur la journée entière. */
function exclusiveEnd(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

function appendIfPresent(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined,
): void {
  const trimmed = value?.trim();
  if (trimmed) params.set(key, trimmed);
}

/**
 * Lien Google Agenda. Le paramètre `dates` attend `début/fin` au format
 * compact : `AAAAMMJJ` pour une journée entière, `AAAAMMJJTHHMMSSZ` sinon.
 */
export function googleCalendarUrl(target: CalendarTarget): string {
  const params = new URLSearchParams({ action: 'TEMPLATE', text: target.title.trim() });

  const dates = target.allDay
    ? `${formatIcsDate(target.start)}/${formatIcsDate(exclusiveEnd(endOrStart(target)))}`
    : `${formatIcsDateTime(target.start)}/${formatIcsDateTime(endOrStart(target))}`;
  params.set('dates', dates);

  appendIfPresent(params, 'details', target.description);
  appendIfPresent(params, 'location', target.location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Lien Outlook / Microsoft 365. Attend des dates ISO 8601, et un indicateur
 * `allday` séparé plutôt qu'un format de date différent.
 */
export function outlookCalendarUrl(target: CalendarTarget): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: target.title.trim(),
  });

  if (target.allDay) {
    params.set('allday', 'true');
    params.set('startdt', formatIsoDate(target.start));
    params.set('enddt', formatIsoDate(exclusiveEnd(endOrStart(target))));
  } else {
    params.set('startdt', target.start.toISOString());
    params.set('enddt', endOrStart(target).toISOString());
  }

  appendIfPresent(params, 'body', target.description);
  appendIfPresent(params, 'location', target.location);

  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface CalendarLinks {
  readonly google: string;
  readonly outlook: string;
  /** Chemin de téléchargement du fichier ICS, servi par l'application. */
  readonly ics: string;
}

/** Les trois façons d'ajouter l'événement à un agenda. */
export function calendarLinks(target: CalendarTarget, icsPath: string): CalendarLinks {
  return {
    google: googleCalendarUrl(target),
    outlook: outlookCalendarUrl(target),
    ics: icsPath,
  };
}

export interface DirectionsTarget {
  readonly address?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  /** Nom du lieu, utilisé comme repli quand il n'y a ni adresse ni coordonnées. */
  readonly label?: string | null;
}

export interface DirectionsLinks {
  readonly google: string;
  readonly openStreetMap: string;
  readonly apple: string;
}

/**
 * Destination utilisable : les coordonnées d'abord (sans ambiguïté), l'adresse
 * ensuite, le nom du lieu en dernier recours.
 */
function destination(target: DirectionsTarget): string | null {
  if (
    target.latitude !== null &&
    target.latitude !== undefined &&
    target.longitude !== null &&
    target.longitude !== undefined
  ) {
    return `${target.latitude},${target.longitude}`;
  }
  const address = target.address?.trim();
  if (address) return address;
  const label = target.label?.trim();
  return label ? label : null;
}

/**
 * Liens d'itinéraire. Renvoie `null` quand aucune destination n'est
 * exploitable : un bouton « itinéraire » qui ouvre une carte vide est pire
 * qu'un bouton absent.
 */
export function directionsLinks(target: DirectionsTarget): DirectionsLinks | null {
  const target_ = destination(target);
  if (target_ === null) return null;

  const google = new URLSearchParams({ api: '1', destination: target_ });

  const hasCoordinates =
    target.latitude !== null &&
    target.latitude !== undefined &&
    target.longitude !== null &&
    target.longitude !== undefined;

  // OpenStreetMap attend `route=<départ>;<arrivée>` ; le départ vide laisse
  // le navigateur ou l'utilisateur le renseigner.
  const osm = new URLSearchParams({
    route: `;${hasCoordinates ? `${target.latitude},${target.longitude}` : target_}`,
  });

  const apple = new URLSearchParams({ daddr: target_ });

  return {
    google: `https://www.google.com/maps/dir/?${google.toString()}`,
    openStreetMap: `https://www.openstreetmap.org/directions?${osm.toString()}`,
    apple: `https://maps.apple.com/?${apple.toString()}`,
  };
}
