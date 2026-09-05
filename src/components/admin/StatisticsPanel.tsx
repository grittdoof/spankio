import type {
  ChoiceCount,
  FieldStatistics,
  SurveyStatistics,
} from '@/lib/survey/statistics';

/**
 * Restitution des agrégats.
 *
 * Composant de présentation pur, sans état ni accès réseau : il reçoit ce que
 * `computeStatistics` a produit et se contente de l'afficher.
 *
 * Deux règles d'affichage :
 *
 *  1. **Aucune information n'est portée par la seule longueur d'une barre.**
 *     Le compte et le pourcentage sont toujours écrits à côté ; la barre n'est
 *     qu'un renfort visuel, marquée `aria-hidden` pour ne pas être annoncée
 *     deux fois.
 *  2. **Aucun contenu de réponse libre.** Un champ texte n'a qu'un compteur —
 *     c'est déjà vrai dans `computeStatistics`, et cet écran ne rattrape rien.
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

function FieldPanel({ field }: { field: FieldStatistics }) {
  return (
    <section className="sp-card sp-stack">
      <h3 className="sp-card__title">{field.label}</h3>
      <p className="sp-muted" style={{ fontSize: '0.875rem' }}>
        {field.answered} réponse{field.answered > 1 ? 's' : ''}
        {field.skipped > 0 ? ` · ${field.skipped} sans réponse` : ''}
      </p>

      {field.type === 'choice' ? (
        <div>
          {field.options.map((option) => (
            <Bar count={option} key={option.value} />
          ))}
        </div>
      ) : null}

      {field.type === 'scale' ? (
        <>
          <p>
            Moyenne : {field.average ?? '—'} · Médiane : {field.median ?? '—'} (échelle de{' '}
            {field.min} à {field.max})
          </p>
          <div>
            {field.distribution.map((entry) => (
              <Bar
                count={{
                  value: String(entry.value),
                  label: String(entry.value),
                  count: entry.count,
                  share: field.answered === 0 ? 0 : Math.round((entry.count / field.answered) * 100),
                }}
                key={entry.value}
              />
            ))}
          </div>
        </>
      ) : null}

      {field.type === 'number' ? (
        <p>
          Moyenne : {field.average ?? '—'} · Médiane : {field.median ?? '—'} · Minimum :{' '}
          {field.lowest ?? '—'} · Maximum : {field.highest ?? '—'} · Total : {field.sum}
        </p>
      ) : null}

      {field.type === 'date' ? (
        <>
          <p>
            De {field.earliest ? formatDay(field.earliest) : '—'} à{' '}
            {field.latest ? formatDay(field.latest) : '—'}
          </p>
          <div>
            {field.byMonth.map((entry) => (
              <Bar
                count={{
                  value: entry.month,
                  label: entry.month,
                  count: entry.count,
                  share: field.answered === 0 ? 0 : Math.round((entry.count / field.answered) * 100),
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
              <h4>{row.label}</h4>
              {row.columns.map((column) => (
                <Bar count={column} key={column.value} />
              ))}
            </div>
          ))
        : null}

      {field.type === 'text' ? (
        <p className="sp-muted">
          Réponse libre : le détail est consultable dans la liste des réponses et dans les
          exports, jamais agrégé ici.
        </p>
      ) : null}
    </section>
  );
}

export function StatisticsPanel({ statistics }: { statistics: SurveyStatistics }) {
  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1rem' } as React.CSSProperties}>
      <div className="sp-stat-grid">
        <div className="sp-stat">
          <span className="sp-stat__value">{statistics.responseCount}</span>
          <span className="sp-stat__label">
            Réponse{statistics.responseCount > 1 ? 's' : ''} enregistrée
            {statistics.responseCount > 1 ? 's' : ''}
          </span>
        </div>
        <div className="sp-stat">
          <span className="sp-stat__value">{statistics.fields.length}</span>
          <span className="sp-stat__label">
            Question{statistics.fields.length > 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {statistics.fields.map((field) => (
        <FieldPanel field={field} key={field.fieldId} />
      ))}
    </div>
  );
}
