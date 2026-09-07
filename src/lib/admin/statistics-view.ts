import { GUEST_FILTER_KEYS, parseGuestFilter, type GuestFilter } from '@/lib/survey/guests';
import { parsePaceWindow, type PaceWindow } from '@/lib/survey/pace';

/**
 * État de l'écran des statistiques, et sa traduction en URL.
 *
 * L'état vit dans l'URL, comme celui du parcours de création et pour les mêmes
 * raisons : l'écran survit à un rafraîchissement, le bouton « retour » du
 * navigateur fait ce qu'on attend, un onglet se partage par son adresse — et
 * surtout, chaque onglet reste un simple lien, donc l'écran fonctionne SANS
 * JavaScript. Un composant à état aurait demandé un `'use client'` sur une page
 * qui n'a rien d'interactif.
 *
 * Seules des valeurs de listes fermées y circulent — sauf la recherche, qui est
 * par nature libre et n'est donc jamais interprétée : elle ne sert qu'à filtrer
 * des lignes déjà lues.
 */

export type StatisticsTab = 'apercu' | 'questions' | 'invites';

export const STATISTICS_TABS: readonly StatisticsTab[] = ['apercu', 'questions', 'invites'];

export const STATISTICS_TAB_LABELS: Readonly<Record<StatisticsTab, string>> = {
  apercu: "Vue d'ensemble",
  questions: 'Questions',
  invites: 'Invités',
};

export function parseStatisticsTab(raw: string | undefined): StatisticsTab {
  return STATISTICS_TABS.find((tab) => tab === raw) ?? 'apercu';
}

export interface StatisticsView {
  readonly tab: StatisticsTab;
  readonly period: PaceWindow;
  readonly filter: GuestFilter;
  /** Terme de recherche, déjà borné en longueur. */
  readonly search: string;
  /** Nombre de rangées demandées dans la liste. */
  readonly shown: number;
}

/** Rangées ajoutées à chaque « en voir plus ». */
export const GUEST_PAGE = 30;

/** Plafond de rangées affichables. Au-delà, l'export prend le relais. */
export const GUEST_MAX = 300;

/** Longueur maximale d'un terme de recherche : au-delà, c'est un collage. */
const SEARCH_MAX = 80;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseStatisticsView(
  query: Readonly<Record<string, string | string[] | undefined>>,
): StatisticsView {
  const rawShown = Number(first(query['lignes']));
  const shown = Number.isInteger(rawShown)
    ? Math.min(Math.max(rawShown, GUEST_PAGE), GUEST_MAX)
    : GUEST_PAGE;

  return {
    tab: parseStatisticsTab(first(query['onglet'])),
    period: parsePaceWindow(first(query['periode'])),
    filter: parseGuestFilter(first(query['filtre'])),
    search: (first(query['q']) ?? '').slice(0, SEARCH_MAX),
    shown,
  };
}

/**
 * Adresse d'une vue. Les valeurs par défaut sont OMISES : une URL qui répète
 * l'état neutre (`?onglet=apercu&periode=7j&filtre=toutes&lignes=30`) devient
 * illisible et impartageable.
 */
export function statisticsUrl(
  surveyId: string,
  view: Partial<StatisticsView>,
): string {
  const params = new URLSearchParams();
  if (view.tab && view.tab !== 'apercu') params.set('onglet', view.tab);
  if (view.period && view.period !== '7j') params.set('periode', view.period);
  if (view.filter && view.filter !== 'all') {
    params.set('filtre', GUEST_FILTER_KEYS[view.filter]);
  }
  if (view.search) params.set('q', view.search);
  if (view.shown && view.shown !== GUEST_PAGE) params.set('lignes', String(view.shown));

  const query = params.toString();
  return `/admin/sondages/${surveyId}/reponses${query ? `?${query}` : ''}`;
}
