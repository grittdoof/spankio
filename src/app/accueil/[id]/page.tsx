import { notFound } from 'next/navigation';
import { Desk } from '@/components/checkin/Desk';
import { resolveRequestContext } from '@/lib/data/context';
import { loadDesk, touchStaff } from '@/lib/services/checkin';
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const rehearsal = query['essai'] === '1';
  const context = await resolveRequestContext();

  const desk = await loadDesk(context, id);
  if (!desk.ok) notFound();

  /*
   * « Cette personne a ouvert son poste », écrit au RENDU et donc sans
   * JavaScript. C'est ce que l'écran de préparation montre la veille, et
   * c'est exactement le bon signal : ouvrir cette page PROUVE que le compte
   * fonctionne, ce qu'aucune autre mesure ne dit.
   *
   * Même en répétition — c'est même là que cela sert le plus, puisque l'essai
   * à blanc existe pour que cette preuve soit faite avant le soir.
   */
  await touchStaff(context, id);

  const { survey, schema, attendance, responses, states } = desk.value;
  const list = guestList(schema, attendance, responses);

  return (
    <Desk
      counting={isAttendanceConfigured(attendance)}
      guests={list.rows}
      initialStates={states}
      printHref={`/accueil/${id}/impression`}
      rehearsal={rehearsal}
      surveyId={id}
      title={survey.title}
    />
  );
}
