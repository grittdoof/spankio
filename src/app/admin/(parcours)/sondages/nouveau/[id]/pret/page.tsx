import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { WizardShell } from '@/components/admin/WizardShell';
import { Callout } from '@/components/ui/Callout';
import { previousCreationUrl } from '@/lib/admin/wizard';
import { resolveRequestContext } from '@/lib/data/context';
import { getSurvey } from '@/lib/services/surveys';
import { legalBasisGuide } from '@/lib/survey/consent';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Formulaire créé' };

const idSchema = z.string().uuid();

function durationLabel(days: number | null): string {
  if (days === null) return 'Non renseignée';
  if (days % 365 === 0) {
    const years = days / 365;
    return `${years} an${years > 1 ? 's' : ''} (${days} jours)`;
  }
  return `${days} jours`;
}

/**
 * Cinquième écran : récapitulatif et suite à donner.
 *
 * Un parcours qui s'arrête sur « Enregistré » laisse l'utilisateur chercher ce
 * qu'il doit faire ensuite. Cet écran récapitule ce qui a été décidé, dit ce
 * qui manque encore pour publier, et propose une seule action évidente.
 */
export default async function ReadyStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) notFound();

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const survey = await getSurvey(context, parsedId.data);
  if (!survey.ok) notFound();

  const isEvent = survey.value.kind === 'event';
  const nextHref = isEvent
    ? `/admin/sondages/${survey.value.id}/evenement`
    : `/admin/sondages/${survey.value.id}`;
  const nextLabel = isEvent ? 'Renseigner date et lieu' : 'Ajouter les questions';

  return (
    <WizardShell
      step="pret"
      question="C’est créé."
      lead={`« ${survey.value.title} » existe en brouillon : il n’accepte aucune réponse tant que vous ne l’avez pas publié.`}
      backHref={previousCreationUrl(
        'pret',
        { kind: survey.value.kind, templateKey: null },
        survey.value.id,
      )}
      exitHref="/admin/sondages"
      exitLabel="Voir mes formulaires"
      footer={
        <Link className="sp-btn sp-btn--lg" href={nextHref}>
          {nextLabel}
        </Link>
      }
    >
      <div className="sp-card">
        <dl className="sp-recap">
          <div>
            <dt>Titre</dt>
            <dd>{survey.value.title}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{isEvent ? 'Inscription à un événement' : 'Sondage'}</dd>
          </div>
          <div>
            <dt>Adresse publique</dt>
            <dd>…/{survey.value.slug}</dd>
          </div>
          <div>
            <dt>Finalité</dt>
            <dd>{survey.value.purpose ?? 'Non renseignée'}</dd>
          </div>
          <div>
            <dt>Base légale</dt>
            <dd>
              {survey.value.legal_basis
                ? (legalBasisGuide(survey.value.legal_basis)?.choice ??
                  survey.value.legal_basis)
                : 'Non renseignée'}
            </dd>
          </div>
          <div>
            <dt>Conservation</dt>
            <dd>{durationLabel(survey.value.retention_days)}</dd>
          </div>
        </dl>
      </div>

      <Callout title="Ce qu’il reste à faire pour publier">
        {isEvent
          ? 'Renseigner la date de l’événement, puis ajouter au moins une question. Le bouton « Publier » se trouve dans l’éditeur.'
          : 'Ajouter au moins une question. Le bouton « Publier » se trouve dans l’éditeur, en bas de l’écran.'}
      </Callout>
    </WizardShell>
  );
}
