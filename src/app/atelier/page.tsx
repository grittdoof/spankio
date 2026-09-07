import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventOverview } from '@/components/admin/EventOverview';
import { GuestList } from '@/components/admin/GuestList';
import { StatisticsTabs } from '@/components/admin/StatisticsTabs';
import { Alert } from '@/components/ui/Alert';
import { Callout, Example } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { BrandMark } from '@/components/ui/BrandMark';
import { PageHeader } from '@/components/ui/PageHeader';
import { Steps } from '@/components/ui/Steps';
import { Tooltip } from '@/components/ui/Tooltip';
import { SPACE_SCALE_REM } from '@/lib/design/tokens';
import { InvitationDemo } from './InvitationDemo';
import { parseStatisticsView } from '@/lib/admin/statistics-view';
import { guestList, type GuestList as GuestListModel } from '@/lib/survey/guests';
import { eventInsights } from '@/lib/survey/insights';
import { responsePace } from '@/lib/survey/pace';
import { countdownParts } from '@/lib/event/countdown';
import { validateSurveySchema } from '@/lib/survey/schema';
import { countAttendance, type AttendanceSettings } from '@/lib/survey/attendance';

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

/**
 * Logo de démonstration, dessiné en SVG et embarqué en `data:`.
 *
 * Aucun chargement réseau, aucune origine à autoriser, et il illustre le cas
 * réel : un rectangle nettement plus large que haut.
 */
const DEMO_LOGO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80">' +
      '<rect width="300" height="80" rx="8" fill="#042F64"/>' +
      '<text x="150" y="52" font-family="sans-serif" font-size="30" ' +
      'fill="#ffffff" text-anchor="middle">TÉMOIN</text></svg>',
  );

/**
 * Jeu de démonstration des statistiques.
 *
 * Il existe pour la même raison que l'atelier lui-même : l'écran réel exige une
 * session ET des réponses en base, ce qui rendait impossible de vérifier une
 * décision de mise en forme — l'anneau sur fond marine, le débordement des
 * puces à 320 px — sans dépouiller un vrai formulaire.
 */
const DEMO_NOW = new Date('2026-09-07T10:00:00Z');
const DEMO_SURVEY = '11111111-2222-3333-4444-555555555555';

