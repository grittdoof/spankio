import Link from 'next/link';
import type {
  ChoiceCount,
  FieldStatistics,
  SurveyStatistics,
} from '@/lib/survey/statistics';

/**
 * Restitution des agrégats, question par question.
 *
 * Composant de présentation pur, sans état ni accès réseau : il reçoit ce que
 * `computeStatistics` a produit et se contente de l'afficher.
 *
 * Trois règles d'affichage :
 *
 *  1. **Aucune information n'est portée par la seule longueur d'une barre.**
 *     Le compte et le pourcentage sont toujours écrits à côté ; la barre n'est
 *     qu'un renfort visuel, marquée `aria-hidden` pour ne pas être annoncée
 *     deux fois.
 *  2. **Aucun contenu de réponse libre.** Un champ texte n'a qu'un compteur —
 *     c'est déjà vrai dans `computeStatistics`, et cet écran ne rattrape rien.
 *  3. **Les champs libres sont REGROUPÉS en une seule carte.** Une carte par
 *     champ répétant « le détail est dans la liste » trois fois de suite
 *     repousse hors de vue les questions qui, elles, ont des agrégats à
 *     montrer.
 */

function Bar({ count }: { count: ChoiceCount }) {
  return (
    <div className="sp-bar">
      <span>{count.label}</span>
      <span aria-hidden="true" className="sp-bar__track">
        <span className="sp-bar__fill" style={{ width: `${count.share}%` }} />
      </span>
      <span className="sp-bar__value">
        {count.count} ({count.share}&nbsp;%)
      </span>
    </div>
  );
}

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeZone: 'Europe/Paris',
});

function formatDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DAY_FORMAT.format(date);
}

