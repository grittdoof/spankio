import type { PrintSortOption } from '@/lib/checkin/print';

/**
 * Le listing papier, et son classement choisi AVANT la génération.
 *
 * Une liste triée autrement qu'on ne cherche est inutilisable, et on ne s'en
 * aperçoit qu'une fois les trente pages sorties. Le classement est donc un
 * choix explicite, fait ici, et non un tri qu'on referait au stylo.
 *
 * Les critères proposés sont les QUESTIONS du formulaire : « Nom », « Prénom »
 * et « Société » n'existent pas dans une plateforme générique — ce sont les
 * questions que l'organisation a posées. Même règle que la désignation de la
 * présence ou du nom.
 *
 * C'est un `<form method="get">` : il compose une URL, donc il fonctionne sans
 * JavaScript, se met en favori et se recharge.
 */
export interface CheckinPrintProps {
  surveyId: string;
  options: readonly PrintSortOption[];
  defaultSort: string;
  /** Aucune réponse : imprimer une liste vide n'apprendrait rien. */
  empty: boolean;
}

export function CheckinPrint({ surveyId, options, defaultSort, empty }: CheckinPrintProps) {
  return (
    <section className="sp-card">
      <h2>Listing papier</h2>
      <p className="sp-hint">
        Le dernier rempart de la soirée : un stylo sur du papier ne dépend ni du
        réseau, ni du serveur, ni de la batterie d’un téléphone. Il se tire la
        veille, au bureau — l’imprimer depuis la salle suppose exactement le
        réseau qu’il est censé remplacer.
      </p>

      <form
        action={`/accueil/${surveyId}/impression`}
        className="sp-staff__add"
        method="get"
        rel="noopener"
        target="_blank"
      >
        <p className="sp-field">
          <label className="sp-label" htmlFor="sp-print-sort">
            Classer les invités par
          </label>
          <select
            className="sp-select"
            defaultValue={defaultSort}
            id="sp-print-sort"
            name="tri"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="sp-hint">
            Cherchez-vous un nom, un prénom ou une société à l’entrée ? C’est ce
            classement-là qu’il faut. La question choisie devient une colonne du
            listing, sans quoi l’ordre paraîtrait arbitraire.
          </span>
        </p>

        <button className="sp-btn sp-btn--primary" disabled={empty} type="submit">
          Imprimer le listing
        </button>

        {empty ? (
          <p className="sp-hint">
            Aucune inscription à imprimer pour le moment.
          </p>
        ) : null}
      </form>
    </section>
  );
}
