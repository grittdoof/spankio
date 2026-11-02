import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { listAssignments } from '@/lib/services/checkin';
import { listSurveys } from '@/lib/services/surveys';
import { openDeskAction } from './actions';

/**
 * « Pointage » — l'entrée directe de l'organisateur vers la porte.
 *
 * Le poste d'accueil (`/accueil`) est fait pour une personne engagée une
 * soirée : il ne liste que SES affectations, et redirige quand il n'y en a
 * qu'une. L'organisateur, lui, n'est pas affecté à ses propres événements —
 * il administre, il ne tient pas la porte. Cliquer « Pointage » l'envoyait
 * donc sur un écran vide, ce qui est exactement ce que ce projet évite
 * partout ailleurs.
 *
 * D'où cet écran : il liste les ÉVÉNEMENTS de l'organisation et ouvre le
 * poste. Quand l'organisateur est déjà affecté à un seul d'entre eux, il n'y
 * a rien à choisir et on l'y envoie directement — même raisonnement que le
 * sélecteur du poste.
 *
 * L'ouverture passe par une affectation réelle, écrite sous RLS. Rien n'est
 * contourné : la règle du module reste « l'affectation ouvre », et le journal
 * des arrivées dira que c'est l'organisateur qui pointait.
 */

export const dynamic = 'force-dynamic';

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

  const events = surveys.ok
    ? surveys.value.filter((survey) => survey.kind === 'event')
    : [];
  const staffed = new Set(
    assignments.ok ? assignments.value.map((assignment) => assignment.surveyId) : [],
  );

  // Rien à choisir : on va droit au poste, comme le sélecteur de l'accueil.
  const mine = events.filter((event) => staffed.has(event.id));
  if (mine.length === 1) redirect(`/accueil/${mine[0]!.id}`);

  return (
    <div className="sp-stack">
      <PageHeader
        title="Pointage"
        lead="Ouvrir le poste d’accueil d’un de vos événements, et pointer les arrivées."
      />

      {query['erreur'] ? (
        <Alert tone="error">
          Le poste n’a pas pu s’ouvrir. Vérifiez que le module Accueil est
          autorisé pour votre organisation.
        </Alert>
      ) : null}

      {!granted ? (
        <Alert tone="info">
          Le module Accueil n’est pas autorisé pour votre organisation. Seule la
          plateforme peut le concéder — les écrans ci-dessous resteront sans
          effet tant que ce n’est pas fait.
        </Alert>
      ) : null}

      {events.length === 0 ? (
        <EmptyState
          lead="Le pointage s’applique aux formulaires de type événement. Créez-en un, ou ouvrez un événement existant pour préparer sa porte."
          title="Aucun événement"
        />
      ) : (
        <ul className="sp-desk__picker">
          {events.map((event) => (
            <li key={event.id}>
              <span className="sp-desk__picker-title">{event.title}</span>
              {staffed.has(event.id) ? (
                <Link className="sp-btn sp-btn--primary" href={`/accueil/${event.id}`}>
                  Ouvrir le poste
                </Link>
              ) : (
                <form action={openDeskAction}>
                  <input name="surveyId" type="hidden" value={event.id} />
                  <button className="sp-btn sp-btn--outline" type="submit">
                    M’affecter et ouvrir le poste
                  </button>
                </form>
              )}
              <Link
                className="sp-btn sp-btn--ghost sp-btn--sm"
                href={`/admin/sondages/${event.id}/accueil`}
              >
                Préparer
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
