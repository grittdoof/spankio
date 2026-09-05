/**
 * État vide.
 *
 * Une liste vide n'est pas une erreur : c'est le premier écran que voit un
 * nouvel utilisateur. Il doit donc expliquer ce qui se passera et proposer
 * l'action, plutôt que de constater l'absence — « Aucun résultat » tout seul
 * laisse l'utilisateur sans issue.
 */
export interface EmptyStateProps {
  title: string;
  lead?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, lead, action }: EmptyStateProps) {
  return (
    <div className="sp-empty">
      <h2 className="sp-empty__title">{title}</h2>
      {lead ? <p className="sp-empty__lead">{lead}</p> : null}
      {action}
    </div>
  );
}
