import type { AttendanceSettings } from '@/lib/survey/attendance';

/**
 * Ce qui manque pour tenir la porte — dit la VEILLE, pas à 19 h 50.
 *
 * Même raison d'être que `missingForPublication` : « ça n'a pas marché » ne
 * dit rien une fois la file formée. La différence est qu'ici tout n'est pas
 * bloquant, et c'est le point. Une organisation peut parfaitement tenir sa
 * porte sans avoir désigné la question du nom — la liste sera simplement
 * titrée par des horodatages, ce qui est pénible mais pas fatal. Confondre
 * « impossible » et « pénible » ferait l'un de deux défauts : refuser une
 * soirée qui aurait eu lieu, ou laisser passer en silence ce qui la gâchera.
 *
 * D'où trois états et jamais deux.
 */

export type ReadinessState =
  /** La soirée ne peut pas se tenir dans l'application. */
  | 'blocked'
  /** Elle se tiendra, en moins bien, et on peut encore corriger. */
  | 'degraded'
  | 'ok';

export interface ReadinessItem {
  readonly key:
    | 'module'
    | 'staff'
    | 'signedIn'
    | 'expiry'
    | 'identity'
    | 'presence'
    | 'responses';
  readonly state: ReadinessState;
  /** Le fait, au présent. Jamais un impératif. */
  readonly label: string;
  /** Ce que cela coûtera le soir même, quand ce n'est pas « ok ». */
  readonly consequence: string | null;
}

export interface StaffMember {
  readonly profileId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly expiresAt: string | null;
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
}

export interface ReadinessInput {
  readonly moduleGranted: boolean;
  readonly staff: readonly StaffMember[];
  readonly attendance: AttendanceSettings;
  readonly responses: number;
  /** Début de l'événement, pour juger les expirations. `null` : non renseigné. */
  readonly startsAt: string | null;
}

function plural(count: number, one: string, many: string): string {
  return count > 1 ? many : one;
}

/**
 * La liste entière, toujours — y compris les lignes satisfaites.
 *
 * Un écran qui ne montrerait que les manques laisserait croire, une fois
 * vide, qu'il n'a rien vérifié. Voir les sept lignes au vert est précisément
 * ce qu'on vient chercher la veille.
 */
export function checkinReadiness(input: ReadinessInput): readonly ReadinessItem[] {
  const items: ReadinessItem[] = [];

  items.push(
    input.moduleGranted
      ? {
          key: 'module',
          state: 'ok',
          label: 'Le module Accueil est autorisé pour votre organisation.',
          consequence: null,
        }
      : {
          key: 'module',
          state: 'blocked',
          label: 'Le module Accueil n’est pas autorisé pour votre organisation.',
          consequence:
            'Personne ne pourra ouvrir de poste : l’écran restera vide même pour une personne affectée. L’autorisation est accordée par l’administrateur de la plateforme.',
        },
  );

  const count = input.staff.length;
  items.push(
    count > 0
      ? {
          key: 'staff',
          state: 'ok',
          label: `${count} ${plural(count, 'personne affectée', 'personnes affectées')} à l’accueil.`,
          consequence: null,
        }
      : {
          key: 'staff',
          state: 'blocked',
          label: 'Personne n’est affecté à l’accueil.',
          consequence:
            'Aucun poste ne peut être ouvert. Le pointage se fera sur papier, et le rapport de la soirée sera incomplet.',
        },
  );

  const never = input.staff.filter((member) => member.firstSeenAt === null);
  if (count > 0) {
    items.push(
      never.length === 0
        ? {
            key: 'signedIn',
            state: 'ok',
            label: 'Toutes les personnes affectées ont déjà ouvert leur poste.',
            consequence: null,
          }
        : {
            key: 'signedIn',
            state: 'degraded',
            label: `${never.length} ${plural(
              never.length,
              'personne affectée ne s’est jamais connectée',
              'personnes affectées ne se sont jamais connectées',
            )}.`,
            consequence:
              'C’est la panne la plus fréquente, et elle se découvre sur le parvis : un mot de passe oublié se réinitialise mal en 4G, sous la pluie, à 19 h 50. Un essai à blanc la veille la supprime.',
          },
    );
  }

  // Une affectation qui expire AVANT la fin de la soirée est pire que pas
  // d'affectation du tout : elle marche à l'accueil, puis cesse de marcher au
  // milieu du service, sans prévenir.
  if (count > 0 && input.startsAt) {
    const start = new Date(input.startsAt);
    const early = Number.isNaN(start.getTime())
      ? []
      : input.staff.filter(
          (member) => member.expiresAt !== null && new Date(member.expiresAt) <= start,
        );
    items.push(
      early.length === 0
        ? {
            key: 'expiry',
            state: 'ok',
            label: 'Aucune affectation n’expire avant l’événement.',
            consequence: null,
          }
        : {
            key: 'expiry',
            state: 'blocked',
            label: `${early.length} ${plural(
              early.length,
              'affectation expire',
              'affectations expirent',
            )} avant le début de l’événement.`,
            consequence:
              'Le poste cessera de fonctionner en plein service, sans prévenir — et la liste disparaîtra de l’écran.',
          },
    );
  }

  items.push(
    input.attendance.identityField
      ? {
          key: 'identity',
          state: 'ok',
          label: 'Une question nomme les invités dans la liste.',
          consequence: null,
        }
      : {
          key: 'identity',
          state: 'degraded',
          label: 'Aucune question n’a été désignée comme portant le nom de l’invité.',
          consequence:
            'Les rangées seront titrées par leur horodatage. Exact, mais inutilisable à une porte : on y cherche un nom.',
        },
  );

  items.push(
    input.attendance.presenceField && input.attendance.presenceValue
      ? {
          key: 'presence',
          state: 'ok',
          label: 'La question de présence est désignée.',
          consequence: null,
        }
      : {
          key: 'presence',
          state: 'degraded',
          label: 'La question de présence n’est pas désignée.',
          consequence:
            'Le poste continuera de fonctionner, mais il ne saura pas qui avait annoncé venir : plus de statut, plus d’effectif attendu, et le compteur de salle sera sans dénominateur.',
        },
  );

  items.push(
    input.responses > 0
      ? {
          key: 'responses',
          state: 'ok',
          label: `${input.responses} ${plural(
            input.responses,
            'inscription reçue',
            'inscriptions reçues',
          )}.`,
          consequence: null,
        }
      : {
          key: 'responses',
          state: 'degraded',
          label: 'Aucune inscription reçue pour le moment.',
          consequence:
            'Le poste s’ouvrira sur une liste vide. Ce n’est un problème que si les invitations sont déjà parties.',
        },
  );

  return items;
}

/** L'état d'ensemble : le pire des états rencontrés. */
export function readinessState(items: readonly ReadinessItem[]): ReadinessState {
  if (items.some((item) => item.state === 'blocked')) return 'blocked';
  if (items.some((item) => item.state === 'degraded')) return 'degraded';
  return 'ok';
}
