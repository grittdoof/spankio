import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { Alert } from '@/components/ui/Alert';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadAdminSession } from '@/lib/admin/session';
import { statisticsUrl } from '@/lib/admin/statistics-view';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import {
  EXPORT_LIMIT,
  getSurvey,
  listResponses,
  parseSurveySchema,
} from '@/lib/services/surveys';
import { fieldById } from '@/lib/survey/attendance';
import { answerText } from '@/lib/survey/answer-text';
import { validateSurveySettings } from '@/lib/survey/settings';
import { ResponseEditorClient } from './ResponseEditorClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Corriger une réponse' };

const idSchema = z.string().uuid();

/**
 * Correction d'une réponse.
 *
 * La réponse est relue dans la LISTE du sondage plutôt que par un accès direct
 * à la table : c'est le même chemin que l'écran des statistiques, donc les
 * mêmes policies, et une réponse d'une autre organisation n'apparaît
 * simplement pas — `404`, jamais un `403` qui confirmerait son existence.
 */
export default async function CorrectResponsePage({
  params,
}: {
  params: Promise<{ id: string; responseId: string }>;
}) {
  const raw = await params;
  const parsedId = idSchema.safeParse(raw.id);
  const parsedResponseId = idSchema.safeParse(raw.responseId);
  if (!parsedId.success || !parsedResponseId.success) notFound();

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session) return <Alert tone="error">{fr.errors.unexpected}</Alert>;
  if (!session.attached) redirect('/admin');

  const survey = await getSurvey(context, parsedId.data);
  if (!survey.ok) notFound();

  const schema = parseSurveySchema(survey.value);
  if (!schema.ok) return <Alert tone="error">{fr.errors.unexpected}</Alert>;

  const responses = await listResponses(context, parsedId.data, EXPORT_LIMIT);
  if (!responses.ok) return <Alert tone="error">{fr.errors.unexpected}</Alert>;

  const response = responses.value.find((row) => row.id === parsedResponseId.data);
  if (!response) notFound();

  // Nom de l'invité, s'il a été désigné : « Corriger la réponse de Camille
  // Arnoult » se lit mieux qu'un identifiant.
  const settings = validateSurveySettings(survey.value.settings);
  const attendance = settings.ok ? (settings.settings.attendance ?? {}) : {};
  const identity = fieldById(schema.value, attendance.identityField);
  const name = identity ? answerText(identity, response.data) : null;

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
      <PageHeader
        crumbs={[
          { label: 'Formulaires', href: '/admin/sondages' },
          { label: survey.value.title, href: `/admin/sondages/${survey.value.id}` },
          {
            label: 'Statistiques',
            href: statisticsUrl(survey.value.id, { tab: 'invites' }),
          },
          { label: 'Correction' },
        ]}
        lead="Corrigez ce qui a été saisi. La version précédente est conservée, hors des comptages et des exports."
        title={name ? `Corriger la réponse de ${name}` : 'Corriger une réponse'}
      />

      <ResponseEditorClient
        initial={response.data}
        responseId={response.id}
        schema={schema.value}
        submittedAt={response.submitted_at}
        surveyId={survey.value.id}
      />
    </div>
  );
}
