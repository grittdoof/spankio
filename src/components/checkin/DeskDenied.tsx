import Link from 'next/link';
import { signOut } from '@/app/(auth)/actions';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Ce que voit quelqu'un dont le compte n'ouvre pas la liste demandée.
 *
 * **Défaut réel, signalé au premier usage, et il a coûté une demi-journée à
 * comprendre** : le poste répondait `404`. Une hôtesse avait sur son
 * téléphone la session d'un compte créé pour un AUTRE événement ; en ouvrant
 * le lien de sa soirée, le RLS masquait le sondage, la page appelait
 * `notFound()`, et elle lisait « 404 » — sans savoir qu'il suffisait de se
 * déconnecter. Le même lien marchait en navigation privée et sur son autre
 * navigateur, ce qui désignait l'application plutôt que le compte.
 *
 * La règle « une ressource que le RLS masque renvoie 404 » vaut pour les
 * ROUTES API, où l'appelant est un programme. Ici l'appelante est debout, à
 * une porte, souvent trois minutes avant l'ouverture : un code nu ne lui dit
 * ni ce qui se passe, ni quoi faire. C'est la panne que le module existe pour
 * éviter — « l'hôtesse qui découvre sur le parvis que son compte ne marche
 * pas » — et la seule différence est qu'elle arrive ici par un lien.
 *
 * **Ce que l'écran ne dit pas** : rien de l'événement. Pas son nom, pas même
 * son existence. Le texte est le même que l'identifiant soit inconnu, que
 * l'affectation ait expiré, ou que le lien ne désigne rien du tout — un
 * message qui varierait répondrait à qui essaie des adresses au hasard. Il
 * nomme en revanche LE COMPTE CONNECTÉ, qui est la seule information
 * manquante, et que la personne a déjà sous les yeux par ailleurs.
 */
export function DeskDenied({ identifier }: { identifier: string | null }) {
  return (
    <EmptyState
      action={
        <div className="sp-stack">
          <form action={signOut}>
            <button className="sp-btn" type="submit">
              Se déconnecter
            </button>
          </form>
          <Link className="sp-btn sp-btn--ghost" href="/accueil">
            Voir les événements de ce compte
          </Link>
        </div>
      }
      lead={
        identifier
          ? `Vous êtes connecté avec l’identifiant « ${identifier} ». À cette adresse, il n’ouvre aucune liste : soit la porte a été confiée à un autre compte, soit l’accès de celui-ci a pris fin. Déconnectez-vous, puis reconnectez-vous avec l’identifiant qui vous a été communiqué pour cet événement.`
          : 'À cette adresse, ce compte n’ouvre aucune liste. Déconnectez-vous, puis reconnectez-vous avec l’identifiant qui vous a été communiqué pour cet événement.'
      }
      title="Ce compte n’ouvre pas cette liste"
    />
  );
}
