import { notFound } from 'next/navigation';
import { resolveRequestContext } from '@/lib/data/context';
import { loadDesk } from '@/lib/services/checkin';
import { guestList } from '@/lib/survey/guests';
import { ATTENDANCE_STATUS_LABELS, isAttendanceConfigured } from '@/lib/survey/attendance';

/**
 * La liste de secours, à imprimer la veille.
 *
 * C'est le dernier rempart du module, et le seul qui tienne quand tout le reste
 * est tombé : Vercel, Supabase, la 4G de la salle. Un stylo sur du papier ne
 * dépend de rien. Elle n'a donc aucun JavaScript, aucune interaction, et une
 * case à cocher dessinée en CSS.
 *
 * Elle se fait à l'imprimante du bureau, la veille : une liste imprimée le soir
 * même, depuis la salle, suppose exactement le réseau qu'elle est censée
 * remplacer.
 */

export const dynamic = 'force-dynamic';

const PRINTED = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export default async function CheckinPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await resolveRequestContext();

  const desk = await loadDesk(context, id);
  if (!desk.ok) notFound();

  const { survey, schema, attendance, responses } = desk.value;
  const counting = isAttendanceConfigured(attendance);
  const list = guestList(schema, attendance, responses);

  // Par ordre alphabétique : à l'entrée on cherche un NOM, pas une date
  // d'inscription. Les rangées sans nom ferment la marche plutôt que de
  // s'intercaler n'importe où.
  const rows = [...list.rows].sort((left, right) => {
    if (left.name === null) return right.name === null ? 0 : 1;
    if (right.name === null) return -1;
    return left.name.localeCompare(right.name, 'fr-FR');
  });

  return (
    <div className="sp-print">
      <header className="sp-print__head">
        <h1>{survey.title}</h1>
        <p>
          Liste de secours — {rows.length} inscription{rows.length > 1 ? 's' : ''}
          {counting ? ` · ${list.counts.attending} annoncent venir` : ''}
        </p>
        <p className="sp-print__when">Imprimée le {PRINTED.format(new Date())}</p>
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
            <th scope="col">Précision</th>
            {counting ? <th scope="col">Annoncé</th> : null}
            {counting ? <th scope="col">Statut</th> : null}
            <th scope="col">Entrés</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <span aria-hidden="true" className="sp-print__box" />
              </td>
              <td>{row.name ?? 'Sans nom'}</td>
              <td>{row.detail ?? ''}</td>
              {counting ? <td>{row.people}</td> : null}
              {counting ? <td>{ATTENDANCE_STATUS_LABELS[row.status]}</td> : null}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
