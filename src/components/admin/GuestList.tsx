import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  GUEST_PAGE,
  GUEST_MAX,
  statisticsUrl,
  type StatisticsView,
} from '@/lib/admin/statistics-view';
import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus } from '@/lib/survey/attendance';
import {
  GUEST_FILTERS,
  GUEST_FILTER_KEYS,
  GUEST_FILTER_LABELS,
  type GuestList as GuestListModel,
  type GuestRow,
} from '@/lib/survey/guests';

/**
 * Liste d'accueil : une rangée par réponse, lisible d'un coup d'œil à l'entrée.
 *
 * Ce n'est pas un tableau réduit, c'est un autre objet. À l'accueil d'un
 * événement on cherche UN nom, on lit UN statut et UN effectif ; les douze
 * colonnes du tableau complet — qui existe toujours dans l'export — feraient
 * défiler l'écran horizontalement pour trouver ces trois informations.
 *
 * Recherche et filtres passent par l'URL : la liste se partage, se recharge, et
 * fonctionne sans JavaScript. Le formulaire est un `<form method="get">`, les
 * puces sont des liens.
 */

const STATUS_PILL: Readonly<Record<AttendanceStatus, string>> = {
  attending: 'sp-pill sp-pill--attend',
  declined: 'sp-pill sp-pill--decline',
  unknown: 'sp-pill sp-pill--pending',
};

const MOMENT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

function moment(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : MOMENT.format(date);
}

export interface GuestListProps {
  surveyId: string;
  view: StatisticsView;
  list: GuestListModel;
  /** Rangées effectivement affichées, déjà tronquées à `view.shown`. */
  rows: readonly GuestRow[];
  /** Le comptage est-il configuré ? Sans lui, ni statut ni effectif. */
  counting: boolean;
  /** Une question nomme-t-elle l'invité ? Sinon, la date titre la rangée. */
  named: boolean;
  settingsHref: string;
  /**
   * Action de suppression de la SÉLECTION. Omise, la liste n'offre aucune
   * suppression : c'est le cas de l'atelier de design, qui montre la mise en
   * forme sans donner prise à une action destructrice sur des données de
   * démonstration.
   */
  deleteSelectionAction?: (formData: FormData) => void | Promise<void>;
}

/**
 * Enveloppe la liste d'un `<form>` UNIQUEMENT quand il y a une action.
 *
 * Un `<form>` sans action renverrait la page sur elle-même à la moindre touche
 * « Entrée », et l'atelier de design n'a pas d'action à offrir.
 */
function FormOrPlain({
  action,
  children,
}: {
  action?: (formData: FormData) => void | Promise<void>;
  children: React.ReactNode;
}) {
  if (!action) return <>{children}</>;
  return <form action={action}>{children}</form>;
}

