import type { Countdown } from '@/lib/event/countdown';
import type { AttendanceTotals } from './attendance';
import { PACE_WINDOW_LABELS, type Pace } from './pace';

/**
 * « À retenir » : les quelques faits qu'un organisateur lit avant tout le reste.
 *
 * Règle unique, et elle est stricte : **un fait, jamais un conseil.** Le
 * prototype de la maquette proposait « Relancez mardi entre 17 h et 19 h » —
 * une recommandation que rien dans les données ne soutient (les réponses
 * arrivent quand les invitations partent, pas quand les invités sont
 * disponibles). Chaque énoncé ci-dessous est donc vérifiable en recomptant, et
 * n'apparaît que lorsqu'il est vrai.
 *
 * Fonction pure, sans horloge : l'appelant fournit le compte à rebours et le
 * rythme déjà calculés.
 */

export interface Insight {
  readonly key: string;
  readonly tone: 'accent' | 'success' | 'warning' | 'danger';
  readonly title: string;
  readonly note?: string;
}

export interface InsightInput {
  /** `null` quand l'organisation n'a pas désigné la question de présence. */
  readonly totals: AttendanceTotals | null;
  readonly responseCount: number;
  readonly capacity: number | null;
  readonly pace: Pace;
  readonly countdown: Countdown | null;
}

function plural(count: number, singular: string, plural_: string): string {
  return `${count} ${count > 1 ? plural_ : singular}`;
}

export function eventInsights(input: InsightInput): readonly Insight[] {
  const insights: Insight[] = [];
  const { totals, capacity, pace } = input;

  if (totals && capacity !== null) {
    const remaining = capacity - totals.people;
    if (remaining > 0) {
      insights.push({
        key: 'places',
        tone: 'accent',
        title: `${plural(remaining, 'place libre', 'places libres')} sur ${capacity}`,
        note: `Effectif attendu : ${totals.people} personne${totals.people > 1 ? 's' : ''}, accompagnants compris.`,
      });
    } else if (remaining === 0) {
      insights.push({
        key: 'places',
        tone: 'success',
        title: 'Toutes les places sont prises',
        note: `${capacity} personnes attendues pour ${capacity} places.`,
      });
    } else {
      insights.push({
        key: 'places',
        tone: 'danger',
        title: `L’effectif dépasse la capacité de ${Math.abs(remaining)}`,
        note: `${totals.people} personnes attendues pour ${capacity} places. Vérifiez la capacité saisie, ou les réponses reçues.`,
      });
    }
  }

  if (totals && totals.ambiguous > 0) {
    insights.push({
      key: 'ambigus',
      tone: 'warning',
      title: `${plural(totals.ambiguous, 'réponse à vérifier', 'réponses à vérifier')}`,
      note: `L’effectif n’a pas pu être déterminé. ${totals.ambiguous > 1 ? 'Elles comptent' : 'Elle compte'} pour une personne dans le total, et ${totals.ambiguous > 1 ? 'sont repérées' : 'est repérée'} dans la liste des invités.`,
    });
  }

  if (totals && totals.unknown > 0) {
    insights.push({
      key: 'sans-reponse',
      tone: 'warning',
      title: `${plural(totals.unknown, 'réponse sans présence indiquée', 'réponses sans présence indiquée')}`,
      note: 'La question de présence a été sautée : ces réponses ne comptent ni parmi les présents, ni parmi ceux qui déclinent.',
    });
  }

  if (pace.total === 0 && input.responseCount > 0) {
    insights.push({
      key: 'silence',
      tone: 'warning',
      title: `Aucune réponse sur ${PACE_WINDOW_LABELS[pace.window]}`,
      note: `${plural(input.responseCount, 'réponse a été enregistrée', 'réponses ont été enregistrées')} au total, toutes antérieures à cette période.`,
    });
  } else if (pace.busiest) {
    insights.push({
      key: 'pointe',
      tone: 'accent',
      title: `Pointe de ${plural(pace.busiest.count, 'réponse', 'réponses')}`,
      note: `Période la plus active des ${PACE_WINDOW_LABELS[pace.window]} : ${pace.busiest.fullLabel}.`,
    });
  }

  if (input.countdown && !input.countdown.past && input.countdown.days > 0) {
    insights.push({
      key: 'echeance',
      tone: 'accent',
      title: `${plural(input.countdown.days, 'jour avant l’événement', 'jours avant l’événement')}`,
      note: totals
        ? `${plural(totals.attending, 'réponse annonce une présence', 'réponses annoncent une présence')} à ce jour.`
        : `${plural(input.responseCount, 'réponse reçue', 'réponses reçues')} à ce jour.`,
    });
  }

  return insights;
}
