import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { WizardShell } from '@/components/admin/WizardShell';
import { Alert } from '@/components/ui/Alert';
import { Callout, Example } from '@/components/ui/Callout';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { Tooltip } from '@/components/ui/Tooltip';
import { previousCreationUrl } from '@/lib/admin/wizard';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { getSurvey, LEGAL_BASES } from '@/lib/services/surveys';
import { legalBasisGuide } from '@/lib/survey/consent';
import { saveInformations } from '../../actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Informations aux répondants' };

const idSchema = z.string().uuid();

const ERRORS: Readonly<Record<string, string>> = {
  purpose: 'Décrivez la finalité en une phrase au moins (dix caractères).',
  legalBasis: 'Choisissez la base légale sur laquelle repose cette collecte.',
  retentionDays: 'Indiquez une durée de conservation entre 1 et 3650 jours.',
  saisie: 'Certaines informations doivent être corrigées.',
  enregistrement: 'L’enregistrement a été refusé.',
};

/** Durées proposées. Une liste courte évite de trancher à l'aveugle. */
const DURATIONS: readonly { value: number; label: string }[] = [
  { value: 90, label: '3 mois' },
  { value: 365, label: '1 an' },
  { value: 730, label: '2 ans' },
  { value: 1095, label: '3 ans' },
  { value: 1825, label: '5 ans' },
];

/**
 * Quatrième écran : ce que les répondants doivent savoir.
 *
 * C'est l'écran qui justifie le plus l'accompagnement. Ces trois informations
 * sont exigées pour publier, et elles sont reprises telles quelles dans la
 * mention affichée avant l'envoi puis conservées avec chaque réponse comme
 * preuve. Les demander sans expliquer à quoi elles servent produirait des
 * champs remplis au hasard — c'est-à-dire une conformité de façade.
 */
export default async function InformationsStepPage({
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

  const errorCode = typeof query['erreur'] === 'string' ? query['erreur'] : undefined;
  const error = errorCode ? (ERRORS[errorCode] ?? fr.errors.unexpected) : null;
  const fieldError = (field: string) => (errorCode === field ? ERRORS[field] : undefined);

  return (
    <form action={saveInformations}>
      <input name="surveyId" type="hidden" value={survey.value.id} />
      <WizardShell
        step="informations"
        question="Qu’allez-vous dire aux répondants ?"
        lead="Ces trois informations sont affichées avant l’envoi et conservées avec chaque réponse comme preuve de ce qui a été annoncé. Elles sont obligatoires pour publier."
        backHref={previousCreationUrl(
          'informations',
          { kind: survey.value.kind, templateKey: null },
          survey.value.id,
        )}
        exitHref={`/admin/sondages/${survey.value.id}`}
        exitLabel="Terminer plus tard"
        footer={<SubmitButton pendingLabel="Enregistrement…">Continuer</SubmitButton>}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Field
          id="purpose"
          label="À quoi servent les réponses ?"
          error={fieldError('purpose')}
          hint="Une phrase, dans les mots de votre organisation. C’est la « finalité » au sens du RGPD."
          required
        >
          {(attributes) => (
            <textarea
              {...attributes}
              // `required` et `minLength` : le navigateur signale et met le
              // focus sur le champ AVANT tout aller-retour serveur. Le
              // contrôle serveur reste la seule barrière — celui-ci n'existe
              // que pour dire tout de suite lequel remplir.
              autoFocus={errorCode === 'purpose'}
              className="sp-textarea"
              defaultValue={survey.value.purpose ?? ''}
              maxLength={2000}
              minLength={10}
              name="purpose"
              required
              rows={3}
            />
          )}
        </Field>
        <Callout tone="muted">
          <Example>
            Organiser l’assemblée générale : compter les présents, prévoir les repas et
            envoyer les convocations.
          </Example>
        </Callout>

        <fieldset className="sp-fieldset">
          <legend>
            Sur quoi repose cette collecte ?{' '}
            <Tooltip label="base légale">
              Le RGPD prévoit six fondements possibles. La plateforme n’en impose aucun :
              c’est votre organisation qui sait pourquoi elle collecte.
            </Tooltip>
          </legend>
          {fieldError('legalBasis') ? (
            <span className="sp-error">{fieldError('legalBasis')}</span>
          ) : null}
          <ul className="sp-picks">
            {LEGAL_BASES.map((basis) => {
              const guide = legalBasisGuide(basis);
              if (!guide) return null;
              return (
                <li key={basis}>
                  <label className="sp-pick">
                    <input
                      autoFocus={errorCode === 'legalBasis' && basis === LEGAL_BASES[0]}
                      defaultChecked={
                        survey.value.legal_basis === basis ||
                        (survey.value.legal_basis === null && basis === 'consent')
                      }
                      name="legalBasis"
                      required
                      type="radio"
                      value={basis}
                    />
                    <span className="sp-pick__text">
                      <span className="sp-pick__name">{guide.choice}</span>
                      <span className="sp-pick__desc">{guide.when}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <Field
          id="retentionDays"
          label="Combien de temps conserver les réponses ?"
          error={fieldError('retentionDays')}
          hint="Au terme de ce délai, les réponses sont effacées automatiquement. Ce n’est pas une intention : une purge quotidienne l’applique."
          required
        >
          {(attributes) => (
            <select
              {...attributes}
              autoFocus={errorCode === 'retentionDays'}
              className="sp-select"
              defaultValue={String(survey.value.retention_days ?? 365)}
              name="retentionDays"
              required
            >
              {DURATIONS.map((duration) => (
                <option key={duration.value} value={duration.value}>
                  {duration.label} ({duration.value} jours)
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          id="recipients"
          label="Qui aura accès aux réponses ?"
          hint="Facultatif, mais utile : les répondants savent alors à qui ils s’adressent."
        >
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              defaultValue={survey.value.recipients ?? ''}
              maxLength={2000}
              name="recipients"
              type="text"
            />
          )}
        </Field>
        <Callout tone="muted">
          <Example>Le service organisateur et le secrétariat général.</Example>
        </Callout>
      </WizardShell>
    </form>
  );
}
