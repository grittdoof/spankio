/**
 * Contenu déposé dans l'agenda du répondant.
 *
 * Un rendez-vous ajouté depuis une invitation doit se suffire à lui-même :
 * rouvert trois semaines plus tard, il doit dire OÙ aller, QUI organise et où
 * retrouver l'invitation. Sans quoi le destinataire retourne fouiller ses
 * courriels — c'est-à-dire exactement ce que l'ajout à l'agenda devait éviter.
 *
 * Ce module est PUR et sert AUX DEUX chemins : les liens Google / Outlook et
 * le fichier `.ics`. Deux compositions différentes donneraient deux rendez-vous
 * différents selon le bouton cliqué.
 *
 * Rien n'est inventé : un champ absent est omis, jamais remplacé par une
 * formule creuse.
 */

export interface EventPlace {
  readonly locationLabel?: string | null;
  readonly address?: string | null;
}

/**
 * Lieu d'un seul tenant : « Musée Jacquemart-André, 158 Bd Haussmann, Paris ».
 *
 * Le nom du lieu ET l'adresse, pas l'un ou l'autre. L'adresse seule oblige à
 * reconnaître un numéro de rue au moment d'y aller ; le nom seul ne se
 * cherche pas dans un itinéraire. Les deux réunis servent aussi de champ
 * `LOCATION` du fichier iCalendar, que les agendas rendent cliquable.
 */
export function eventLocation(place: EventPlace): string | null {
  const label = place.locationLabel?.trim();
  const address = place.address?.trim();

  if (label && address) {
    // Une adresse qui répète déjà le nom du lieu ne le redouble pas.
    if (address.toLowerCase().includes(label.toLowerCase())) return address;
    return `${label}, ${address}`;
  }
  return label || address || null;
}

export interface EventNarrative {
  /** Description du formulaire — le texte de l'invitation. */
  readonly description?: string | null;
  /** Précisions propres à l'événement, saisies par l'organisation. */
  readonly details?: string | null;
  readonly organiser?: string | null;
  /** Adresse publique du formulaire, pour revenir à l'invitation. */
  readonly url?: string | null;
}

/** Longueur maximale du texte repris, pour ne pas déverser une page entière. */
const MAX_NARRATIVE = 900;

function clamp(value: string): string {
  if (value.length <= MAX_NARRATIVE) return value;
  // Coupe sur un espace : une phrase tronquée au milieu d'un mot se lit mal.
  const cut = value.slice(0, MAX_NARRATIVE);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > MAX_NARRATIVE * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Description du rendez-vous.
 *
 * Ordre voulu : ce dont il s'agit d'abord, les précisions ensuite, puis qui
 * organise, puis le lien. C'est l'ordre dans lequel on lit un rendez-vous
 * qu'on rouvre — et les agendas qui tronquent l'aperçu coupent par la fin.
 */
export function eventDescription(input: EventNarrative): string | null {
  const parts: string[] = [];

  const details = input.details?.trim();
  const description = input.description?.trim();

  // Les précisions de l'événement priment sur la description du formulaire :
  // elles ont été écrites POUR l'agenda. Les deux sont reprises si elles
  // existent et diffèrent.
  if (details) parts.push(details);
  if (description && description !== details) parts.push(description);

  const organiser = input.organiser?.trim();
  if (organiser) parts.push(`Organisé par ${organiser}`);

  const url = input.url?.trim();
  if (url) parts.push(url);

  if (parts.length === 0) return null;
  return clamp(parts.join('\n\n'));
}
