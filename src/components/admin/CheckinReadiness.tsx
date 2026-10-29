import Link from 'next/link';
import type { ReadinessItem, ReadinessState } from '@/lib/checkin/readiness';
import { readinessState } from '@/lib/checkin/readiness';

/**
 * Ce qui manque avant la soirée, et ce que l'absence COÛTE.
 *
 * Même parti pris que le profil d'organisation : une liste de manques sans
 * conséquence se lit comme une liste de corvées, et on la remet à plus tard.
 * « La question de présence n'est pas désignée » n'engage personne ; « le
 * compteur de salle sera sans dénominateur » engage.
 *
 * Trois états, pas deux : tout ce qui manque n'empêche pas de tenir la porte,
 * et confondre « impossible » et « pénible » ferait soit refuser une soirée
 * qui aurait eu lieu, soit laisser passer en silence ce qui la gâchera. Le
 * mot est donc ÉCRIT sur chaque ligne — la couleur ne fait que le redire.
 */

const STATE_LABEL: Readonly<Record<ReadinessState, string>> = {
  ok: 'Prêt',
  degraded: 'À savoir',
  blocked: 'Bloquant',
};

const STATE_CLASS: Readonly<Record<ReadinessState, string>> = {
  ok: 'sp-ready__item--ok',
  degraded: 'sp-ready__item--warn',
  blocked: 'sp-ready__item--stop',
};

const SUMMARY: Readonly<Record<ReadinessState, string>> = {
  ok: 'Tout est en place pour tenir la porte.',
  degraded: 'La porte peut se tenir, mais certains points gâcheront la soirée.',
  blocked: 'En l’état, le poste d’accueil ne peut pas fonctionner.',
};

export interface CheckinReadinessProps {
  items: readonly ReadinessItem[];
  /** Où se corrigent les désignations de présence et de nom. */
  settingsHref: string;
}

export function CheckinReadiness({ items, settingsHref }: CheckinReadinessProps) {
  const overall = readinessState(items);

  return (
    <section className="sp-card">
      <h2>État de préparation</h2>
      <p className="sp-summary">{SUMMARY[overall]}</p>

      <ul className="sp-ready">
        {items.map((item) => (
          <li className={`sp-ready__item ${STATE_CLASS[item.state]}`} key={item.key}>
            {/* Le mot, pas la pastille : la couleur ne porte rien. */}
            <span className="sp-ready__state">{STATE_LABEL[item.state]}</span>
            <span className="sp-ready__body">
              <span className="sp-ready__label">{item.label}</span>
              {item.consequence ? (
                <span className="sp-ready__why">{item.consequence}</span>
              ) : null}
              {item.consequence && (item.key === 'identity' || item.key === 'presence') ? (
                <Link className="sp-ready__fix" href={settingsHref}>
                  Désigner la question
                </Link>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