export function GuestList({
  surveyId,
  view,
  list,
  rows,
  counting,
  named,
  settingsHref,
  deleteSelectionAction,
}: GuestListProps) {
  const path = `/admin/sondages/${surveyId}/reponses`;
  const more = list.rows.length > rows.length;

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': 'var(--sp-space-4)' } as React.CSSProperties}>
      <form action={path} className="sp-search" method="get" role="search">
        <input name="onglet" type="hidden" value="invites" />
        {view.filter !== 'all' ? (
          <input name="filtre" type="hidden" value={GUEST_FILTER_KEYS[view.filter]} />
        ) : null}
        <label className="sp-visually-hidden" htmlFor="sp-guest-search">
          Rechercher dans les réponses
        </label>
        <input
          className="sp-input"
          defaultValue={view.search}
          id="sp-guest-search"
          maxLength={80}
          name="q"
          placeholder="Rechercher un nom, une société, une adresse…"
          type="search"
        />
        <button className="sp-btn sp-btn--outline" type="submit">
          Rechercher
        </button>
        {view.search ? (
          <Link className="sp-btn sp-btn--ghost" href={statisticsUrl(surveyId, { tab: 'invites', filter: view.filter })}>
            Effacer
          </Link>
        ) : null}
      </form>

      {counting ? (
        <nav aria-label="Filtrer par présence" className="sp-chips">
          {GUEST_FILTERS.map((filter) => (
            <Link
              aria-current={filter === view.filter ? 'true' : undefined}
              className="sp-chip"
              href={statisticsUrl(surveyId, {
                tab: 'invites',
                filter,
                search: view.search,
              })}
              key={filter}
            >
              {GUEST_FILTER_LABELS[filter]}
              <span className="sp-chip__count">{list.counts[filter]}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      {!named ? (
        <p className="sp-hint">
          Aucune question n’a été désignée comme portant le nom de l’invité : les
          rangées sont donc titrées par leur horodatage.{' '}
          <Link href={settingsHref}>Désigner la question du nom</Link>.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          lead={
            view.search
              ? `Aucune réponse ne contient « ${view.search} ». Essayez un terme plus court, ou effacez la recherche.`
              : 'Aucune réponse ne correspond à ce filtre.'
          }
          title="Rien à afficher"
        />
      ) : (
        /* La liste est un FORMULAIRE quand la suppression est offerte : les
           cases à cocher y sont, et le bouton juste après. Il ne peut pas
           envelopper la recherche — deux formulaires imbriqués sont interdits,
           et c'est aussi pourquoi la suppression par rangée a disparu : son
           propre `<form>` se serait retrouvé dans celui-ci. */
        <FormOrPlain action={deleteSelectionAction}>
        <ul className="sp-guests">
          {rows.map((row) => (
            <li className={`sp-guest${row.ambiguous ? ' sp-guest--check' : ''}`} key={row.id}>
              {deleteSelectionAction ? (
                /* Toutes les cases portent le MÊME nom : le navigateur envoie
                   la sélection entière, sans une ligne de JavaScript. Le nom
                   accessible désigne l'invité — « case à cocher » répété
                   trente fois ne dirait rien à qui n'a pas la rangée sous les
                   yeux. */
                <input
                  aria-label={`Sélectionner la réponse ${
                    row.name ? `de ${row.name}` : `du ${moment(row.submittedAt)}`
                  }`}
                  className="sp-guest__pick"
                  name="responseId"
                  type="checkbox"
                  value={row.id}
                />
              ) : null}
              <span aria-hidden="true" className="sp-guest__avatar">
                {row.initials || '·'}
              </span>
              <span className="sp-guest__main">
                <span className="sp-guest__name">
                  {row.name ?? `Réponse du ${moment(row.submittedAt)}`}
                </span>
                <span className="sp-guest__meta">
                  {[
                    row.detail,
                    counting && row.people > 0
                      ? `${row.people} personne${row.people > 1 ? 's' : ''}`
                      : null,
                    row.name ? moment(row.submittedAt) : null,
                  ]
                    .filter((part): part is string => Boolean(part))
                    .join(' · ')}
                </span>
              </span>
              <span className="sp-guest__side">
                {/* Corriger AVANT supprimer : une réponse fausse se répare
                    plus souvent qu'elle ne s'efface. */}
                <Link
                  className="sp-btn sp-btn--ghost sp-btn--sm"
                  href={`/admin/sondages/${surveyId}/reponses/${row.id}`}
                >
                  <span aria-hidden="true">Modifier</span>
                  <span className="sp-visually-hidden">
                    Modifier la réponse{' '}
                    {row.name ? `de ${row.name}` : `du ${moment(row.submittedAt)}`}
                  </span>
                </Link>
                {counting ? (
                  <span className={STATUS_PILL[row.status]}>
                    {ATTENDANCE_STATUS_LABELS[row.status]}
                  </span>
                ) : null}
                {row.ambiguous ? (
                  <span className="sp-badge sp-badge--warning">à vérifier</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        {deleteSelectionAction ? (
          <p className="sp-guests__bulk">
            <input name="surveyId" type="hidden" value={surveyId} />
            <button className="sp-btn sp-btn--outline sp-btn--danger-text" type="submit">
              Supprimer la sélection
            </button>
            <span className="sp-hint">
              Suppression logique : les réponses sortent aussitôt des listes, des
              comptages et des exports, et la purge définitive n’intervient
              qu’après le délai de conservation. Rien n’est sélectionné par
              défaut.
            </span>
          </p>
        ) : null}
        </FormOrPlain>
      )}

      {more ? (
        <p className="sp-more">
          <Link
            className="sp-btn sp-btn--ghost"
            href={statisticsUrl(surveyId, {
              tab: 'invites',
              filter: view.filter,
              search: view.search,
              shown: Math.min(view.shown + GUEST_PAGE, GUEST_MAX),
            })}
          >
            Afficher {Math.min(GUEST_PAGE, list.rows.length - rows.length)} réponses de
            plus
          </Link>
          <span className="sp-muted">
            {rows.length} sur {list.rows.length} affichées
            {list.rows.length >= GUEST_MAX
              ? ` — au-delà de ${GUEST_MAX}, l’export prend le relais.`
              : ''}
          </span>
        </p>
      ) : null}
    </div>
  );
}
