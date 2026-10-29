import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';
import { sparkline } from '@/lib/design/sparkline';
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
}

export function ArrivalsPanel({
  report,
  facts,
  counting,
  preparationHref,
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
  const chart = sparkline(report.slices);

  return (
    <div className="sp-stack">
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

        {/* Décoratif : les mêmes chiffres sont énumérés juste en dessous. */}
        <svg aria-hidden="true" className="sp-spark" viewBox="0 0 320 118">
          <line className="sp-spark__rule" x1="0" x2="320" y1="8" y2="8" />
          <line className="sp-spark__rule" x1="0" x2="320" y1="50" y2="50" />
          <line className="sp-spark__rule" x1="0" x2="320" y1="92" y2="92" />
          {chart.line ? (
            <>
              <path className="sp-spark__area" d={chart.area} />
              <path className="sp-spark__line" d={chart.line} />
            </>
          ) : null}
          {chart.points.map((point) => (
            <g key={point.label}>
              <circle className="sp-spark__dot" cx={point.x} cy={point.y} r="3.4" />
              <text
                className="sp-spark__value"
                textAnchor="middle"
                x={point.x}
                y={Math.max(9, point.y - 8)}
              >
                {point.value === 0 ? '' : point.value}
              </text>
              <text className="sp-spark__tick" textAnchor="middle" x={point.x} y="112">
                {point.label}
              </text>
            </g>
          ))}
        </svg>

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
