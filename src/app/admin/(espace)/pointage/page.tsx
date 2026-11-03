import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { listAssignments } from '@/lib/services/checkin';
import { listSurveys, type SurveySummary } from '@/lib/services/surveys';
import { eventWhen } from '@/lib/event/display';
import { openDeskAction } from './actions';

/**
 * « Pointage » — l'entrée directe de l'organisateur vers la porte.
 *
 * Première version jugée illisible par le client, et il avait raison sur les
 * deux points. Les leçons sont écrites ici parce qu'elles valent au-delà de
 * cet écran.
 *
 * **Le vocabulaire interne ne franchit pas l'écran.** « Ouvrir le poste » et
 * « M'affecter et ouvrir le poste » décrivaient la mécanique — une ligne dans
 * `checkin_staff` — et non ce que la personne vient faire. Les deux boutons
 * portent donc le MÊME libellé, « Pointer les arrivées », parce que c'est le
 * même geste vu de l'utilisateur ; que l'un crée une affectation au passage
 * ne le regarde pas. Deux libellés différents pour une même intention font
 * chercher la différence, et il n'y en a pas.
 *
 * **Une liste de titres ne suffit pas à choisir.** « 180 ans Spie
 * batignolles » et « Spie batignolles célèbre ses 180 ans… » sont deux
 * formulaires distincts : sans la date ni le nombre d'inscrits, rien ne dit
 * lequel est la vraie soirée. Chaque rangée porte donc sa date, son état et
 * son effectif, et les événements datés passent devant, le plus proche en
 * tête — c'est celui qu'on vient tenir.
 */

export const dynamic = 'force-dynamic';

const DRAFT_LABEL: Readonly<Record<string, string>> = {
  draft: 'Brouillon',
  closed: 'Clôturé',
};

/** Les événements datés d'abord, le plus proche en tête ; les autres ensuite. */
function byDate(left: SurveySummary, right: SurveySummary): number {
  if (left.event_starts_at && right.event_starts_at) {
    return left.event_starts_at.localeCompare(right.event_starts_at);
  }
  if (left.event_starts_at) return -1;
  if (right.event_starts_at) return 1;
  return right.updated_at.localeCompare(left.updated_at);
}

export default async function AdminCheckinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session?.attached) redirect('/admin');

  const granted = Boolean(session.modules.find((module) => module.key === 'checkin')?.allowed);

  const [surveys, assignments] = await Promise.all([
    listSurveys(context),
    listAssignments(context),
  ]);

  const events = (surveys.ok ? surveys.value.filter((survey) => survey.kind === 'event') : [])
    .slice()
    .sort(byDate);
  const staffed = new Set(
    assignments.ok ? assignments.value.map((assignment) => assignment.surveyId) : [],
  );

  // Rien à choisir : on va droit à la liste, comme le sélecteur de l'accueil.
  const mine = events.filter((event) => staffed.has(event.id));
  if (mine.length === 1) redirect(`/accueil/${mine[0]!.id}`);

  return (
    <div className="sp-stack">
      <PageHeader
        title="Pointage"
        lead="Choisissez l’événement dont vous tenez la porte."
      />

      {query['erreur'] ? (
        <Alert tone="error">
          Le pointage n’a pas pu démarrer. Vérifiez que le module Accueil est
          autorisé pour votre organisation.
        </Alert>
      ) : null}

      {!granted ? (
        <Alert tone="info">
          Le module Accueil n’est pas autorisé pour votre organisation. Seule la
          plateforme peut le concéder — les boutons ci-dessous resteront sans
          effet tant que ce n’est pas fait.
        </Alert>
      ) : null}

      {events.length === 0 ? (
        <EmptyState
          lead="Le pointage s’applique aux formulaires de type événement. Créez-en un, ou ouvrez un événement existant pour préparer sa porte."
          title="Aucun événement"
        />
      ) : (
        <ul className="sp-eventpick">
          {events.map((event) => {
            const when = eventWhen({
              startsAt: event.event_starts_at,
              endsAt: null,
              allDay: event.event_all_day,
              timeZone: event.event_timezone,
            });
            const state = DRAFT_LABEL[event.status];

            return (
              <li className="sp-eventpick__item" key={event.id}>
                <div className="sp-eventpick__text">
                  <span className="sp-eventpick__name">{event.title}</span>
                  <span className="sp-eventpick__meta">
                    {when ?? 'Date non renseignée'}
                    {state ? ` · ${state}` : ''}
                  </span>
                </div>

                <div className="sp-eventpick__actions">
                  {/* Le MÊME libellé des deux côtés : créer l'affectation au
                      passage est de la plomberie, pas une autre intention. */}
                  {staffed.has(event.id) ? (
                    <Link className="sp-btn sp-btn--primary" href={`/accueil/${event.id}`}>
                      Pointer les arrivées
                    </Link>
                  ) : (
                    <form action={openDeskAction}>
                      <input name="surveyId" type="hidden" value={event.id} />
                      <button className="sp-btn sp-btn--primary" type="submit">
                        Pointer les arrivées
                      </button>
                    </form>
                  )}

                  <Link
                    className="sp-btn sp-btn--ghost sp-btn--sm"
                    href={`/admin/sondages/${event.id}/accueil`}
                  >
                    Préparer
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
