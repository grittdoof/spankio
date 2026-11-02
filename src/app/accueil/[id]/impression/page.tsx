import { notFound } from 'next/navigation';
import { resolveRequestContext } from '@/lib/data/context';
import { deskBrand, loadDesk } from '@/lib/services/checkin';
import { guestList } from '@/lib/survey/guests';
import { ATTENDANCE_STATUS_LABELS, isAttendanceConfigured } from '@/lib/survey/attendance';
import { parsePrintSort, printList } from '@/lib/checkin/print';
import { eventWhen } from '@/lib/event/display';

/**
 * Le listing papier, à imprimer la veille.
 *
 * C'est le dernier rempart du module, et le seul qui tienne quand tout le
 * reste est tombé : Vercel, Supabase, la 4G de la salle. Un stylo sur du
 * papier ne dépend de rien. Aucun JavaScript, aucune interaction, et une case
 * à cocher dessinée en CSS.
 *
 * Trois choses le rendent utilisable debout, et elles ont toutes été
 * demandées :
 *
 *  * **Le logo de l'organisation l'ouvre.** Une liste nominative qui circule
 *    entre plusieurs mains doit dire de qui elle vient — et le papier d'une
 *    soirée est aussi un document que l'on montre.
 *  * **Le classement se choisit AVANT.** Une liste triée autrement qu'on ne
 *    cherche est inutilisable, et on ne s'en aperçoit qu'une fois imprimée.
 *  * **La question de classement devient une COLONNE.** Classer par société
 *    sans imprimer la société donne un ordre que personne ne peut vérifier.
 */

export const dynamic = 'force-dynamic';

const PRINTED = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export default async function CheckinPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const context = await resolveRequestContext();

  const desk = await loadDesk(context, id);
  if (!desk.ok) notFound();

  const { survey, schema, attendance, responses } = desk.value;
  const counting = isAttendanceConfigured(attendance);
  const list = guestList(schema, attendance, responses);
  const brand = await deskBrand(context, survey.organisation_id);

  const raw = query['tri'];
  const sortBy = parsePrintSort(typeof raw === 'string' ? raw : undefined, schema, attendance);
  const printed = printList(schema, attendance, list.rows, responses, sortBy);

  // Mise en forme dans le fuseau DE L'ÉVÉNEMENT, par la même fonction que la
  // page publique et le courriel : trois compositions auraient divergé.
  const when = eventWhen({
    startsAt: survey.event_starts_at,
    endsAt: survey.event_ends_at,
    allDay: survey.event_all_day,
    timeZone: survey.event_timezone,
  });

  return (
    <div className="sp-print">
      <header className="sp-print__head">
        {brand?.logoUrl ? (
          // Décoratif : le nom de l'organisation est écrit juste à côté, et
          // l'entendre deux fois n'apprendrait rien.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="sp-print__logo" decoding="async" src={brand.logoUrl} />
        ) : null}

        <div className="sp-print__title">
          {brand ? <p className="sp-print__org">{brand.name}</p> : null}
          <h1>{survey.title}</h1>
          {when ? <p className="sp-print__when">{when}</p> : null}
        </div>

        <dl className="sp-print__facts">
          <div>
            <dt>Inscriptions</dt>
            <dd>{printed.rows.length}</dd>
          </div>
          {counting ? (
            <div>
              <dt>Annoncés</dt>
              <dd>{list.counts.attending}</dd>
            </div>
          ) : null}
          <div>
            <dt>Classement</dt>
            <dd>{printed.sortLabel}</dd>
          </div>
        </dl>
      </header>

      <p className="sp-print__howto">
        À n’utiliser que si l’application est inaccessible. Cochez l’arrivée,
        puis reportez les arrivées dans l’application dès qu’elle revient — sans
        quoi le rapport de la soirée sera faux.
      </p>

      <table className="sp-print__table">
        <thead>
          <tr>
            <th scope="col">Arrivé</th>
            <th scope="col">Nom</th>
            {printed.sortColumn ? <th scope="col">{printed.sortColumn}</th> : null}
            <th scope="col">Précision</th>
            {counting ? <th scope="col">Annoncé</th> : null}
            {counting ? <th scope="col">Statut</th> : null}
            <th scope="col">Entrés</th>
          </tr>
        </thead>
        <tbody>
          {printed.rows.map(({ row, sortValue }) => (
            <tr key={row.id}>
              <td>
                <span aria-hidden="true" className="sp-print__box" />
              </td>
              <td className="sp-print__name">{row.name ?? 'Sans nom'}</td>
              {printed.sortColumn ? <td>{sortValue ?? ''}</td> : null}
              <td>{row.detail ?? ''}</td>
              {counting ? <td>{row.people}</td> : null}
              {counting ? <td>{ATTENDANCE_STATUS_LABELS[row.status]}</td> : null}
              <td />
            </tr>
          ))}
        </tbody>
      </table>

      <p className="sp-print__foot">
        {brand ? `${brand.name} — ` : ''}
        {survey.title} · Imprimée le {PRINTED.format(new Date())}
      </p>
    </div>
  );
}
