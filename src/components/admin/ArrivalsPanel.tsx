import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';
import { SparkChart } from '@/components/ui/SparkChart';
import { sparkline, TICK_ANGLE } from '@/lib/design/sparkline';
import type { ArrivalReport } from '@/lib/checkin/report';

/**
 * La vue « Arrivées » — ce qui sert le lendemain.
 *
 * Trois choses, et rien d'autre : combien sont entrés, l'écart avec ce qui
 * avait été annoncé, et quand l'affluence a eu lieu.
 *
 * **Un fait, jamais un conseil.** La courbe dit où était le pic ; elle ne dit
 * pas d'ouvrir un second pupitre l'année suivante. Rien dans ces chiffres ne
 * soutient une recommandation — les gens arrivent quand ils arrivent, pas
 * quand l'organisation serait prête.
 *
 * **Le graphique est un renfort.** Il est `aria-hidden`, et chaque valeur est
 * écrite à côté puis énumérée en dessous. Le compte inscrit au-dessus d'une
 * colonne l'est AUSSI, sinon le lecteur d'écran dirait deux fois le même
 * nombre de part et d'autre de la valeur qu'il qualifie.
 */

function plural(count: number, one: string, many: string): string {
  return count > 1 ? many : one;
}

export interface ArrivalsPanelProps {
  report: ArrivalReport;
  /** Phrases produites par `arrivalFacts`, déjà composées. */
  facts: readonly string[];
  /** Le comptage est-il désigné ? Sans lui, pas d'effectif annoncé. */
  counting: boolean;
  preparationHref: string;
  /**
   * Ce que l'on emporte après la soirée : la LISTE des personnes d'un côté,
   * la SYNTHÈSE de l'autre. Deux lectures, donc deux jeux de liens — mêler
   * « qui est venu » et « combien sont venus » dans un seul bouton obligerait
   * à ouvrir le fichier pour savoir lequel on a téléchargé.
   */
  sheet: {
    readonly xlsxHref: string;
    readonly csvHref: string;
    readonly printHref: string;
    readonly summaryDocxHref: string;
    readonly summaryPrintHref: string;
  };
}

export function ArrivalsPanel({
  report,
  facts,
  counting,
  preparationHref,
  sheet,
}: ArrivalsPanelProps) {
  if (report.arrived === 0) {
    return (
      <EmptyState
        action={
          <Link className="sp-btn sp-btn--outline" href={preparationHref}>
            Préparer l’accueil
          </Link>
        }
        lead="Aucune arrivée n’a encore été pointée. Cette vue se remplit pendant la soirée, depuis le poste d’accueil."
        title="Rien à rapporter pour le moment"
      />
    );
  }

  // `ArrivalSlice` porte déjà `count` et `label` : c'est exactement ce que
  // `sparkline` attend, et la géométrie reste une fonction pure testée à part.
  const chart = sparkline(report.slices, { tickAngle: TICK_ANGLE });

  return (
    <div className="sp-stack">
      {/* La feuille de présence : une ligne par PERSONNE, venue ou non.
          Elle ferme la soirée, et c'est pour cela qu'elle est ici plutôt que
          dans l'en-tête de l'écran — l'export des réponses, lui, se tire
          n'importe quand et vit déjà là-haut.

          Trois formats pour une seule composition (`presenceRows`) : le
          classeur pour qui va trier et filtrer, le texte pour qui reprend les
          lignes ailleurs, la page mise en forme pour qui imprime ou enregistre
          un PDF. Ce sont de vrais liens : l'écran fonctionne sans JavaScript,
          et le PDF sort de la fenêtre d'impression du navigateur. */}
      <section className="sp-card sp-stack">
        <h2>Emporter</h2>

        <div className="sp-actions-block">
          <h3>La liste des personnes</h3>
          <p className="sp-summary">
            Qui est venu, qui ne l’est pas : une ligne par personne,
            accompagnants compris, classée de A à Z. Elle contient des données
            personnelles — ne la diffusez qu’aux destinataires annoncés dans vos
            mentions d’information.
          </p>
          <div className="sp-actions">
            <a className="sp-btn sp-btn--outline" href={sheet.xlsxHref}>
              Classeur (XLSX)
            </a>
            <a className="sp-btn sp-btn--ghost" href={sheet.csvHref}>
              Fichier CSV
            </a>
            <Link className="sp-btn sp-btn--ghost" href={sheet.printHref}>
              Imprimer ou PDF
            </Link>
          </div>
        </div>

        <div className="sp-actions-block">
          <h3>La synthèse</h3>
          <p className="sp-summary">
            Les trois encadrés de cet écran, courbe comprise, dans un document
            qui se range ou se transmet. Des chiffres, jamais un nom.
          </p>
          <div className="sp-actions">
            <Link className="sp-btn sp-btn--outline" href={sheet.summaryPrintHref}>
              Imprimer ou PDF
            </Link>
            <a className="sp-btn sp-btn--ghost" href={sheet.summaryDocxHref}>
              Document Word
            </a>
          </div>
        </div>
      </section>

      <section className="sp-card">
        <h2>Ce qui s’est passé</h2>

        <p className="sp-desk__count">
          <strong>{report.peopleIn}</strong>
          <span>
            {plural(report.peopleIn, 'personne entrée', 'personnes entrées')}
            {counting ? ` sur ${report.peopleExpected} annoncées` : ''}
          </span>
        </p>

        <dl className="sp-figures">
          <div>
            <dt>Inscriptions pointées</dt>
            <dd>{report.arrived}</dd>
          </div>
          {counting ? (
            <div>
              <dt>Annoncées présentes</dt>
              <dd>{report.expected}</dd>
            </div>
          ) : null}
          {counting ? (
            <div>
              <dt>Annoncées, non venues</dt>
              <dd>{report.noShow}</dd>
            </div>
          ) : null}
          <div>
            <dt>Venues sans l’avoir annoncé</dt>
            <dd>{report.unexpected}</dd>
          </div>
          <div>
            <dt>Effectifs corrigés à l’entrée</dt>
            <dd>{report.corrected}</dd>
          </div>
          {report.walkIns > 0 ? (
            <div>
              <dt>Ajoutées à l’entrée</dt>
              <dd>{report.walkIns}</dd>
            </div>
          ) : null}
          {/* Le cadeau n'apparaît que s'il a été remis : une soirée sans
              cadeau ne doit pas afficher « 0 cadeau », qui laisserait croire
              qu'on en attendait. */}
          {report.gifts > 0 ? (
            <div>
              <dt>Cadeaux remis au départ</dt>
              <dd>{report.gifts}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="sp-card sp-stack">
        <h2>Quand les gens sont arrivés</h2>
        <p className="sp-summary">
          Tranches de {report.sliceMinutes} minutes
          {report.busiest ? (
            <>
              {' '}— affluence {report.busiest.fullLabel}, avec{' '}
              <strong>{report.busiest.count}</strong>{' '}
              {plural(report.busiest.count, 'arrivée', 'arrivées')}.
            </>
          ) : (
            '.'
          )}
        </p>

        <SparkChart chart={chart} />

        <dl className="sp-visually-hidden">
          {report.slices.map((slice) => (
            <div key={slice.start}>
              <dt>{slice.fullLabel}</dt>
              <dd>
                {slice.count} {plural(slice.count, 'arrivée', 'arrivées')}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="sp-card">
        <h2>À retenir</h2>
        <ul className="sp-facts">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
