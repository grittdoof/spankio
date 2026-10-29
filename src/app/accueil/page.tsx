import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/ui/EmptyState';
import { resolveRequestContext } from '@/lib/data/context';
import { listAssignments } from '@/lib/services/checkin';

/**
 * Choix de l'événement — et, le plus souvent, aucun choix du tout.
 *
 * Une hôtesse engagée pour une soirée n'a qu'une affectation. Lui demander de
 * la désigner serait un geste pour rien, juste avant celui qui compte. On
 * redirige donc, et l'écran ne s'affiche que lorsqu'il y a vraiment à choisir.
 */

export const dynamic = 'force-dynamic';

export default async function CheckinHomePage() {
  const context = await resolveRequestContext();
  const assignments = await listAssignments(context);

  if (!assignments.ok) {
    return (
      <EmptyState
        lead="La liste de vos événements n’a pas pu être lue. Réessayez dans un instant ; si cela persiste, prévenez l’organisateur."
        title="Liste indisponible"
      />
    );
  }

  if (assignments.value.length === 1) {
    redirect(`/accueil/${assignments.value[0]!.surveyId}`);
  }

  if (assignments.value.length === 0) {
    return (
      <EmptyState
        lead="Aucun événement ne vous est affecté pour le moment. L’organisateur doit vous affecter avant la soirée — une affectation expirée disparaît aussi de cette liste."
        title="Aucun événement à tenir"
      />
    );
  }

  return (
    <div className="sp-stack">
      <h1>Quel événement tenez-vous ?</h1>
      <ul className="sp-desk__picker">
        {assignments.value.map((assignment) => (
          <li key={assignment.surveyId}>
            <Link className="sp-btn sp-btn--outline" href={`/accueil/${assignment.surveyId}`}>
              {assignment.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
