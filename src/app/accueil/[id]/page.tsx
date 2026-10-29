import { notFound } from 'next/navigation';
import { Desk } from '@/components/checkin/Desk';
import { resolveRequestContext } from '@/lib/data/context';
import { loadDesk } from '@/lib/services/checkin';
import { guestList } from '@/lib/survey/guests';
import { isAttendanceConfigured } from '@/lib/survey/attendance';

/**
 * Le poste de pointage.
 *
 * Le premier rendu est SERVEUR et complet : la liste entière part dans le HTML,
 * composée par `guestList` — la même fonction que la liste d'accueil de
 * l'espace d'administration, pour que l'invité s'appelle pareil des deux côtés.
 * Ce qui suit — le delta, la file, le pointage — est du confort posé par-dessus.
 *
 * Un sondage que le RLS masque est un `404`, jamais un `403` : un refus qui
 * confirmerait l'existence de l'événement en dirait déjà trop.
 */

export const dynamic = 'force-dynamic';

export default async function CheckinDeskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await resolveRequestContext();

  const desk = await loadDesk(context, id);
  if (!desk.ok) notFound();

  const { survey, schema, attendance, responses, states } = desk.value;
  const list = guestList(schema, attendance, responses);

  return (
    <Desk
      counting={isAttendanceConfigured(attendance)}
      guests={list.rows}
      initialStates={states}
      printHref={`/accueil/${id}/impression`}
      surveyId={id}
      title={survey.title}
    />
  );
}
