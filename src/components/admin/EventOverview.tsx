import Link from 'next/link';
import { Callout } from '@/components/ui/Callout';
import { Donut } from '@/components/ui/Donut';
import { statisticsUrl } from '@/lib/admin/statistics-view';
import { sparkline } from '@/lib/design/sparkline';
import type { AttendanceTotals } from '@/lib/survey/attendance';
import type { Insight } from '@/lib/survey/insights';
import { PACE_WINDOWS, PACE_WINDOW_LABELS, type Pace } from '@/lib/survey/pace';

/**
 * Vue d'ensemble d'un événement : ce qu'on regarde en premier, dans l'ordre où
 * on le regarde.
 *
 * La hiérarchie est le sujet de cet écran. Un seul chiffre domine — l'effectif
 * attendu, celui qu'un traiteur ou un service d'accueil utilise — et tout le
 * reste l'explique : d'où il vient (statut des réponses), comment il évolue
 * (rythme), ce qui pourrait le fausser (réponses à vérifier).
 *
 * Composant de présentation pur : il ne calcule rien qu'un test ne pourrait
 * fixer ailleurs. Les agrégats arrivent déjà faits.
 *
 * Les exports ne sont PAS repris en bas de cette vue, contrairement à la
 * maquette : ils vivent dans l'en-tête d'écran, où ils sont accessibles depuis
 * les trois onglets. Deux liens identiques sur un même écran obligent à se
 * demander lequel des deux fait autre chose.
 */

export interface PartySummary {
  readonly label: string;
  readonly average: number | null;
  readonly unit: string | null;
  readonly distribution: readonly { readonly value: number; readonly count: number }[];
}

export interface EventOverviewProps {
  surveyId: string;
  responseCount: number;
  /** `null` quand la question de présence n'a pas été désignée. */
  totals: AttendanceTotals | null;
  capacity: number | null;
  /** Ce que les sept derniers jours ont apporté. */
  delta: { readonly responses: number; readonly people: number } | null;
  pace: Pace;
  /**
   * Accompagnants annoncés, ou `null` si aucune question ne donne de nombre.
   * Calculé par l'appelant : `people - attending` n'a de sens qu'une fois la
   * question désignée.
   */
  companions: number | null;
  /** Distribution du nombre d'accompagnants, quand elle est lisible. */
  party: PartySummary | null;
  insights: readonly Insight[];
  /** Réglages de l'événement, pour y désigner ce qui manque. */
  settingsHref: string;
}

const TONE_MARK: Readonly<Record<Insight['tone'], string>> = {
  accent: 'i',
  success: '✓',
  warning: '!',
  danger: '!',
};

/** Nombre écrit en français : espace fine insécable comme séparateur. */
function number(value: number): string {
  return value.toLocaleString('fr-FR');
}

