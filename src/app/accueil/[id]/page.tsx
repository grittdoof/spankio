import { redirect } from 'next/navigation';
import { Desk } from '@/components/checkin/Desk';
import { DeskDenied } from '@/components/checkin/DeskDenied';
import { signInLabel, staffIdentifierHost } from '@/lib/checkin/account';
import { publicEnv } from '@/lib/config/env';
import { resolveRequestContext } from '@/lib/data/context';
import { deskBrand, loadDesk, touchStaff } from '@/lib/services/checkin';
import { deskRows, guestList } from '@/lib/survey/guests';
import { isAttendanceConfigured } from '@/lib/survey/attendance';
import { parseDeskMode } from '@/lib/checkin/mode';
import { touchedResponses } from '@/lib/checkin/reducer';
import { walkinFields } from '@/lib/checkin/walkin';

/**
 * Le poste de pointage.
 *
 * Le premier rendu est SERVEUR et complet : la liste entière part dans le HTML,
 * composée par `guestList` — la même fonction que la liste d'accueil de
 * l'espace d'administration, pour que l'invité s'appelle pareil des deux côtés.
 * Ce qui suit — le delta, la file, le pointage — est du confort posé par-dessus.
 *
 * **Un refus ne confirme toujours rien, mais il se LIT.** Le poste répondait
 * `404` dès que la lecture échouait, ce qui était le bon code et le mauvais
 * écran : une hôtesse portant la session d'un compte créé pour un autre
 * événement lisait « 404 » sans savoir qu'il suffisait de se déconnecter —
 * défaut réel, signalé au premier usage. `DeskDenied` dit la même chose que le
 * code, c'est-à-dire rien de l'événement, en y ajoutant la seule information
 * utile : avec quel compte on est connecté. Sans session, on part à la
 * connexion AVEC la destination, pour revenir au poste visé et non au premier
 * venu.
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

  /*
   * Le garde du `layout` fait déjà cette redirection, et le middleware la fait
   * avant lui. Celui-ci est le troisième, et il n'est pas superflu : layout et
   * page sont rendus de FRONT, si bien qu'un `notFound()` lancé ici pouvait
   * devancer la redirection du parent. Ici le départ est décidé avant toute
   * lecture, donc il n'y a plus de course à arbitrer.
   */
  if (!context.userId) redirect(`/connexion?suite=${encodeURIComponent(`/accueil/${id}`)}`);

  const desk = await loadDesk(context, id);
  if (!desk.ok) {
    return (
      <DeskDenied
        identifier={signInLabel(
          context.email,
          staffIdentifierHost(publicEnv().NEXT_PUBLIC_SITE_URL),
        )}
      />
    );
  }

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
  // Les personnes ayant décliné sont retirées de la PORTE, pas de la base —
  // sauf si la porte a déjà enregistré quelque chose sur elles, auquel cas
  // les retirer effacerait de l'écran une personne qui est dans la salle.
  const list = guestList(schema, attendance, responses);
  const guests = deskRows(list.rows, touchedResponses(states));

  // La marque de l'organisation sur le poste : une hôtesse engagée pour une
  // soirée tient parfois deux événements dans la semaine, et l'écran doit
  // dire chez qui elle est. Un échec de lecture ne vide pas la page — le
  // poste s'ouvre sans logo plutôt que pas du tout.
  const brand = await deskBrand(context, survey.organisation_id);

  return (
    <Desk
      counting={isAttendanceConfigured(attendance)}
      guests={guests}
      initialMode={parseDeskMode(query['mode'])}
      initialStates={states}
      logoUrl={brand?.logoUrl ?? null}
      organisationName={brand?.name ?? null}
      printHref={`/accueil/${id}/impression`}
      rehearsal={rehearsal}
      surveyId={id}
      title={survey.title}
      walkinFields={walkinFields(schema, attendance)}
    />
  );
}
