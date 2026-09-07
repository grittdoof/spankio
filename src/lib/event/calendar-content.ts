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
 * Note composée automatiquement, quand l'organisation n'en a pas écrit.
 *
 * Ordre voulu : ce dont il s'agit, puis qui organise, puis le lien. C'est
 * l'ordre dans lequel on lit un rendez-vous qu'on rouvre — et les agendas qui
 * tronquent l'aperçu coupent par la fin.
 */
export function composeEventNote(input: EventNarrative): string | null {
  const parts: string[] = [];

  const description = input.description?.trim();
  if (description) parts.push(description);

  const organiser = input.organiser?.trim();
  if (organiser) parts.push(`Organisé par ${organiser}`);

  const url = input.url?.trim();
  if (url) parts.push(url);

  if (parts.length === 0) return null;
  return clamp(parts.join('\n\n'));
}

export interface EventNoteInput extends EventNarrative {
  /**
   * Note écrite par l'organisation. Quand elle existe, elle REMPLACE le texte
   * composé — elle ne s'y ajoute pas.
   */
  readonly custom?: string | null;
}

/**
 * Note déposée dans l'agenda du répondant.
 *
 * Une note écrite par l'organisation fait autorité, entière : elle n'est ni
 * complétée par le lien, ni suivie d'une mention d'organisateur. C'est le
 * contrat le plus prévisible — ce qu'on écrit est ce que le répondant lit — et
 * l'écran de réglage propose de partir du texte automatique pour ne pas perdre
 * le lien par inadvertance.
 *
 * Une note vide, ou faite d'espaces, ne compte pas : sans cette précaution un
 * champ effacé produirait un rendez-vous muet, alors que le texte automatique
 * reste préférable à rien.
 */
export function eventNote(input: EventNoteInput): string | null {
  const custom = input.custom?.trim();
  if (custom) return clamp(custom);
  return composeEventNote(input);
}
