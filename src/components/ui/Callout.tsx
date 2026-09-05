/**
 * Encadré d'explication.
 *
 * Règle d'usage : un encadré DIT quelque chose que l'utilisateur ne peut pas
 * deviner — une conséquence, une contrainte, un exemple. Un bandeau qui
 * paraphrase le titre au-dessus n'aide personne et éloigne l'action réelle de
 * quelques centimètres de plus.
 *
 * Ce n'est PAS un message d'état : pas de `role="alert"`, pas de `role="status"`.
 * C'est du contenu permanent de la page, présent avant toute action. Les
 * retours d'action passent par `Alert`.
 */

export interface CalloutProps {
  /** Titre facultatif. Sans lui, l'encadré est une simple précision. */
  title?: string;
  /** Marque affichée à gauche. Un caractère, pas une phrase. */
  mark?: string;
  tone?: 'accent' | 'muted';
  children: React.ReactNode;
}

export function Callout({ title, mark = 'i', tone = 'accent', children }: CalloutProps) {
  return (
    <div className={`sp-callout${tone === 'muted' ? ' sp-callout--muted' : ''}`}>
      <span aria-hidden="true" className="sp-callout__mark">
        {mark}
      </span>
      <div>
        {title ? <strong className="sp-callout__title">{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

/** Exemple concret. Le meilleur libellé d'aide reste un exemple. */
export function Example({ children }: { children: React.ReactNode }) {
  return (
    <span className="sp-example">
      <strong>Exemple : </strong>
      {children}
    </span>
  );
}
