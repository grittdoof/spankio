import { resolveRequestContext } from '@/lib/data/context';
import { buildIcs, icsFileName, IcsError } from '@/lib/event/ics';
import { logger } from '@/lib/logger';
import { publicEnv } from '@/lib/config/env';
import { loadPublicSurveyById } from '@/lib/services/submission';

/**
 * Fichier iCalendar d'un événement publié.
 *
 * Aucune authentification : le sondage est public, l'événement aussi. La vue
 * `public_surveys` fait le filtrage — un brouillon ou un sondage fermé n'y
 * figure pas, donc ce fichier n'existe pas non plus.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response('Introuvable', { status: 404 });
  }

  const context = await resolveRequestContext(request);
  const survey = await loadPublicSurveyById(context, id);

  if (!survey.ok || survey.value.kind !== 'event' || !survey.value.event.startsAt) {
    return new Response('Introuvable', { status: 404 });
  }

  const site = publicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const url = `${site}/s/${survey.value.organisationSlug}/${survey.value.slug}`;

  try {
    const ics = buildIcs({
      // UID stable : réimporter le fichier met à jour l'événement au lieu
      // d'en créer un second.
      uid: `${survey.value.id}@${new URL(site).host}`,
      title: survey.value.title,
      start: new Date(survey.value.event.startsAt),
      end: survey.value.event.endsAt ? new Date(survey.value.event.endsAt) : null,
      allDay: survey.value.event.allDay,
      description: survey.value.event.details ?? survey.value.description,
      location: survey.value.event.address ?? survey.value.event.locationLabel,
      organiser: {
        name: survey.value.event.organiser ?? survey.value.organisationName,
        email: survey.value.organisationContactEmail,
      },
      url,
      latitude: survey.value.event.latitude,
      longitude: survey.value.event.longitude,
    });

    return new Response(ics, {
      status: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': `attachment; filename="${icsFileName(survey.value.title)}"`,
        'cache-control': 'public, max-age=300',
      },
    });
  } catch (error) {
    if (error instanceof IcsError) {
      logger.warn('ics.invalid_event', 'Événement non exportable en iCalendar.', {
        surveyId: survey.value.id,
        reason: error.message,
      });
      return new Response('Introuvable', { status: 404 });
    }
    throw error;
  }
}
