import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { Callout, Example } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Steps } from '@/components/ui/Steps';
import { Tooltip } from '@/components/ui/Tooltip';
import { SPACE_SCALE_REM } from '@/lib/design/tokens';

/**
 * Atelier de design : toutes les primitives sur un seul écran, sans base de
 * données ni session.
 *
 * Pourquoi il existe : les écrans d'administration ne s'ouvrent qu'avec une
 * session valide, ce qui empêche de vérifier une décision de mise en forme sans
 * se connecter — et empêche surtout de comparer deux composants côte à côte.
 * Un catalogue rend le système visible : une incohérence de rayon ou
 * d'espacement s'y voit en un coup d'œil, alors qu'elle passe inaperçue si on
 * ne regarde jamais qu'un écran à la fois.
 *
 * **Réservé au développement.** En production la page n'existe pas : elle
 * n'expose aucune donnée, mais une page qui décrit l'interface interne n'a rien
 * à faire sur un site public.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Atelier de design', robots: { index: false } };

const BUTTONS: readonly [string, string][] = [
  ['sp-btn', 'Action principale'],
  ['sp-btn sp-btn--outline', 'Action secondaire'],
  ['sp-btn sp-btn--ghost', 'Action discrète'],
  ['sp-btn sp-btn--danger', 'Supprimer'],
  ['sp-btn sp-btn--ghost sp-btn--danger-text', 'Retirer'],
];

export default function DesignWorkshopPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="sp-admin__main" id="contenu">
      <div className="sp-page">
        <PageHeader
          title="Atelier de design"
          lead="Le système d’interface sur un seul écran : échelles, primitives, états. Disponible en développement uniquement."
          crumbs={[{ label: 'Développement' }, { label: 'Atelier' }]}
          meta={<span className="sp-badge sp-badge--warning">Hors production</span>}
          actions={<button className="sp-btn" type="button">Action principale</button>}
        />

        <section className="sp-section">
          <h2 className="sp-section__title">Typographie</h2>
          <p className="sp-section__lead">
            Corps à 16 px, échelle fluide réservée aux grands niveaux.
          </p>
          <div className="sp-card sp-stack">
            <h1>Titre de niveau 1</h1>
            <h2>Titre de niveau 2</h2>
            <h3>Titre de niveau 3</h3>
            <h4>Titre de niveau 4</h4>
            <p className="sp-lead">
              Chapeau : la phrase qui explique l’écran, limitée à soixante caractères de
              largeur pour rester lisible.
            </p>
            <p>
              Corps de texte. La longueur de ligne est bornée par la colonne, l’interligne
              à 1,6 : deux réglages qui font davantage pour le confort de lecture que le
              choix de la police.
            </p>
            <p className="sp-muted">Texte secondaire, pour les précisions.</p>
          </div>
        </section>

        <section className="sp-section">
          <h2 className="sp-section__title">Échelle d’espacement</h2>
          <p className="sp-section__lead">
            Base 4 px, progression grossière au-delà de 16 px : ce sont les grands écarts
            qui aèrent.
          </p>
          <div className="sp-card">
            <ul className="sp-scale-demo">
              {SPACE_SCALE_REM.map((rem, index) => (
                <li key={rem}>
                  <span>{`--sp-space-${index + 1}`}</span>
                  <span aria-hidden="true" style={{ width: `${rem}rem` }} />
                  <span>{rem * 16} px</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="sp-section">
          <h2 className="sp-section__title">Boutons</h2>
          <p className="sp-section__lead">
            Une seule action principale par écran. Les autres sont secondaires ou
            discrètes.
          </p>
          <div className="sp-card sp-stack">
            <div className="sp-actions">
              {BUTTONS.map(([className, label]) => (
                <button className={className} key={className} type="button">
                  {label}
                </button>
              ))}
            </div>
            <div className="sp-actions">
              <button className="sp-btn sp-btn--lg" type="button">Grand</button>
              <button className="sp-btn" type="button">Normal</button>
              <button className="sp-btn sp-btn--sm" type="button">Petit</button>
              <button className="sp-btn" disabled type="button">Indisponible</button>
              <button className="sp-btn" type="button">
                <span aria-hidden="true" className="sp-spinner" />
                Envoi en cours…
              </button>
            </div>
            {/* Les mêmes classes portées par des liens : c'est là qu'un défaut de
                cascade s'était glissé, le libellé devenant invisible au survol. */}
            <div className="sp-actions">
              {BUTTONS.map(([className, label]) => (
                <a className={className} href="#boutons" key={`lien-${className}`}>
                  {label} (lien)
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="sp-section">
          <h2 className="sp-section__title">Champs</h2>
          <div className="sp-card">
            <div className="sp-field">
              <label className="sp-label" htmlFor="atelier-texte">
                Intitulé du champ{' '}
                <Tooltip label="intitulé du champ">
                  L’aide contextuelle s’ouvre au clic comme au clavier, et se referme par
                  Échap.
                </Tooltip>
              </label>
              <input className="sp-input" id="atelier-texte" type="text" />
              <span className="sp-hint">
                L’aide sous le champ précise ce qu’on attend.
                <Example>Assemblée générale 2027</Example>
              </span>
            </div>

            <div className="sp-field">
              <label className="sp-label" htmlFor="atelier-select">
                Liste déroulante
              </label>
              <select className="sp-select" defaultValue="a" id="atelier-select">
                <option value="a">Première option</option>
                <option value="b">Deuxième option</option>
              </select>
            </div>

            <div className="sp-field">
              <label className="sp-label" htmlFor="atelier-erreur">
                Champ en erreur
              </label>
              <input
                aria-describedby="atelier-erreur-message"
                aria-invalid="true"
                className="sp-input"
                defaultValue="valeur refusée"
                id="atelier-erreur"
                type="text"
              />
              <span className="sp-error" id="atelier-erreur-message">
                Cette réponse est obligatoire.
              </span>
            </div>

            <ul className="sp-picks">
              <li>
                <label className="sp-pick">
                  <input defaultChecked name="atelier-choix" type="radio" />
                  <span className="sp-pick__text">
                    <span className="sp-pick__name">Choix en grande carte</span>
                    <span className="sp-pick__desc">
                      La cible est le bloc entier, pas un rond de seize pixels.
                    </span>
                  </span>
                </label>
              </li>
              <li>
                <label className="sp-pick">
                  <input name="atelier-choix" type="radio" />
                  <span className="sp-pick__text">
                    <span className="sp-pick__name">Deuxième choix</span>
                    <span className="sp-pick__desc">Avec sa propre explication.</span>
                  </span>
                </label>
              </li>
            </ul>
          </div>
        </section>

        <section className="sp-section">
          <h2 className="sp-section__title">Pédagogie et états</h2>
          <div className="sp-stack" style={{ '--sp-stack-gap': 'var(--sp-space-5)' } as React.CSSProperties}>
            <Callout title="Encadré explicatif">
              Il dit une conséquence que l’utilisateur ne peut pas deviner.
              <Example>365 jours pour une inscription à un événement.</Example>
            </Callout>
            <Callout mark="!" tone="muted" title="Encadré discret">
              Pour une précision qui n’est pas une alerte.
            </Callout>
            <Alert tone="success">Enregistré.</Alert>
            <Alert tone="error" title="À corriger avant de continuer">
              <ul>
                <li>La finalité est obligatoire.</li>
                <li>La base légale est obligatoire.</li>
              </ul>
            </Alert>
            <Alert tone="info">Information sans gravité.</Alert>
            <Steps current={2} total={5} label="Informations légales" />
            <div className="sp-card">
              <div className="sp-skeleton" style={{ height: '1rem', width: '40%' }} />
              <div
                className="sp-skeleton"
                style={{ height: '1rem', marginTop: '0.75rem', width: '75%' }}
              />
            </div>
            <EmptyState
              title="Aucun formulaire pour l’instant"
              lead="Un parcours guidé vous accompagne : titre, type, informations aux répondants."
              action={<button className="sp-btn sp-btn--lg" type="button">Créer</button>}
            />
          </div>
        </section>

        <section className="sp-section">
          <h2 className="sp-section__title">Badges</h2>
          <div className="sp-card sp-actions">
            <span className="sp-badge">Neutre</span>
            <span className="sp-badge sp-badge--accent">Accent</span>
            <span className="sp-badge sp-badge--success">Succès</span>
            <span className="sp-badge sp-badge--warning">Attention</span>
            <span className="sp-badge sp-badge--danger">Refus</span>
          </div>
        </section>
      </div>
    </main>
  );
}
