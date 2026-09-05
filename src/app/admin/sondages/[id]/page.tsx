import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { Alert } from '@/components/ui/Alert';
import { loadAdminSession } from '@/lib/admin/session';
import { publicEnv } from '@/lib/config/env';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { getSurvey, parseSurveySchema } from '@/lib/services/surveys';
import { validateSurveySettings } from '@/lib/survey/settings';
import type { SurveyDraft } from '@/components/admin/SurveyBuilder';
import { deleteSurveyAction } from '../actions';
import { SurveyEditorClient } from './SurveyEditorClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Éditeur de formulaire' };

const idSchema = z.string().uuid();

/**
 * Éditeur d'un formulaire.
 *
 * Le RLS décide de tout : un identifiant d'une autre organisation ne renvoie
 * aucune ligne, donc 404 — un 403 confirmerait l'existence du formulaire.
 */
export default async function SurveyEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) notFound();

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session) return <Alert tone="error">{fr.errors.unexpected}</Alert>;
  if (!session.attached) redirect('/admin');

  const survey = await getSurvey(context, parsedId.data);
  if (!survey.ok) notFound();

  const schema = parseSurveySchema(survey.value);
  const settings = validateSurveySettings(survey.value.settings);

  if (!schema.ok || !settings.ok) {
    // Un schéma illisible en base est une anomalie, pas une saisie de
    // l'utilisateur : l'éditeur refuse d'ouvrir plutôt que d'écraser au
    // premier enregistrement ce qu'il n'a pas su lire.
    return (
      <div className="sp-stack">
        <h1>{survey.value.title}</h1>
        <Alert tone="error" title="Ce formulaire ne peut pas être ouvert">
          Son contenu enregistré n’est pas lisible par l’éditeur. Contactez l’administrateur
          de la plateforme : l’ouvrir risquerait d’écraser des questions existantes.
        </Alert>
        <p>
          <Link className="sp-btn sp-btn--outline sp-btn--sm" href="/admin/sondages">
            Retour aux formulaires
          </Link>
        </p>
      </div>
    );
  }

  const siteUrl = publicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const publicUrl = `${siteUrl}/s/${session.organisationSlug}/${survey.value.slug}`;

  const initial: SurveyDraft = {
    title: survey.value.title,
    slug: survey.value.slug,
    description: survey.value.description,
    status: survey.value.status,
    schema: schema.value,
    settings: settings.settings,
    purpose: survey.value.purpose,
    legalBasis: survey.value.legal_basis,
    retentionDays: survey.value.retention_days,
    recipients: survey.value.recipients,
    requireConsent: survey.value.require_consent,
    dedupField: survey.value.dedup_field,
  };

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
      <div className="sp-page-header">
        <div>
          <p className="sp-meta">
            <Link href="/admin/sondages">Formulaires</Link>
          </p>
          <h1>{survey.value.title}</h1>
          <p className="sp-meta">
            <span className="sp-badge">{fr.admin.surveyStatus[survey.value.status]}</span>{' '}
            <span className="sp-badge sp-badge--accent">
              {fr.admin.surveyKind[survey.value.kind]}
            </span>
          </p>
        </div>
      </div>

      <SurveyEditorClient
        surveyId={survey.value.id}
        initial={initial}
        publicUrl={publicUrl}
      />

      <section className="sp-card sp-stack">
        <h2 className="sp-card__title">Supprimer ce formulaire</h2>
        <p className="sp-muted">
          Le formulaire disparaît de l’espace d’administration et cesse d’accepter des
          réponses. Les réponses déjà reçues restent en base jusqu’à la purge prévue par la
          durée de conservation.
        </p>
        {/* Confirmation par « details » : elle fonctionne sans JavaScript et se
            parcourt au clavier, contrairement à une boîte de dialogue native. */}
        <details>
          <summary className="sp-btn sp-btn--outline sp-btn--sm">Supprimer…</summary>
          <form action={deleteSurveyAction} style={{ marginTop: '1rem' }}>
            <input name="surveyId" type="hidden" value={survey.value.id} />
            <button className="sp-btn sp-btn--danger sp-btn--sm" type="submit">
              Confirmer la suppression de « {survey.value.title} »
            </button>
          </form>
        </details>
      </section>
    </div>
  );
}
