import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { Callout, Example } from '@/components/ui/Callout';
import { Field } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Steps } from '@/components/ui/Steps';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { LogoUpload } from '@/components/admin/LogoUpload';
import { loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import {
  getOrganisation,
  organisationGaps,
  organisationProgress,
} from '@/lib/services/organisation';
import { saveOrganisationProfile } from './actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Profil de l’organisation' };

const ERRORS: Readonly<Record<string, string>> = {
  name: 'Le nom doit contenir au moins deux caractères.',
  logoUrl:
    'Indiquez une adresse d’image complète commençant par https://, ou déposez un fichier.',
  logo: 'Ce logo n’appartient pas à votre organisation.',
  contactEmail: 'Cette adresse électronique n’est pas valide.',
  contactPhone: 'Ce numéro est trop long.',
  address: 'Cette adresse est trop longue.',
  enregistrement: 'L’enregistrement a été refusé.',
  saisie: 'Certaines informations doivent être corrigées.',
};

/**
 * Profil de l'organisation : ce que voient ses répondants.
 *
 * C'est l'écran de prise en main d'une organisation qui vient d'être créée.
 * Il est réservé aux administrateurs : le RLS refuse déjà l'écriture aux
 * autres, mais afficher un formulaire qui échouera à l'envoi serait une
 * promesse non tenue — un éditeur voit donc la même page en lecture.
 */
export default async function OrganisationProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session) return <Alert tone="error">{fr.errors.unexpected}</Alert>;
  if (!session.attached || !session.organisationId) redirect('/admin');

  const organisation = await getOrganisation(context, session.organisationId);
  if (!organisation.ok) return <Alert tone="error">{fr.errors.unexpected}</Alert>;

  const canEdit = session.role === 'admin' || session.role === 'super_admin';
  const gaps = organisationGaps(organisation.value);
  const progress = organisationProgress(gaps);
  const errorCode = typeof params['erreur'] === 'string' ? params['erreur'] : undefined;
  const saved = params['ok'] === '1';
  const fieldError = (field: string) => (errorCode === field ? ERRORS[field] : undefined);

  return (
    <div className="sp-rise">
      <PageHeader
        title="Profil de l’organisation"
        lead="Ces informations identifient votre organisation auprès des répondants : sur l’écran d’accueil des formulaires, dans les courriels et dans les mentions légales."
        crumbs={[{ label: 'Mon espace', href: '/admin' }]}
        meta={
          gaps.length === 0 ? (
            <span className="sp-badge sp-badge--success">Profil complet</span>
          ) : (
            <span className="sp-badge sp-badge--warning">
              {gaps.length} information{gaps.length > 1 ? 's' : ''} à compléter
            </span>
          )
        }
      />

      {saved ? <Alert tone="success">Profil enregistré.</Alert> : null}
      {errorCode ? (
        <Alert tone="error">{ERRORS[errorCode] ?? fr.errors.unexpected}</Alert>
      ) : null}

      {gaps.length > 0 ? (
        <section className="sp-section sp-stack">
          <div className="sp-progress-line">
            <Steps current={3 - gaps.length + 1} total={4} label="Profil renseigné" />
            <span className="sp-muted">{progress}&nbsp;% renseigné</span>
          </div>
          <Callout mark="!" tone="muted" title="Ce qui manque, et ce que cela coûte">
            <ul className="sp-todo">
              {gaps.map((gap) => (
                <li key={gap.key}>
                  <strong>{gap.label}</strong>
                  <span>{gap.consequence}</span>
                </li>
              ))}
            </ul>
          </Callout>
        </section>
      ) : null}

      {!canEdit ? (
        <Alert tone="info">
          Seul un administrateur de l’organisation peut modifier ce profil. Vous le voyez
          en lecture.
        </Alert>
      ) : null}

      <form action={saveOrganisationProfile} className="sp-card sp-stack">
        <fieldset className="sp-fieldset" disabled={!canEdit}>
          <legend>Identité</legend>

          <Field id="name" label="Nom de l’organisation" error={fieldError('name')} required>
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                defaultValue={organisation.value.name}
                maxLength={160}
                minLength={2}
                name="name"
                required
                type="text"
              />
            )}
          </Field>

          <div className="sp-field">
            <p className="sp-label" id="logo-intitule">
              Logo
            </p>
            <p className="sp-hint" style={{ marginBottom: 'var(--sp-space-3)' }}>
              Il remplace le nom de l’organisation sur l’écran d’accueil de vos
              formulaires.
            </p>
            <LogoUpload
              error={fieldError('logoUrl')}
              organisationId={session.organisationId}
              value={organisation.value.logo_url}
            />
          </div>
        </fieldset>

        <fieldset className="sp-fieldset" disabled={!canEdit}>
          <legend>Contact</legend>

          <Field
            id="contactEmail"
            label="Adresse de contact"
            error={fieldError('contactEmail')}
            hint="Affichée aux répondants pour toute question, et pour l’exercice de leurs droits sur leurs données."
          >
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                defaultValue={organisation.value.contact_email ?? ''}
                maxLength={200}
                name="contactEmail"
                type="email"
              />
            )}
          </Field>

          <Field id="contactPhone" label="Téléphone" error={fieldError('contactPhone')}>
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                defaultValue={organisation.value.contact_phone ?? ''}
                maxLength={40}
                name="contactPhone"
                type="tel"
              />
            )}
          </Field>

          <Field
            id="address"
            label="Adresse postale"
            error={fieldError('address')}
            hint="Elle identifie le responsable de traitement dans les mentions affichées aux répondants."
          >
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                defaultValue={organisation.value.address ?? ''}
                maxLength={300}
                name="address"
                type="text"
              />
            )}
          </Field>

          <Callout tone="muted">
            <Example>Spie batignolles, 1 rue de la Paix, 75002 Paris</Example>
          </Callout>
        </fieldset>

        {canEdit ? (
          <div className="sp-actions">
            <SubmitButton pendingLabel="Enregistrement…">Enregistrer le profil</SubmitButton>
          </div>
        ) : null}
      </form>
    </div>
  );
}
