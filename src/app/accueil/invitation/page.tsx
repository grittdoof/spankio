import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/ui/EmptyState';
import { resolveRequestContext } from '@/lib/data/context';
import { claimInvitation } from '@/lib/services/checkin';
import { isInvitationTokenShape } from '@/lib/checkin/invitation';

/**
 * Le lien d'invitation, côté invité.
 *
 * Il ne demande rien et n'affiche aucun formulaire : arriver ici avec une
 * session valide SUFFIT. Toute la vérification est dans la base — jeton,
 * usage unique, péremption, et surtout concordance avec l'adresse portée par
 * le jeton d'authentification.
 *
 * Le cas le plus fréquent n'est pas l'erreur, c'est l'absence de compte : le
 * lien ne le crée pas. On renvoie donc vers la connexion plutôt que
 * d'afficher un refus, et le message d'accueil dit qu'il faut l'adresse
 * invitée.
 */

export const dynamic = 'force-dynamic';

/** Chaque refus dit QUOI FAIRE, pas seulement ce qui a échoué. */
const REFUS: Readonly<Record<string, { title: string; lead: string }>> = {
  PT404: {
    title: 'Ce lien n’ouvre rien',
    lead: 'Il a déjà été utilisé, il a expiré, ou il est incomplet — un lien coupé en deux par un logiciel de messagerie, par exemple. Demandez-en un nouveau à l’organisateur ; les liens ne se renvoient pas, ils se refont.',
  },
  PT403: {
    title: 'Ce lien a été envoyé à une autre adresse',
    lead: 'Vous êtes connecté avec un compte dont l’adresse ne correspond pas à celle invitée. Déconnectez-vous, puis connectez-vous — ou inscrivez-vous — avec l’adresse à laquelle le message vous est parvenu.',
  },
  PT409: {
    title: 'Ce compte appartient déjà à une autre organisation',
    lead: 'Un même compte ne peut pas appartenir à deux organisations. Créez un compte distinct avec l’adresse invitée, ou demandez à l’organisateur de vous affecter depuis le compte que vous utilisez déjà chez lui.',
  },
};

const DEFAUT = {
  title: 'Ce lien n’a pas pu être utilisé',
  lead: 'Réessayez dans un instant. Si cela persiste, demandez un nouveau lien à l’organisateur.',
};

export default async function CheckinInvitationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const raw = typeof query['jeton'] === 'string' ? query['jeton'] : '';

  // Refus PRÉCOCE d'une URL tronquée : interroger la base avec trois
  // caractères ne sert à rien, et « ce lien est incomplet » se comprend mieux
  // que « lien invalide ».
  if (!isInvitationTokenShape(raw)) {
    return <EmptyState lead={REFUS['PT404']!.lead} title="Ce lien est incomplet" />;
  }

  const context = await resolveRequestContext();
  if (!context.userId) {
    // Pas de compte, ou pas connecté : c'est le cas ORDINAIRE, pas une erreur.
    // On conserve le jeton dans l'adresse de retour, puisque le lien ne vaut
    // qu'une fois et qu'il serait perdu sinon.
    const retour = `/accueil/invitation?jeton=${encodeURIComponent(raw)}`;
    redirect(`/connexion?suite=${encodeURIComponent(retour)}`);
  }

  const claimed = await claimInvitation(context, raw);
  if (claimed.ok) redirect(`/accueil/${claimed.value.surveyId}`);

  const refus = REFUS[claimed.error.code] ?? DEFAUT;

  return (
    <div className="sp-stack">
      <EmptyState lead={refus.lead} title={refus.title} />
      <p>
        <Link className="sp-btn sp-btn--outline" href="/accueil">
          Voir mes événements
        </Link>
      </p>
    </div>
  );
}
