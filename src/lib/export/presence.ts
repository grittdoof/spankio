import type { CheckinState } from '@/lib/checkin/reducer';
import { expandSeats, seatKey, sortGuests, type SeatRow } from '@/lib/checkin/seats';
import { ATTENDANCE_STATUS_LABELS } from '@/lib/survey/attendance';
import type { GuestRow } from '@/lib/survey/guests';

/**
 * La feuille de présence : qui est venu, qui ne l'est pas.
 *
 * C'est ce qu'on extrait le lendemain, et c'est une lecture différente de
 * toutes les autres. L'export des réponses donne une ligne par INSCRIPTION
 * avec ses douze colonnes ; le rapport d'arrivées donne des agrégats. Ici on
 * veut la liste nominative des personnes, avec en face d'elles un seul mot.
 *
 * Trois décisions, toutes héritées de règles déjà posées :
 *
 *  * **Une ligne par PERSONNE**, comme le poste et le listing papier : une
 *    inscription « Jean Martin, accompagné » vaut deux personnes, et
 *    Jacqueline Martin a bien franchi la porte. Le dépliage vient APRÈS le
 *    classement, pour que l'hôte et son accompagnant restent côte à côte.
 *  * **Tout le monde y figure, y compris les refus.** Le poste les retire de
 *    l'écran — on ne tient pas une porte avec des gens qui ont dit ne pas
 *    venir — mais la feuille de présence est justement là pour dire qui
 *    manque. Son statut annoncé l'accompagne, et une personne qui avait
 *    décliné et qui est venue se lit d'un coup d'œil.
 *  * **Absence de pointage = pas venu.** C'est le contrat du module depuis le
 *    lot 2 : pré-remplir une ligne par invité obligerait à la maintenir à
 *    chaque inscription tardive, pour une information que l'absence dit déjà.
 *
 * Module pur : il reçoit des rangées et des horodatages, jamais une horloge,
 * jamais un accès réseau. Les mêmes lignes servent au CSV, au classeur et à
 * la feuille imprimée — trois compositions auraient divergé, et le papier
 * aurait fini par contredire le fichier.
 */

export interface PresenceSeat {
  readonly seat: SeatRow;
  /** Horodatage ISO de l'arrivée, ou `null` : la personne n'est pas venue. */
  readonly arrivedAt: string | null;
  /** Horodatage ISO du cadeau remis au départ. */
  readonly giftAt: string | null;
}

export interface PresenceList {
  readonly seats: readonly PresenceSeat[];
  /** Personnes pointées à l'entrée. */
  readonly arrived: number;
  /** Personnes attendues que la porte n'a jamais vues. */
  readonly missing: number;
  /** Cadeaux remis : la colonne n'a de sens que s'il y en a eu. */
  readonly gifts: number;
}

/**
 * Compose la feuille, classée par nom.
 *
 * A → Z par défaut et sans réglage : une feuille de présence se relit pour y
 * chercher quelqu'un, jamais pour suivre l'ordre d'inscription. C'est le même
 * raisonnement que le classement par défaut de la liste d'accueil.
 */
export function presenceList(
  rows: readonly GuestRow[],
  states: readonly CheckinState[],
): PresenceList {
  const byKey = new Map(states.map((state) => [seatKey(state.responseId, state.seat), state]));

  let arrived = 0;
  let gifts = 0;

  const seats = expandSeats(sortGuests(rows, 'name')).map((seat) => {
    const state = byKey.get(seat.key);
    const arrivedAt = state?.arrivedAt ?? null;
    const giftAt = state?.giftAt ?? null;
    if (arrivedAt !== null) arrived += 1;
    if (giftAt !== null) gifts += 1;
    return { seat, arrivedAt, giftAt };
  });

  return {
    seats,
    arrived,
    missing: seats.length - arrived,
    gifts,
  };
}

/** Ce qu'on lit en face d'un nom, et c'est le seul mot qui compte. */
export const PRESENCE_LABELS = {
  arrived: 'Venu(e)',
  missing: 'Non venu(e)',
} as const;

/**
 * Horodatage d'arrivée, dans le fuseau DE L'ÉVÉNEMENT.
 *
 * Le jour accompagne l'heure, sans l'année : une soirée qui se termine après
 * minuit produit des arrivées à « 23:50 » et « 00:20 », et deux colonnes
 * d'heures nues ne diraient pas lesquelles. L'année, elle, est déjà dans le
 * nom du fichier et dans l'en-tête de la feuille imprimée.
 */
export function presenceTime(at: string | null, timeZone: string): string {
  if (at === null) return '';
  const value = new Date(at);
  if (Number.isNaN(value.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(value);
}

export interface PresenceRowsOptions {
  readonly timeZone: string;
  /** Le comptage est-il désigné ? Sans lui, aucun statut annoncé à écrire. */
  readonly counting: boolean;
  /**
   * Colonne du cadeau.
   *
   * Le FICHIER la porte toujours : les colonnes d'un export dépendent du
   * sondage et jamais des réponses, sans quoi un traitement en aval change de
   * forme d'une soirée à l'autre. La feuille IMPRIMÉE la retire quand aucun
   * cadeau n'a été remis — une colonne vide y prend la place d'un nom.
   */
  readonly gifts?: boolean;
}

/** En-têtes de la feuille, dans l'ordre des colonnes. */
export function presenceHeader(options: PresenceRowsOptions): string[] {
  return [
    'Nom',
    'Précision',
    ...(options.counting ? ['Annoncé'] : []),
    'Présence',
    'Heure d’arrivée',
    ...(options.gifts === false ? [] : ['Cadeau remis']),
    'Origine',
  ];
}

/**
 * La feuille mise à plat, en-tête compris.
 *
 * Un tableau de chaînes, donc : le CSV l'échappe, le classeur l'écrit tel
 * quel, la page imprimée le rend en rangées. Une seule composition pour les
 * trois.
 */
export function presenceRows(
  list: PresenceList,
  options: PresenceRowsOptions,
): string[][] {
  const rows: string[][] = [presenceHeader(options)];

  for (const { seat, arrivedAt, giftAt } of list.seats) {
    rows.push([
      seat.name ?? 'Sans nom',
      seat.detail ?? '',
      ...(options.counting ? [ATTENDANCE_STATUS_LABELS[seat.status]] : []),
      arrivedAt === null ? PRESENCE_LABELS.missing : PRESENCE_LABELS.arrived,
      presenceTime(arrivedAt, options.timeZone),
      ...(options.gifts === false ? [] : [presenceTime(giftAt, options.timeZone)]),
      // Une personne ajoutée à la porte n'a pas d'inscription préalable : sans
      // cette mention, son statut « Sans réponse » passerait pour un oubli.
      seat.walkIn ? 'Ajouté(e) à l’entrée' : '',
    ]);
  }

  return rows;
}

/** Nom de fichier proposé, suffixé pour ne pas se confondre avec l'export. */
export const PRESENCE_SUFFIX = '-presence';
