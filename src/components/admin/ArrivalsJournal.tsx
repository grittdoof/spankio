import { EmptyState } from '@/components/ui/EmptyState';
import {
  JOURNAL_SOURCE_LABELS,
  journalActionLabel,
  journalSummary,
  type JournalEntry,
} from '@/lib/checkin/journal';

/**
 * L'historique de la porte, du plus récent au plus ancien.
 *
 * Écran de RECOURS : on ne l'ouvre que lorsqu'un chiffre surprend. Il
 * répond donc à une seule question — « que s'est-il passé, et dans quel
 * ordre ? » — et il y répond en phrases, pas en graphiques.
 *
 * Chaque ligne dit l'heure à la SECONDE. C'est inhabituel, et c'est le
 * besoin : deux postes qui se contredisent se départagent à la seconde près,
 * pas à la minute.
 */

const MOMENT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

function moment(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : MOMENT.format(date);
}

export interface ArrivalsJournalProps {
  entries: readonly JournalEntry[];
  /** Le journal est plafonné : au-delà, l'export prend le relais. */
  capped: boolean;
}

export function ArrivalsJournal({ entries, capped }: ArrivalsJournalProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        lead="Aucun pointage n’a encore été enregistré pour cet événement. Chaque arrivée pointée, et chaque retrait, s’inscrira ici avec son heure et son auteur."
        title="Rien à retracer"
      />
    );
  }

  const summary = journalSummary(entries);

  return (
    <section className="sp-stack">
      <p className="sp-hint">
        Tout ce qui a été fait à la porte, du plus récent au plus ancien. Cet
        écran existe pour les jours où un chiffre surprend : il dit qui a
        pointé qui, quand, et depuis quel écran.
      </p>

      {/* Des FAITS recalculables, et rien d'autre : aucun conseil ne se
          déduit d'un journal. */}
      <dl className="sp-journal__facts">
        <div>
          <dt>Gestes</dt>
          <dd>{summary.total}</dd>
        </div>
        <div>
          <dt>Arrivées pointées</dt>
          <dd>{summary.arrivals}</dd>
        </div>
        <div>
          <dt>Retraits</dt>
          <dd>{summary.removals}</dd>
        </div>
        <div>
          <dt>{summary.actors > 1 ? 'Personnes à la porte' : 'Personne à la porte'}</dt>
          <dd>{summary.actors}</dd>
        </div>
      </dl>

      {capped ? (
        <p className="sp-hint">
          Seuls les 500 gestes les plus récents sont affichés. L’export des
          réponses garde l’ensemble.
        </p>
      ) : null}

      <ol className="sp-journal">
        {entries.map((entry) => (
          <li
            className={`sp-journal__row${
              entry.arrived ? '' : ' sp-journal__row--undone'
            }`}
            key={entry.id}
          >
            <time className="sp-journal__when" dateTime={entry.at}>
              {moment(entry.at)}
            </time>

            <span className="sp-journal__what">
              {/* Le mot d'abord, la couleur ensuite : un retrait et une
                  arrivée ne se distinguent jamais par la seule teinte. */}
              <span className="sp-journal__action">{journalActionLabel(entry)}</span>
              <span className="sp-journal__who">
                {entry.who ?? 'Personne retirée de la liste'}
                {entry.isCompanion ? ' (accompagnant)' : ''}
              </span>
            </span>

            <span className="sp-journal__by">
              {entry.by ?? 'Auteur inconnu'}
              <span className="sp-muted"> · {JOURNAL_SOURCE_LABELS[entry.source]}</span>
            </span>
          </li>
        ))}
      </ol>

      <p className="sp-hint">
        Une ligne sans nom désigne une inscription corrigée ou supprimée
        depuis : le journal garde l’identifiant d’origine, parce que c’est
        bien sous celui-là que le geste a eu lieu.
      </p>
    </section>
  );
}