function decimal(value: number): string {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

export function EventOverview({
  surveyId,
  responseCount,
  totals,
  capacity,
  delta,
  pace,
  companions,
  party,
  insights,
  settingsHref,
}: EventOverviewProps) {
  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': 'var(--sp-space-4)' } as React.CSSProperties}>
      {totals ? (
        <HeadlineFigure
          capacity={capacity}
          companions={companions}
          delta={delta}
          totals={totals}
        />
      ) : (
        <ResponseFigure delta={delta} responseCount={responseCount} />
      )}

      {totals ? (
        <StatusCard responseCount={responseCount} totals={totals} />
      ) : (
        <Callout mark="?" title="Aucun effectif calculé">
          <p>
            La question qui dit « je viens » n’a pas été désignée : cet écran compte
            donc des réponses, ce qui reste exact, mais ne donne pas de nombre de
            personnes.
          </p>
          <p>
            <Link href={settingsHref}>Désigner la question de présence</Link> prend
            moins d’une minute et n’affecte aucune réponse déjà reçue.
          </p>
        </Callout>
      )}

      <PaceCard pace={pace} surveyId={surveyId} />

      <div className="sp-duo">
        {party ? <PartyCard party={party} /> : null}
        {totals ? <ReliabilityCard totals={totals} /> : null}
      </div>

      <section className="sp-card sp-stack">
        <h2 className="sp-card__title">À retenir</h2>
        {insights.length === 0 ? (
          <p className="sp-muted">
            Rien à signaler : aucun écart ni réserve sur les réponses reçues.
          </p>
        ) : (
          <ul className="sp-insights">
            {insights.map((insight) => (
              <li className={`sp-insight sp-insight--${insight.tone}`} key={insight.key}>
                <span aria-hidden="true" className="sp-insight__mark">
                  {TONE_MARK[insight.tone]}
                </span>
                <span>
                  <strong className="sp-insight__title">{insight.title}</strong>
                  {insight.note ? (
                    <span className="sp-insight__note">{insight.note}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Le chiffre qui domine
// ---------------------------------------------------------------------------

function HeadlineFigure({
  totals,
  capacity,
  delta,
  companions,
}: {
  totals: AttendanceTotals;
  capacity: number | null;
  delta: EventOverviewProps['delta'];
  companions: number | null;
}) {
  const remaining = capacity === null ? null : capacity - totals.people;

  return (
    <section className="sp-figure">
      <div className="sp-figure__head">
        <div>
          <h2 className="sp-figure__label">Effectif attendu</h2>
          <p className="sp-figure__value">
            {number(totals.people)}
            {delta && delta.people > 0 ? (
              <span className="sp-figure__delta">
                <span aria-hidden="true">+{number(delta.people)} / 7 j</span>
                <span className="sp-visually-hidden">
                  dont {number(delta.people)} sur les sept derniers jours
                </span>
              </span>
            ) : null}
          </p>
          <p className="sp-figure__note">
            Personne{totals.people > 1 ? 's' : ''}, accompagnants compris — non le
            nombre de réponses.
          </p>
        </div>

        {capacity !== null ? (
          <div className="sp-figure__gauge">
            <Donut
              caption={`de ${number(capacity)} places`}
              total={capacity}
              value={totals.people}
              variant="light"
            />
          </div>
        ) : null}
      </div>

      <ul className="sp-figure__tiles">
        <li className="sp-tile">
          <span className="sp-tile__value">{number(totals.attending)}</span>
          <span className="sp-tile__label">
            Réponse{totals.attending > 1 ? 's' : ''} annonçant une présence
          </span>
        </li>
        {companions !== null ? (
          <li className="sp-tile">
            <span className="sp-tile__value">{number(companions)}</span>
            <span className="sp-tile__label">Accompagnants annoncés</span>
          </li>
        ) : null}
        {remaining !== null ? (
          <li className="sp-tile">
            <span className="sp-tile__value">{number(Math.max(0, remaining))}</span>
            <span className="sp-tile__label">
              {remaining < 0 ? 'Places libres — capacité dépassée' : 'Places libres'}
            </span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/**
 * Sans question de présence désignée, le chiffre qui domine est le nombre de
 * réponses. Il est exact, et l'écran ne prétend pas à un effectif.
 */
function ResponseFigure({
  responseCount,
  delta,
}: {
  responseCount: number;
  delta: EventOverviewProps['delta'];
}) {
  return (
    <section className="sp-figure">
      <div className="sp-figure__head">
        <div>
          <h2 className="sp-figure__label">Réponses reçues</h2>
          <p className="sp-figure__value">
            {number(responseCount)}
            {delta && delta.responses > 0 ? (
              <span className="sp-figure__delta">
                <span aria-hidden="true">+{number(delta.responses)} / 7 j</span>
                <span className="sp-visually-hidden">
                  dont {number(delta.responses)} sur les sept derniers jours
                </span>
              </span>
            ) : null}
          </p>
          <p className="sp-figure__note">
            Réponses enregistrées, hors réponses supprimées.
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Statut des réponses
// ---------------------------------------------------------------------------

const STATUS_ROWS = [
  { key: 'attending', label: 'Annoncent une présence', tone: 'attend' },
  { key: 'declined', label: 'Déclinent l’invitation', tone: 'decline' },
  { key: 'unknown', label: 'Sans présence indiquée', tone: 'pending' },
] as const;

function StatusCard({
  totals,
  responseCount,
}: {
  totals: AttendanceTotals;
  responseCount: number;
}) {
  const counts: Readonly<Record<(typeof STATUS_ROWS)[number]['key'], number>> = {
    attending: totals.attending,
    declined: totals.declined,
    unknown: totals.unknown,
  };
  const total = totals.attending + totals.declined + totals.unknown;
  const answered = total === 0 ? 0 : Math.round((totals.attending / total) * 100);

  return (
    <section className="sp-card sp-stack">
      <div className="sp-card__topline">
        <h2 className="sp-card__title">
          Statut de{responseCount > 1 ? 's' : ' la'} {number(responseCount)} réponse
          {responseCount > 1 ? 's' : ''}
        </h2>
        <p className="sp-card__aside">{answered}&nbsp;% annoncent une présence</p>
      </div>

      {/* La barre est un renfort : chaque segment est aussi une ligne écrite,
          avec son compte. Une barre seule ne se lit pas au clavier. */}
      <p aria-hidden="true" className="sp-split">
        {STATUS_ROWS.map((row) =>
          counts[row.key] === 0 ? null : (
            <span
              className={`sp-split__seg sp-split__seg--${row.tone}`}
              key={row.key}
              style={{ width: `${total === 0 ? 0 : (counts[row.key] / total) * 100}%` }}
            />
          ),
        )}
      </p>

      <ul className="sp-legend">
        {STATUS_ROWS.map((row) => (
          <li className="sp-legend__row" key={row.key}>
            <span aria-hidden="true" className={`sp-legend__dot sp-legend__dot--${row.tone}`} />
            <span className="sp-legend__label">{row.label}</span>
            <span className="sp-legend__value">{number(counts[row.key])}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rythme
// ---------------------------------------------------------------------------

function PaceCard({ pace, surveyId }: { pace: Pace; surveyId: string }) {
  const chart = sparkline(pace.buckets);

  return (
    <section className="sp-card sp-stack">
      <div className="sp-card__topline">
        <h2 className="sp-card__title">Rythme des réponses</h2>
        <nav aria-label="Période du graphique" className="sp-toggle">
          {PACE_WINDOWS.map((window) => (
            <Link
              aria-current={window === pace.window ? 'true' : undefined}
              className="sp-toggle__link"
              href={statisticsUrl(surveyId, { tab: 'apercu', period: window })}
              key={window}
            >
              <span aria-hidden="true">{window.replace('j', ' j')}</span>
              <span className="sp-visually-hidden">
                {PACE_WINDOW_LABELS[window]}
              </span>
            </Link>
          ))}
        </nav>
      </div>

      <p className="sp-counter">
        <strong>{number(pace.total)}</strong> réponse{pace.total > 1 ? 's' : ''} sur{' '}
        {PACE_WINDOW_LABELS[pace.window]}
      </p>

      {/* Le graphique est décoratif : les mêmes chiffres sont énumérés juste
          en dessous, à destination des lecteurs d'écran. */}
      <svg
        aria-hidden="true"
        className="sp-spark"
        viewBox="0 0 320 118"
      >
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
        {pace.buckets.map((bucket) => (
          <div key={bucket.start}>
            <dt>{bucket.fullLabel}</dt>
            <dd>
              {bucket.count} réponse{bucket.count > 1 ? 's' : ''}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Accompagnants et réserves
// ---------------------------------------------------------------------------

function PartyCard({ party }: { party: PartySummary }) {
  const highest = party.distribution.reduce(
    (max, entry) => Math.max(max, entry.count),
    0,
  );

  return (
    <section className="sp-card sp-stack">
      <h2 className="sp-card__title">{party.label}</h2>
      <p className="sp-counter">
        <strong>{party.average === null ? '—' : decimal(party.average)}</strong> en
        moyenne{party.unit ? ` (${party.unit})` : ''}
      </p>

      {party.distribution.length === 0 ? (
        <p className="sp-muted">
          Les réponses sont trop dispersées pour une distribution lisible : la moyenne
          et les extrêmes figurent dans l’onglet « Questions ».
        </p>
      ) : (
        <ul className="sp-columns">
          {party.distribution.map((entry) => (
            <li className="sp-columns__item" key={entry.value}>
              {/* Le compte est écrit au-dessus de la colonne POUR L'ŒIL ; le
                  lecteur d'écran reçoit la phrase complète en fin de rangée.
                  Sans ce masquage il entendrait « 1, 0, une réponse » — le
                  même nombre deux fois, encadrant la valeur qu'il qualifie. */}
              <span aria-hidden="true" className="sp-columns__value">
                {entry.count === 0 ? '' : entry.count}
              </span>
              <span
                aria-hidden="true"
                className={`sp-columns__bar${entry.count === highest && highest > 0 ? ' sp-columns__bar--peak' : ''}`}
                style={{
                  height: `${highest === 0 ? 4 : Math.max(4, (entry.count / highest) * 100)}%`,
                }}
              />
              <span className="sp-columns__label">{entry.value}</span>
              <span className="sp-visually-hidden">
                : {entry.count} réponse{entry.count > 1 ? 's' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReliabilityCard({ totals }: { totals: AttendanceTotals }) {
  const total = totals.attending + totals.declined + totals.unknown;
  const sure = Math.max(0, total - totals.ambiguous);

  return (
    <section className="sp-card sp-stack">
      <h2 className="sp-card__title">Fiabilité du comptage</h2>
      <div className="sp-card__center">
        <Donut
          caption="effectif déterminé"
          size={104}
          total={total}
          value={sure}
        />
      </div>
      <p className="sp-muted">
        {totals.ambiguous === 0
          ? 'Chaque réponse présente a un effectif déterminé : le total est exact.'
          : `${totals.ambiguous} réponse${totals.ambiguous > 1 ? 's' : ''} à vérifier — ${totals.ambiguous > 1 ? 'elles comptent' : 'elle compte'} pour une personne, et ${totals.ambiguous > 1 ? 'sont repérées' : 'est repérée'} dans la liste des invités.`}
      </p>
    </section>
  );
}
