import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from '@/lib/config/zod';
import { loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { eventWhen } from '@/lib/event/display';
import { presenceList, presenceRows } from '@/lib/export/presence';
import { deskBrand, readCheckins } from '@/lib/services/checkin';
import {
  EXPORT_LIMIT,
  getSurvey,
  listResponses,
  parseSurveySchema,
} from '@/lib/services/surveys';
import { isAttendanceConfigured } from '@/lib/survey/attendance';
import { guestList } from '@/lib/survey/guests';
import { validateSurveySettings } from '@/lib/survey/settings';

/**
 * La feuille de présence, mise en forme pour l'impression — donc pour le PDF.
 *
 * C'est le troisième format demandé, et il n'a pas demandé de dépendance :
 * « Imprimer → Enregistrer en PDF » produit, depuis cette page, un document
 * paginé, au logo de l'organisation, avec les mêmes lignes que le classeur.
 * Fabriquer le PDF côté serveur aurait exigé une bibliothèque de plus pour un
 * résultat inférieur — pagination, polices et accents compris — à ce que le
 * navigateur fait déjà d'une page écrite pour le papier.
 *
 * Elle vit dans le groupe `(impression)`, donc SANS la barre latérale de
 * l'espace de travail : une navigation masquée par une règle `@media print`
 * reste dans le document, décale la mise en page à l'écran et réapparaît si la
 * feuille de style n'arrive pas. Le groupe `(parcours)` existe pour la même
 * raison. La barrière d'accès, elle, reste celle de `/admin`.
 *
 * Elle dit la même chose que le fichier : mêmes lignes, même classement, même
 * composition (`presenceRows`). Un papier qui contredirait le tableur ouvert à
 * côté serait pire que pas de papier.
 */

export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

const PRINTED = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export default async function PresenceSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) notFound();

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session?.attached) redirect('/admin');

  const survey = await getSurvey(context, parsedId.data);
  if (!survey.ok) notFound();

  const schema = parseSurveySchema(survey.value);
  if (!schema.ok) notFound();

  const responses = await listResponses(context, parsedId.data, EXPORT_LIMIT);
  if (!responses.ok) notFound();

  const checkins = await readCheckins(context, parsedId.data);
  const settings = validateSurveySettings(survey.value.settings);
  const attendance = settings.ok ? (settings.settings.attendance ?? {}) : {};
  const counting = survey.value.kind === 'event' && isAttendanceConfigured(attendance);

  const list = guestList(schema.value, attendance, responses.value);
  const presence = presenceList(list.rows, checkins.ok ? checkins.value : []);

  // La colonne du cadeau ne s'imprime que s'il y en a eu : sur du papier, une
  // colonne vide prend la place d'un nom. Le FICHIER la porte toujours — les
  // colonnes d'un export dépendent du sondage, jamais des réponses.
  const gifts = presence.gifts > 0;
  const rows = presenceRows(presence, {
    counting,
    gifts,
    timeZone: survey.value.event_timezone,
  });
  const [header, ...body] = rows;
  const columns = header?.length ?? 1;

  const brand = await deskBrand(context, survey.value.organisation_id);
  const when = eventWhen({
    startsAt: survey.value.event_starts_at,
    endsAt: survey.value.event_ends_at,
    allDay: survey.value.event_all_day,
    timeZone: survey.value.event_timezone,
  });

  return (
    <div className="sp-print">
      <header className="sp-print__head">
        {brand?.logoUrl ? (
          // Décoratif : le nom de l'organisation est écrit juste à côté.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="sp-print__logo" decoding="async" src={brand.logoUrl} />
        ) : null}

        <div className="sp-print__title">
          {brand ? <p className="sp-print__org">{brand.name}</p> : null}
          <h1>Feuille de présence — {survey.value.title}</h1>
          {when ? <p className="sp-print__when">{when}</p> : null}
        </div>

        <dl className="sp-print__facts">
          <div>
            <dt>Venues</dt>
            <dd>{presence.arrived}</dd>
          </div>
          <div>
            <dt>Non venues</dt>
            <dd>{presence.missing}</dd>
          </div>
          <div>
            <dt>Attendues</dt>
            <dd>{presence.seats.length}</dd>
          </div>
          {gifts ? (
            <div>
              <dt>Cadeaux</dt>
              <dd>{presence.gifts}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      {/* Masqué à l'impression : ces deux phrases servent à l'écran d'où l'on
          déclenche l'impression, pas à la feuille qui en sort. */}
      <p className="sp-print__howto">
        Imprimez cette page — ou choisissez « Enregistrer au format PDF » dans
        la fenêtre d’impression. Les mêmes lignes partent en tableur depuis la
        vue « Arrivées ».{' '}
        <Link href={`/admin/sondages/${survey.value.id}/reponses?vue=arrivees`}>
          Retour aux arrivées
        </Link>
      </p>

      {body.length === 0 ? (
        <p className="sp-print__when">
          Aucune personne attendue : cette feuille se remplira avec les
          inscriptions.
        </p>
      ) : (
        <table className="sp-print__table">
          <thead>
            <tr>
              {header?.map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {presence.seats.map(({ seat }, index) => (
              <tr
                className={seat.isCompanion ? 'sp-print__row--companion' : ''}
                key={seat.key}
              >
                {/* Les cellules suivent l'ordre de `presenceRows` : la
                    feuille imprimée ne recompose rien, sinon elle finirait
                    par dire autre chose que le fichier. */}
                {(body[index] ?? []).map((cell, column) => (
                  <td
                    // Le nom porte plus que les autres colonnes : c'est lui
                    // qu'on cherche en parcourant la feuille.
                    className={column === 0 ? 'sp-print__name' : undefined}
                    key={header?.[column] ?? column}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>

          {/* Le pied appartient au TABLEAU : un groupe de pied reste dans le
              flux, donc rien ne peut recouvrir la dernière rangée d'une page.
              Fixé en bas de la feuille, il se superposait au tableau. */}
          <tfoot>
            <tr>
              <td className="sp-print__foot" colSpan={columns}>
                {brand ? `${brand.name} — ` : ''}
                {survey.value.title} · Feuille de présence éditée le{' '}
                {PRINTED.format(new Date())}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
