import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { PageHeader } from '@/components/ui/PageHeader';
import { CheckinReadiness } from '@/components/admin/CheckinReadiness';
import { CheckinInvitations } from '@/components/admin/CheckinInvitations';
import { CheckinStaff } from '@/components/admin/CheckinStaff';
import { loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { checkinReadiness } from '@/lib/checkin/readiness';
import { listAssignableMembers, listInvitations, listStaff } from '@/lib/services/checkin';
import { getSurvey, listResponses } from '@/lib/services/surveys';
import { surveySettingsSchema } from '@/lib/survey/settings';
import {
  assignStaffAction,
  inviteStaffAction,
  revokeInvitationAction,
  revokeStaffAction,
} from './actions';

/**
 * Préparer la porte — la veille, pas à 19 h 50.
 *
 * Cet écran existe parce que le plus gros risque du module n'est pas
 * technique : c'est l'hôtesse qui découvre sur le parvis que son compte ne
 * marche pas. Il rend donc visible, pendant qu'on peut encore agir, ce qui ne
 * se verrait autrement qu'une fois la file formée.
 */

export const dynamic = 'force-dynamic';

const MESSAGES: Readonly<Record<string, string>> = {
  personne: 'Choisissez la personne à affecter.',
  date: 'La date de fin n’a pas été comprise. Utilisez le sélecteur de date.',
  organisation:
    'Cette personne n’appartient pas à l’organisation du formulaire. L’affectation a été refusée par la base, et c’est voulu.',
  refus:
    'L’affectation a été refusée. Vérifiez que le module Accueil est autorisé pour votre organisation.',
  adresse: 'Cette adresse électronique n’a pas été comprise.',
};

const FAITS: Readonly<Record<string, string>> = {
  affectation: 'Affectation enregistrée.',
  retrait: 'Affectation retirée.',
  invitation: 'Invitation envoyée.',
  'invitation-retiree': 'Invitation retirée.',
};

/**
 * Un envoi raté n'est PAS un simple « pour information » ici : le lien
 * n'existe nulle part en clair, donc l'invitation ne sert à rien tant qu'elle
 * n'est pas refaite. C'est donc une alerte, pas une confirmation.
 */
const ENVOI_RATE =
  'invitation-sans-courriel';

export default async function CheckinPreparationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const survey = await getSurvey(context, id);
  if (!survey.ok) notFound();

  // Le module ACCUEIL, jamais celui du sondage : tenir une porte n'est pas
  // éditer un événement.
  const session = await loadAdminSession(context, context.userId);
  const moduleGranted = Boolean(
    session?.modules.find((module) => module.key === 'checkin')?.allowed,
  );

  const [staff, members, responses, invitations] = await Promise.all([
    listStaff(context, id),
    listAssignableMembers(context),
    listResponses(context, id, 1000),
    listInvitations(context, id),
  ]);
  if (!staff.ok || !members.ok || !responses.ok || !invitations.ok) notFound();

  const parsed = surveySettingsSchema.safeParse(survey.value.settings ?? {});
  const attendance = parsed.success ? (parsed.data.attendance ?? {}) : {};

  const readiness = checkinReadiness({
    moduleGranted,
    staff: staff.value,
    attendance,
    responses: responses.value.length,
    startsAt: survey.value.event_starts_at ?? null,
  });

  const erreur =
    query['fait'] === ENVOI_RATE
      ? 'L’invitation a été créée mais le courriel n’est pas parti. Le lien n’existe nulle part en clair : retirez l’invitation et recommencez.'
      : typeof query['erreur'] === 'string'
        ? MESSAGES[query['erreur']]
        : undefined;
  const fait = typeof query['fait'] === 'string' ? FAITS[query['fait']] : undefined;

  const assigned = new Set(staff.value.map((member) => member.profileId));
  const assignable = members.value.filter((member) => !assigned.has(member.profileId));

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
      <PageHeader
        title="Accueil et pointage"
        lead="Qui tient la porte, qui s’est déjà connecté, et ce qui manque encore."
        crumbs={[
          { label: survey.value.title, href: `/admin/sondages/${id}` },
          { label: 'Accueil' },
        ]}
        actions={
          <>
            <Link className="sp-btn sp-btn--outline" href={`/accueil/${id}?essai=1`}>
              Essai à blanc
            </Link>
            <Link className="sp-btn sp-btn--outline" href={`/accueil/${id}/impression`}>
              Liste de secours
            </Link>
          </>
        }
      />

      {/* Une seule zone d'annonce : jamais les deux à la fois. */}
      {erreur ? <Alert tone="error">{erreur}</Alert> : fait ? <Alert tone="success">{fait}</Alert> : null}

      <CheckinReadiness items={readiness} settingsHref={`/admin/sondages/${id}/evenement`} />

      <CheckinStaff
        assignAction={assignStaffAction}
        assignable={assignable}
        revokeAction={revokeStaffAction}
        staff={staff.value}
        surveyId={id}
      />

      <CheckinInvitations
        invitations={invitations.value}
        inviteAction={inviteStaffAction}
        now={new Date().toISOString()}
        revokeAction={revokeInvitationAction}
        surveyId={id}
      />
    </div>
  );
}