const DEMO_SCHEMA = (() => {
  const result = validateSurveySchema({
    version: 1,
    steps: [
      {
        id: 'etape_1',
        fields: [
          {
            id: 'presence',
            type: 'radio',
            label: 'Serez-vous présent ?',
            options: [
              { value: 'oui', label: 'Oui, je serai présent' },
              { value: 'non', label: 'Non, je ne pourrai pas venir' },
            ],
          },
          {
            id: 'accompagnants',
            type: 'number',
            label: 'Nombre de personnes vous accompagnant',
            min: 0,
            max: 6,
          },
          { id: 'nom', type: 'text', label: 'Nom et prénom' },
          { id: 'email', type: 'email', label: 'Adresse électronique' },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error('Schéma de démonstration invalide');
  return result.schema;
})();

const DEMO_ATTENDANCE: AttendanceSettings = {
  presenceField: 'presence',
  presenceValue: 'oui',
  partyField: 'accompagnants',
  partyMode: 'extra',
  identityField: 'nom',
  detailField: 'email',
  capacity: 40,
};

interface DemoGuest {
  readonly nom: string;
  readonly presence?: 'oui' | 'non';
  readonly accompagnants?: number;
  readonly at: string;
}

const DEMO_GUESTS: readonly DemoGuest[] = [
  { nom: 'Camille Arnoult', presence: 'oui', accompagnants: 2, at: '2026-09-06T09:00:00Z' },
  { nom: 'Nadia Belkacem', presence: 'oui', accompagnants: 0, at: '2026-09-06T14:00:00Z' },
  { nom: 'Thomas Reverdy', at: '2026-09-05T09:00:00Z' },
  { nom: 'Élodie Marchand', presence: 'oui', accompagnants: 1, at: '2026-09-04T09:00:00Z' },
  { nom: 'Karim Zebiri', presence: 'non', at: '2026-09-03T09:00:00Z' },
  { nom: 'Hélène Sauvage', presence: 'oui', accompagnants: 3, at: '2026-09-02T09:00:00Z' },
  { nom: 'Pierre Lemoine', presence: 'oui', accompagnants: 1, at: '2026-09-01T09:00:00Z' },
];

const DEMO_RESPONSES = DEMO_GUESTS.map((guest, index) => ({
  id: `demo-${index}`,
  submitted_at: guest.at,
  data: {
    nom: guest.nom,
    email: `${guest.nom.split(' ')[0]?.toLocaleLowerCase('fr-FR')}@exemple.test`,
    ...(guest.presence ? { presence: guest.presence } : {}),
    ...(guest.accompagnants === undefined ? {} : { accompagnants: guest.accompagnants }),
  },
}));

const DEMO_PACE = responsePace(DEMO_RESPONSES, {
  now: DEMO_NOW,
  window: '7j',
  timeZone: 'Europe/Paris',
});
const DEMO_TOTALS = countAttendance(DEMO_SCHEMA, DEMO_ATTENDANCE, DEMO_RESPONSES);
const DEMO_VIEW = parseStatisticsView({ onglet: 'invites' });
const DEMO_LIST: GuestListModel = guestList(
  DEMO_SCHEMA,
  DEMO_ATTENDANCE,
  DEMO_RESPONSES,
  { filter: DEMO_VIEW.filter },
);

/**
 * Invitation de démonstration : tous les blocs ouverts à la fois.
 *
 * C'est le seul endroit où l'on peut les voir ENSEMBLE — la page réelle
 * n'affiche que ce que l'organisation a laissé ouvert, et il faudrait un
 * formulaire publié pour la charger. L'atelier existe précisément pour ça.
 */
const DEMO_INVITATION = {
  branding: {
    organisationName: 'Organisation Témoin',
    logoUrl: DEMO_LOGO,
    bannerUrl: null,
  },
  status: 'Inscriptions ouvertes',
  badge: 'Inscription',
  title: 'Une soirée d’exception pour nos 180 ans',
  description: 'Exposition privée, dîner d’honneur et soirée dansante.',
  when: 'mercredi 18 novembre 2026 à 19:30',
  whenNote: 'Fin prévue à 00:30',
  place: {
    label: 'Musée Jacquemart-André',
    address: '158 bd Haussmann, 75008 Paris',
  },
  countdown: {
    startsAt: '2026-11-18T18:30:00Z',
    initial: countdownParts('2026-11-18T18:30:00Z', DEMO_NOW)!,
  },
  responseCount: 248,
  deadline: '30 octobre 2026',
  details: [
    { label: 'Tenue de soirée souhaitée', value: 'Vestiaire et voiturier sur place' },
    { label: 'Badge à présenter à l’accueil' },
  ],
  organiserWord: {
    author: 'L’équipe de direction',
    role: 'Organisateur',
    text: 'Pour célébrer les 180 ans de notre groupe, nous avons le plaisir de vous convier à une soirée d’exception.\n\nLes places étant limitées, merci de confirmer votre présence avant le 30 octobre.',
  },
  programme: [
    { time: '19h30', title: 'Accueil & exposition privée', note: 'Cocktail dans la cour d’honneur.' },
    { time: '20h15', title: 'Prise de parole des dirigeants' },
    { time: '21h00', title: 'Dîner d’honneur', note: 'Placement nominatif dans la galerie.' },
    { title: 'Soirée dansante', note: 'Dernier service à 00h15.' },
  ],
  calendar: { google: '#', outlook: '#', ics: '#' },
  directions: { google: '#', openStreetMap: '#', apple: '#' },
  travelNote: 'Métro Miromesnil (9 · 13) à 4 min · parking Haussmann-Berri.',
  faq: [
    {
      question: 'Puis-je venir accompagné ?',
      answer: 'Oui, dans la limite des places disponibles. Indiquez-le au moment de l’inscription.',
    },
    {
      question: 'Comment modifier ma réponse ?',
      answer: 'Rouvrez ce lien : votre réponse s’affiche et reste modifiable.',
    },
  ],
  shareUrl: 'https://spankio.test/s/organisation-temoin/invitation-180-ans',
  privacyNote:
    'Les données enregistrées sont celles des champs de ce formulaire ; aucune donnée technique de traçage n’est collectée.',
  ctaLabel: 'Je m’inscris',
};

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
          <h2 className="sp-section__title">Marque d’une organisation</h2>
          <p className="sp-section__lead">
            Le logo déposé dans le profil de l’organisation, ou son initiale à défaut.
            Un logo est presque toujours plus large que haut : seule sa hauteur est
            contrainte.
          </p>
          <div className="sp-card">
            <div className="sp-sidebar" style={{ maxWidth: 'var(--sp-sidebar-w)', border: 0 }}>
              <span className="sp-sidebar__brand">
                <BrandMark
                  className="sp-sidebar__mark"
                  logoUrl={DEMO_LOGO}
                  name="Organisation Témoin"
                />
                <span className="sp-sidebar__name">Avec un logo</span>
              </span>
              <span className="sp-sidebar__brand">
                <BrandMark className="sp-sidebar__mark" name="Organisation Témoin" />
                <span className="sp-sidebar__name">Sans logo</span>
              </span>
            </div>
          </div>
        </section>

        <section className="sp-section">
          <h2 className="sp-section__title">Statistiques d’un événement</h2>
          <p className="sp-section__lead">
            Un chiffre domine, tout le reste l’explique. Les tracés — anneau, barre
            empilée, courbe — ne portent aucune information à eux seuls : chaque
            valeur est écrite.
          </p>
          <div
            className="sp-stack"
            style={{ '--sp-stack-gap': 'var(--sp-space-4)' } as React.CSSProperties}
          >
            <StatisticsTabs current="apercu" surveyId={DEMO_SURVEY} view={DEMO_VIEW} />
            <EventOverview
              capacity={DEMO_ATTENDANCE.capacity ?? null}
              companions={Math.max(0, DEMO_TOTALS.people - DEMO_TOTALS.attending)}
              delta={{ responses: 2, people: 3 }}
              insights={eventInsights({
                totals: DEMO_TOTALS,
                responseCount: DEMO_RESPONSES.length,
                capacity: DEMO_ATTENDANCE.capacity ?? null,
                pace: DEMO_PACE,
                countdown: {
                  badge: 'J-12',
                  label: 'Dans 12 jours',
                  days: 12,
                  past: false,
                },
              })}
              pace={DEMO_PACE}
              party={{
                label: 'Nombre de personnes vous accompagnant',
                average: 1.4,
                unit: null,
                distribution: [
                  { value: 0, count: 1 },
                  { value: 1, count: 2 },
                  { value: 2, count: 1 },
                  { value: 3, count: 1 },
                ],
              }}
              responseCount={DEMO_RESPONSES.length}
              settingsHref="#"
              surveyId={DEMO_SURVEY}
              totals={DEMO_TOTALS}
            />
          </div>
        </section>

        <section className="sp-section">
          <h2 className="sp-section__title">Liste d’accueil</h2>
          <p className="sp-section__lead">
            Une rangée par réponse : un nom, un statut, un effectif. Les puces
            défilent plutôt que de se replier sur trois lignes.
          </p>
          <GuestList
            counting
            list={DEMO_LIST}
            named
            rows={DEMO_LIST.rows}
            settingsHref="#"
            surveyId={DEMO_SURVEY}
            view={DEMO_VIEW}
          />
        </section>

        <section className="sp-section">
          <h2 className="sp-section__title">Invitation publique</h2>
          <p className="sp-section__lead">
            Tous les blocs ouverts à la fois. Sur une page réelle, l’organisation
            n’en laisse que ceux qu’elle veut — et un bloc sans contenu ne s’affiche
            pas, même ouvert.
          </p>
          <InvitationDemo content={DEMO_INVITATION} />
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
