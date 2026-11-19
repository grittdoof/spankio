import Link from 'next/link';
import { SparkChart } from '@/components/ui/SparkChart';
import { SUMMARY_HEADINGS, type ArrivalSummary } from '@/lib/checkin/summary';
import type { Sparkline } from '@/lib/design/sparkline';

/**
 * La synthèse telle qu'elle s'imprime.
 *
 * Séparée de la page pour une raison précise : un composant serveur qui charge
 * ses données ne se rend pas dans un test, alors que celui-ci oui. La mise en
 * page du document est donc vérifiable — accessibilité comprise — au lieu de
 * n'être jugée qu'à l'œil une fois le PDF sorti.
 *
 * Elle réemploie les CARTES de l'écran, et c'est tout l'intérêt de produire le
 * PDF par l'impression du navigateur : une seconde mise en forme aurait fini
 * par montrer autre chose que la vue « Arrivées » dont elle est la copie.
 */

export interface ArrivalSummaryDocumentProps {
  summary: ArrivalSummary;
  chart: Sparkline;
  /** Vrai quand aucune arrivée n'a été pointée : il n'y a rien à synthétiser. */
  empty: boolean;
  title: string;
  organisation: string | null;
  logoUrl: string | null;
  /** Date de l'événement, déjà mise en forme dans SON fuseau. */
  when: string | null;
  /** Date d'édition, déjà mise en forme : ce composant ne lit pas l'horloge. */
  editedAt: string;
  backHref: string;
}

export function ArrivalSummaryDocument({
  summary,
  chart,
  empty,
  title,
  organisation,
  logoUrl,
  when,
  editedAt,
  backHref,
}: ArrivalSummaryDocumentProps) {
  return (
    <div className="sp-print sp-print--doc">
      <header className="sp-print__head">
        {logoUrl ? (
          // Décoratif : le nom de l'organisation est écrit juste à côté.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="sp-print__logo" decoding="async" src={logoUrl} />
        ) : null}

        <div className="sp-print__title">
          {organisation ? <p className="sp-print__org">{organisation}</p> : null}
          <h1>Synthèse des arrivées — {title}</h1>
          {when ? <p className="sp-print__when">{when}</p> : null}
        </div>
      </header>

      {/* Masqué à l'impression : ces phrases servent à l'écran d'où l'on
          déclenche l'impression, pas au document qui en sort. */}
      <p className="sp-print__howto">
        Imprimez cette page — ou choisissez « Enregistrer au format PDF » dans la
        fenêtre d’impression. La même synthèse se télécharge en document Word
        depuis la vue « Arrivées ».{' '}
        <Link href={backHref}>
          Retour aux arrivées
        </Link>
      </p>

      {empty ? (
        <p className="sp-print__when">
          Aucune arrivée n’a été pointée : il n’y a rien à synthétiser pour le
          moment.
        </p>
      ) : (
        <div className="sp-stack">
          <section className="sp-card">
            <h2>{SUMMARY_HEADINGS.what}</h2>

            <p className="sp-desk__count">
              <strong>{summary.headline.value}</strong>
              <span>{summary.headline.detail}</span>
            </p>

            <dl className="sp-figures">
              {summary.figures.map((figure) => (
                <div key={figure.label}>
                  <dt>{figure.label}</dt>
                  <dd>{figure.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="sp-card sp-stack">
            <h2>{SUMMARY_HEADINGS.when}</h2>
            <p className="sp-summary">
              {/* Les fragments viennent du modèle, qui décide où porte
                  l'accent : la phrase ne se recompose pas ici, sinon le
                  document Word et le papier ne diraient plus la même chose. */}
              {summary.pace.lead.map((span) =>
                span.strong ? (
                  <strong key={span.text}>{span.text}</strong>
                ) : (
                  <span key={span.text}>{span.text}</span>
                ),
              )}
            </p>

            <SparkChart chart={chart} />

            {/* La courbe est un renfort : les mêmes valeurs sont énumérées
                ici, et c'est ce que lira un lecteur d'écran. */}
            <dl className="sp-visually-hidden">
              {summary.pace.slices.map((slice) => (
                <div key={slice.start}>
                  <dt>{slice.fullLabel}</dt>
                  <dd>
                    {slice.count} {slice.count > 1 ? 'arrivées' : 'arrivée'}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {summary.facts.length > 0 ? (
            <section className="sp-card">
              <h2>{SUMMARY_HEADINGS.facts}</h2>
              <ul className="sp-facts">
                {summary.facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <p className="sp-print__foot">
        {organisation ? `${organisation} — ` : ''}
        {title} · Synthèse éditée le {editedAt}
      </p>
    </div>
  );
}
