import Link from 'next/link';
import {
  STATISTICS_TABS,
  STATISTICS_TAB_LABELS,
  statisticsUrl,
  type StatisticsTab,
  type StatisticsView,
} from '@/lib/admin/statistics-view';

/**
 * Les trois vues de l'écran : vue d'ensemble, questions, invités.
 *
 * Ce sont des LIENS, pas un `role="tablist"`. Trois raisons :
 *
 *  1. chaque vue a sa propre adresse, donc se partage et se recharge ;
 *  2. l'écran fonctionne sans JavaScript, comme les formulaires
 *     d'authentification ;
 *  3. un `tablist` promet une navigation par flèches que des liens ne
 *     fournissent pas — mieux vaut ne pas la promettre que la simuler à moitié.
 *
 * L'onglet courant porte `aria-current="page"` : c'est ce que le lecteur
 * d'écran annonce, et la couleur n'est donc pas le seul indice.
 */

export function StatisticsTabs({
  surveyId,
  current,
  view,
}: {
  surveyId: string;
  current: StatisticsTab;
  /** Conservé au changement d'onglet : la période choisie. */
  view: StatisticsView;
}) {
  return (
    <nav aria-label="Vues des statistiques" className="sp-tabs">
      {STATISTICS_TABS.map((tab) => (
        <Link
          aria-current={tab === current ? 'page' : undefined}
          className="sp-tabs__link"
          href={statisticsUrl(surveyId, { tab, period: view.period })}
          key={tab}
        >
          {STATISTICS_TAB_LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}
