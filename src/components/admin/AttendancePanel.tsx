import type { AttendanceTotals } from '@/lib/survey/attendance';

/**
 * Effectif attendu à un événement.
 *
 * Le chiffre qui domine est le nombre de PERSONNES, non celui des réponses :
 * c'est lui qu'un traiteur ou un service d'accueil utilisera. Compter les
 * réponses reviendrait à oublier les accompagnants.
 *
 * Les réserves sont affichées à côté du total, jamais fondues dedans : un
 * effectif indéterminé — plusieurs cases cochées là où une seule était
 * attendue — est signalé pour être vérifié à la main, pas arbitré en silence.
 */
export function AttendancePanel({ totals }: { totals: AttendanceTotals }) {
  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': 'var(--sp-space-4)' } as React.CSSProperties}>
      <div className="sp-stat-grid">
        <div className="sp-stat sp-stat--lead">
          <span className="sp-stat__value">{totals.people}</span>
          <span className="sp-stat__label">
            Personne{totals.people > 1 ? 's' : ''} attendue{totals.people > 1 ? 's' : ''}
          </span>
        </div>
        <div className="sp-stat">
          <span className="sp-stat__value">{totals.attending}</span>
          <span className="sp-stat__label">
            Réponse{totals.attending > 1 ? 's' : ''} annonçant une présence
          </span>
        </div>
        <div className="sp-stat">
          <span className="sp-stat__value">{totals.declined}</span>
          <span className="sp-stat__label">
            Décline{totals.declined > 1 ? 'nt' : ''} l’invitation
          </span>
        </div>
        {totals.unknown > 0 ? (
          <div className="sp-stat">
            <span className="sp-stat__value">{totals.unknown}</span>
            <span className="sp-stat__label">Sans réponse à la question de présence</span>
          </div>
        ) : null}
      </div>

      {totals.ambiguous > 0 ? (
        <p className="sp-attendance-warning">
          <strong>
            {totals.ambiguous} réponse{totals.ambiguous > 1 ? 's' : ''} à vérifier
          </strong>{' '}
          — l’effectif n’a pas pu être déterminé (aucun nombre indiqué, ou plusieurs
          cases cochées). {totals.ambiguous > 1 ? 'Elles comptent' : 'Elle compte'} pour
          une personne dans le total ci-dessus, et {totals.ambiguous > 1 ? 'sont' : 'est'}{' '}
          repérée{totals.ambiguous > 1 ? 's' : ''} dans la liste.
        </p>
      ) : null}
    </div>
  );
}