function decimal(value: number): string {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

/**
 * Distribution en colonnes : le compte est écrit AU-DESSUS de chaque colonne,
 * la valeur en dessous. Une colonne nulle garde son étiquette — un trou dans
 * une distribution est une information.
 */
function Columns({
  distribution,
  answered,
}: {
  distribution: readonly { readonly value: number; readonly count: number }[];
  answered: number;
}) {
  const highest = distribution.reduce((max, entry) => Math.max(max, entry.count), 0);
  return (
    <ul className="sp-columns">
      {distribution.map((entry) => (
        <li className="sp-columns__item" key={entry.value}>
          {/* Le compte est écrit au-dessus de la colonne POUR L'ŒIL ; le
              lecteur d'écran reçoit la phrase complète en fin de rangée. Sans
              ce masquage il entendrait « 1, 0, une réponse » — le même nombre
              deux fois, encadrant la valeur qu'il qualifie. */}
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
            {answered > 0 ? ` sur ${answered}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Answered({ field }: { field: FieldStatistics }) {
  return (
    <p className="sp-card__aside">
      {field.answered} réponse{field.answered > 1 ? 's' : ''}
      {field.skipped > 0 ? ` · ${field.skipped} sans réponse` : ''}
    </p>
  );
}

function FieldPanel({ field }: { field: FieldStatistics }) {
  return (
    <section className="sp-card sp-stack">
      <div className="sp-card__topline">
        <h2 className="sp-card__title">{field.label}</h2>
        <Answered field={field} />
      </div>

      {field.type === 'choice' ? (
        <div>
          {field.options.map((option) => (
            <Bar count={option} key={option.value} />
          ))}
          {field.otherCount > 0 ? (
            <p className="sp-muted">
              {field.otherCount} saisie{field.otherCount > 1 ? 's' : ''} libre
              {field.otherCount > 1 ? 's' : ''} via « autre » : leur contenu reste dans
              la liste et les exports.
            </p>
          ) : null}
        </div>
      ) : null}

      {field.type === 'scale' ? (
        <>
          <p className="sp-counter">
            <strong>{field.average === null ? '—' : decimal(field.average)}</strong> en
            moyenne · médiane {field.median === null ? '—' : decimal(field.median)}{' '}
            (échelle de {field.min} à {field.max})
          </p>
          <Columns
            answered={field.answered}
            distribution={field.distribution}
          />
        </>
      ) : null}

      {field.type === 'number' ? (
        <>
          <p className="sp-counter">
            <strong>{field.average === null ? '—' : decimal(field.average)}</strong> en
            moyenne · médiane {field.median === null ? '—' : decimal(field.median)} · de{' '}
            {field.lowest ?? '—'} à {field.highest ?? '—'} · total {field.sum}
          </p>
          {field.distribution.length > 0 ? (
            <Columns answered={field.answered} distribution={field.distribution} />
          ) : null}
        </>
      ) : null}

      {field.type === 'date' ? (
        <>
          <p className="sp-counter">
            De <strong>{field.earliest ? formatDay(field.earliest) : '—'}</strong> à{' '}
            <strong>{field.latest ? formatDay(field.latest) : '—'}</strong>
          </p>
          <div>
            {field.byMonth.map((entry) => (
              <Bar
                count={{
                  value: entry.month,
                  label: entry.month,
                  count: entry.count,
                  share:
                    field.answered === 0
                      ? 0
                      : Math.round((entry.count / field.answered) * 100),
                }}
                key={entry.month}
              />
            ))}
          </div>
        </>
      ) : null}

      {field.type === 'grid'
        ? field.rows.map((row) => (
            <div key={row.value}>
              <h3 className="sp-card__subtitle">{row.label}</h3>
              {row.columns.map((column) => (
                <Bar count={column} key={column.value} />
              ))}
            </div>
          ))
        : null}
    </section>
  );
}

/**
 * Les champs libres, tous ensemble. Le lien vers la liste dit où LIRE ce qui
 * n'est pas agrégé ici : sans lui, l'écran interdirait sans rien proposer.
 */
function FreeFieldsPanel({
  fields,
  guestsHref,
}: {
  fields: readonly FieldStatistics[];
  guestsHref: string;
}) {
  const answered = fields.reduce((max, field) => Math.max(max, field.answered), 0);

  return (
    <section className="sp-card sp-stack">
      <div className="sp-card__topline">
        <h2 className="sp-card__title">
          {fields.map((field) => field.label).join(' · ')}
        </h2>
        <p className="sp-card__aside">
          {fields.length} champ{fields.length > 1 ? 's' : ''} libre
          {fields.length > 1 ? 's' : ''}
        </p>
      </div>
      <p className="sp-muted">
        Jamais agrégés ici : un nuage de mots ou un échantillon de réponses
        transformerait ce tableau de bord en écran de lecture de données
        personnelles. {answered} réponse{answered > 1 ? 's' : ''} au plus{' '}
        {answered > 1 ? 'sont consultables' : 'est consultable'} une par une dans la
        liste, et dans les exports.
      </p>
      <p>
        <Link className="sp-btn sp-btn--outline sp-btn--sm" href={guestsHref}>
          Voir la liste des réponses
        </Link>
      </p>
    </section>
  );
}

export function StatisticsPanel({
  statistics,
  guestsHref,
}: {
  statistics: SurveyStatistics;
  guestsHref: string;
}) {
  const aggregated = statistics.fields.filter((field) => field.type !== 'text');
  const free = statistics.fields.filter((field) => field.type === 'text');

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': 'var(--sp-space-4)' } as React.CSSProperties}>
      <p className="sp-summary">
        <strong>
          {statistics.fields.length} question{statistics.fields.length > 1 ? 's' : ''}
        </strong>{' '}
        · {statistics.responseCount} réponse{statistics.responseCount > 1 ? 's' : ''}
        {free.length > 0
          ? ' — les champs libres n’y produisent qu’un compteur.'
          : '.'}
      </p>

      {aggregated.map((field) => (
        <FieldPanel field={field} key={field.fieldId} />
      ))}

      {free.length > 0 ? (
        <FreeFieldsPanel fields={free} guestsHref={guestsHref} />
      ) : null}
    </div>
  );
}
