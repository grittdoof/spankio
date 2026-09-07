import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { WizardShell } from '@/components/admin/WizardShell';
import { Alert } from '@/components/ui/Alert';
import { Callout, Example } from '@/components/ui/Callout';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { previousCreationUrl } from '@/lib/admin/wizard';
import { resolveRequestContext } from '@/lib/data/context';
import { isoToWallClock } from '@/lib/event/time';
import { fr } from '@/lib/i18n/fr';
import { getSurvey } from '@/lib/services/surveys';
import { saveEventStep } from '../../actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Date et lieu' };

const idSchema = z.string().uuid();

const ERRORS: Readonly<Record<string, string>> = {
  startsAt: 'Indiquez la date et l’heure de l’événement.',
  timezone: 'Choisissez un fuseau horaire.',
  saisie: 'Certaines informations doivent être corrigées.',
  enregistrement: 'L’enregistrement a été refusé.',
};

/**
 * Quatrième écran, pour un événement seulement : quand et où.
 *
 * Il vient AVANT les mentions d'information, parce qu'un événement sans date
 * ne peut pas être publié : découvrir ce manque au récapitulatif obligerait à
 * revenir en arrière. Le fuseau est celui de l'événement — c'est dans ce
 * fuseau que l'heure est saisie, et il détermine l'instant enregistré.
 *
 * Le placement précis sur une carte reste sur l'écran complet des réglages :
 * ici on demande le minimum publiable, pas tout ce qui est réglable.
 */
export default async function EventStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) notFound();
  const query = await searchParams;

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const survey = await getSurvey(context, parsedId.data);
  if (!survey.ok) notFound();

  // Un sondage n'a ni date ni lieu : cet écran ne lui appartient pas.
  if (survey.value.kind !== 'event') {
    redirect(`/admin/sondages/nouveau/${survey.value.id}/informations`);
  }

  const zone = survey.value.event_timezone || 'Europe/Paris';
  const errorCode = typeof query['erreur'] === 'string' ? query['erreur'] : undefined;
  const error = errorCode ? (ERRORS[errorCode] ?? fr.errors.unexpected) : null;

  return (
    <form action={saveEventStep}>
      <input name="surveyId" type="hidden" value={survey.value.id} />
      <input name="timezone" type="hidden" value={zone} />
      <WizardShell
        step="evenement"
        kind="event"
        question="Quand et où ?"
        lead="La date est obligatoire pour publier : c’est elle qui alimente le fichier d’agenda et l’itinéraire proposés aux invités."
        backHref={previousCreationUrl(
          'evenement',
          { kind: 'event', templateKey: null },
          survey.value.id,
        )}
        exitHref={`/admin/sondages/${survey.value.id}`}
        exitLabel="Terminer plus tard"
        footer={<SubmitButton pendingLabel="Enregistrement…">Continuer</SubmitButton>}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Field
          id="startsAt"
          label="Date et heure de début"
          error={errorCode === 'startsAt' ? ERRORS['startsAt'] : undefined}
          hint={`Heure locale de l’événement (${zone}). Vous pourrez ajouter une heure de fin ensuite.`}
          required
        >
          {(attributes) => (
            <input
              {...attributes}
              autoFocus
              className="sp-input"
              defaultValue={isoToWallClock(survey.value.event_starts_at, zone)}
              name="startsAt"
              required
              type="datetime-local"
            />
          )}
        </Field>

        <Field
          id="locationLabel"
          label="Nom du lieu"
          hint="Il s’affiche aux invités et accompagne l’adresse dans leur agenda."
        >
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              defaultValue={survey.value.event_location_label ?? ''}
              maxLength={200}
              name="locationLabel"
              type="text"
            />
          )}
        </Field>

        <Field
          id="address"
          label="Adresse"
          hint="Elle sert à l’itinéraire. Vous pourrez ajuster le point exact sur une carte ensuite."
        >
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              defaultValue={survey.value.event_address ?? ''}
              maxLength={300}
              name="address"
              type="text"
            />
          )}
        </Field>

        <Callout tone="muted">
          <Example>Musée Jacquemart-André — 158 Bd Haussmann, 75008 Paris</Example>
        </Callout>
      </WizardShell>
    </form>
  );
}
