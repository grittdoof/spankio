import { CopyBox } from '@/components/ui/CopyBox';

/**
 * L'adresse du poste, à transmettre.
 *
 * Elle est la même pour tout le monde : le poste ne dépend pas de qui l'ouvre,
 * c'est l'affectation qui décide de ce qu'on y voit. Une personne affectée à
 * un seul événement y arrive d'ailleurs directement, sans rien choisir.
 *
 * Le mot de passe ne figure PAS ici, et c'est voulu : il n'est connu qu'au
 * moment où on le choisit, et le stocker pour le réafficher ferait de cet
 * écran le seul endroit de la plateforme où un secret exerçable se relit.
 */
export interface CheckinShareProps {
  deskUrl: string;
  /** Au moins un compte fabriqué existe : le message change de ton. */
  hasAccounts: boolean;
}

export function CheckinShare({ deskUrl, hasAccounts }: CheckinShareProps) {
  return (
    <section className="sp-card">
      <h2>Le lien du poste</h2>
      <p className="sp-hint">
        {hasAccounts
          ? 'Transmettez ce lien avec l’identifiant et le mot de passe de la personne. Il est le même pour tous les postes.'
          : 'Ce lien ouvre le poste de pointage. Il ne sert à rien tant que personne n’est affecté : créez un compte ou affectez quelqu’un ci-dessous.'}
      </p>
      <CopyBox label="Lien du poste" value={deskUrl} />
    </section>
  );
}
