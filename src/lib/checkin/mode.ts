/**
 * Le MODE du poste : ce que signifie un appui sur une rangée.
 *
 * Demande du client : à la fin de la soirée, les mêmes hôtesses remettent un
 * cadeau à la sortie, et il faut savoir qui l'a reçu. Plutôt qu'un second
 * bouton sur chaque rangée — qu'on viserait mal, debout, d'une main — tout
 * l'écran bascule : en mode « Départs », un appui enregistre le cadeau.
 *
 * Le mode vit dans l'URL (`?mode=departs`). Un poste passé à la sortie qui
 * se recharge doit y RESTER : un retour silencieux aux arrivées ferait des
 * appuis suivants des dé-pointages, sur des gens en train de partir.
 */

export type DeskMode = 'arrivals' | 'departures';

export const DESK_MODES: readonly { readonly value: DeskMode; readonly label: string }[] = [
  { value: 'arrivals', label: 'Arrivées' },
  { value: 'departures', label: 'Départs · cadeau' },
];

/** Valeur d'URL : française, comme les autres paramètres de l'application. */
const URL_VALUE: Readonly<Record<DeskMode, string | null>> = {
  arrivals: null,
  departures: 'departs',
};

/** Lecture tolérante : tout ce qui n'est pas reconnu vaut « Arrivées ». */
export function parseDeskMode(raw: string | string[] | undefined): DeskMode {
  return raw === 'departs' ? 'departures' : 'arrivals';
}

/**
 * L'adresse du poste dans ce mode, les AUTRES paramètres conservés — l'essai
 * à blanc surtout : basculer de mode ne doit pas faire pointer pour de vrai.
 */
export function deskModeHref(pathname: string, search: string, mode: DeskMode): string {
  const params = new URLSearchParams(search);
  const value = URL_VALUE[mode];
  if (value === null) params.delete('mode');
  else params.set('mode', value);
  const query = params.toString();
  return query === '' ? pathname : `${pathname}?${query}`;
}
