import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventOverview } from '@/components/admin/EventOverview';
import { GuestList } from '@/components/admin/GuestList';
import { StatisticsPanel } from '@/components/admin/StatisticsPanel';
import { StatisticsTabs } from '@/components/admin/StatisticsTabs';
import { parseStatisticsView } from '@/lib/admin/statistics-view';
import { countdown } from '@/lib/event/countdown';
import { guestList } from '@/lib/survey/guests';
import { eventInsights } from '@/lib/survey/insights';
import { responsePace } from '@/lib/survey/pace';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';
import { computeStatistics } from '@/lib/survey/statistics';
import { countAttendance, type AttendanceSettings } from '@/lib/survey/attendance';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Accessibilité de l'écran des statistiques.
 *
 * Ce qui est réellement vérifié ici, au-delà d'axe : que **rien n'est porté par
 * la seule couleur ni par la seule longueur d'un tracé**. Un anneau, une barre
 * empilée et une courbe ne disent rien à qui ne les voit pas ; ces tests
 * exigent donc que chaque chiffre soit aussi ÉCRIT, et que les graphiques
 * soient marqués `aria-hidden` plutôt que laissés à l'interprétation d'un
 * lecteur d'écran.
 */

const SURVEY_ID = '11111111-2222-3333-4444-555555555555';
const now = new Date('2026-09-07T10:00:00Z');

const schema: SurveySchema = (() => {
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
            max: 10,
            unit: 'personnes',
          },
          { id: 'nom', type: 'text', label: 'Nom et prénom' },
          { id: 'email', type: 'email', label: 'Adresse électronique' },
          { id: 'remarque', type: 'textarea', label: 'Remarque' },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
})();

const settings: AttendanceSettings = {
  presenceField: 'presence',
  presenceValue: 'oui',
  partyField: 'accompagnants',
  partyMode: 'extra',
  identityField: 'nom',
  detailField: 'email',
  capacity: 30,
};

const responses = [
  {
    id: 'r1',
    submitted_at: '2026-09-06T09:00:00Z',
    data: { presence: 'oui', accompagnants: 2, nom: 'Camille Arnoult', email: 'c@exemple.test' },
  },
  {
    id: 'r2',
    submitted_at: '2026-09-05T09:00:00Z',
    data: { presence: 'non', nom: 'Karim Zebiri', email: 'k@exemple.test' },
  },
  {
    id: 'r3',
    submitted_at: '2026-09-04T09:00:00Z',
    data: { presence: 'oui', nom: 'Élodie Marchand', email: 'e@exemple.test' },
  },
  { id: 'r4', submitted_at: '2026-08-01T09:00:00Z', data: { nom: 'Thomas Reverdy' } },
];

const pace = responsePace(responses, { now, window: '7j', timeZone: 'Europe/Paris' });
const totals = countAttendance(schema, settings, responses);
const clock = countdown('2026-09-19T17:00:00Z', { now, timeZone: 'Europe/Paris' });

function overview() {
  return (
    <EventOverview
      capacity={30}
      companions={Math.max(0, totals.people - totals.attending)}
      delta={{ responses: 3, people: 4 }}
      insights={eventInsights({
        totals,
        responseCount: responses.length,
        capacity: 30,
        pace,
        countdown: clock,
      })}
      pace={pace}
      party={{
        label: 'Nombre de personnes vous accompagnant',
        average: 1,
        unit: 'personnes',
        distribution: [
          { value: 0, count: 1 },
          { value: 1, count: 0 },
          { value: 2, count: 1 },
        ],
      }}
      responseCount={responses.length}
      settingsHref={`/admin/sondages/${SURVEY_ID}/evenement`}
      surveyId={SURVEY_ID}
      totals={totals}
    />
  );
}

describe('vue d’ensemble', () => {
  it('ne signale aucune violation', async () => {
    const { container } = render(overview());
    await expectNoA11yViolations(container);
  });

  it('écrit l’effectif attendu, sans le laisser à l’anneau', () => {
    const { container } = render(overview());
    // 1 (présent seul) + 3 (présent avec 2 accompagnants) = 4 personnes.
    expect(totals.people).toBe(4);
    expect(container.querySelector('.sp-figure__value')?.textContent).toContain('4');
    expect(container.querySelector('.sp-figure__note')?.textContent).toContain(
      'accompagnants compris',
    );
    // Le pourcentage de l'anneau est du TEXTE, pas un tracé : 4 sur 30 = 13 %.
    expect(container.querySelector('.sp-donut__value')?.textContent).toContain('13');
  });

  it('écrit chaque segment de la barre de répartition', () => {
    render(overview());
    for (const label of [
      /Annoncent une présence/,
      /Déclinent l’invitation/,
      /Sans présence indiquée/,
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('masque les tracés aux lecteurs d’écran et énumère les mêmes chiffres en texte', () => {
    const { container } = render(overview());
    // Courbe, barre empilée et anneaux : décoratifs, donc masqués.
    expect(container.querySelector('.sp-spark')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.sp-split')?.getAttribute('aria-hidden')).toBe('true');
    for (const svg of container.querySelectorAll('.sp-donut svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
    // Chaque seau du graphique est repris en clair.
    const written = container.querySelectorAll('dl.sp-visually-hidden dt');
    expect(written).toHaveLength(pace.buckets.length);
  });

  it('dit ce qui manque plutôt que d’afficher un effectif inventé', async () => {
    const { container } = render(
      <EventOverview
        capacity={null}
        companions={null}
        delta={null}
        insights={[]}
        pace={pace}
        party={null}
        responseCount={responses.length}
        settingsHref={`/admin/sondages/${SURVEY_ID}/evenement`}
        surveyId={SURVEY_ID}
        totals={null}
      />,
    );
    expect(screen.getByText(/Aucun effectif calculé/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Désigner la question de présence/i })).toBeTruthy();
    await expectNoA11yViolations(container);
  });
});

describe('onglets', () => {
  it('ne signale aucune violation et désigne la vue courante autrement que par la couleur', async () => {
    const view = parseStatisticsView({ onglet: 'invites' });
    const { container } = render(
      <StatisticsTabs current={view.tab} surveyId={SURVEY_ID} view={view} />,
    );
    const current = screen.getByRole('link', { current: 'page' });
    expect(current.textContent).toBe('Invités');
    await expectNoA11yViolations(container);
  });

  it('conserve la période choisie en changeant d’onglet', () => {
    const view = parseStatisticsView({ periode: '30j' });
    render(<StatisticsTabs current={view.tab} surveyId={SURVEY_ID} view={view} />);
    expect(
      screen.getByRole('link', { name: 'Invités' }).getAttribute('href'),
    ).toContain('periode=30j');
  });
});

describe('liste d’accueil', () => {
  const view = parseStatisticsView({ onglet: 'invites' });
  const list = guestList(schema, settings, responses, { filter: view.filter });

  function guests(overrides: Partial<Parameters<typeof GuestList>[0]> = {}) {
    return (
      <GuestList
        counting
        deleteAction={() => {}}
        list={list}
        named
        rows={list.rows}
        settingsHref={`/admin/sondages/${SURVEY_ID}/evenement`}
        surveyId={SURVEY_ID}
        view={view}
        {...overrides}
      />
    );
  }

  it('ne signale aucune violation', async () => {
    const { container } = render(guests());
    await expectNoA11yViolations(container);
  });

  it('donne un nom accessible à chaque suppression : « Supprimer » seul serait ambigu', () => {
    render(guests());
    expect(
      screen.getByRole('button', { name: /Supprimer la réponse de Camille Arnoult/i }),
    ).toBeTruthy();
  });

  it('porte le statut par un MOT, jamais par la seule couleur', () => {
    render(guests());
    // Deux présents, un déclinant, une réponse sans présence indiquée. Les
    // mêmes mots servent de puces de filtre : on compte donc les pastilles.
    const pills = (label: string) =>
      screen
        .getAllByText(label)
        .filter((node) => node.className.startsWith('sp-pill'));
    expect(pills('Présent')).toHaveLength(2);
    expect(pills('Décline')).toHaveLength(1);
    expect(pills('Sans réponse')).toHaveLength(1);
  });

  it('a un champ de recherche étiqueté, dans une région de recherche', () => {
    render(guests());
    expect(screen.getByRole('search')).toBeTruthy();
    expect(screen.getByLabelText(/Rechercher dans les réponses/i)).toBeTruthy();
  });

  it('dit ce qui manque quand aucune question ne nomme l’invité', async () => {
    const anonymous = guestList(
      schema,
      { presenceField: 'presence', presenceValue: 'oui' },
      responses,
    );
    const { container } = render(
      guests({ named: false, list: anonymous, rows: anonymous.rows }),
    );
    expect(screen.getByRole('link', { name: /Désigner la question du nom/i })).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it('propose une issue quand la recherche ne trouve rien', async () => {
    const empty = guestList(schema, settings, responses, { search: 'zzz' });
    const { container } = render(
      guests({
        list: empty,
        rows: empty.rows,
        view: parseStatisticsView({ onglet: 'invites', q: 'zzz' }),
      }),
    );
    expect(screen.getByText(/Aucune réponse ne contient/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Effacer' })).toBeTruthy();
    await expectNoA11yViolations(container);
  });
});

describe('questions', () => {
  it('ne signale aucune violation, et regroupe les champs libres', async () => {
    const { container } = render(
      <StatisticsPanel
        guestsHref={`/admin/sondages/${SURVEY_ID}/reponses?onglet=invites`}
        statistics={computeStatistics(schema, responses)}
      />,
    );
    // Trois champs libres, une seule carte : leurs intitulés sont joints.
    expect(screen.getByText('Nom et prénom · Adresse électronique · Remarque')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Voir la liste des réponses/i })).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it('n’affiche AUCUN contenu de réponse libre', () => {
    render(
      <StatisticsPanel
        guestsHref="/x"
        statistics={computeStatistics(schema, responses)}
      />,
    );
    for (const secret of ['Camille Arnoult', 'c@exemple.test', 'Élodie Marchand']) {
      expect(screen.queryByText(secret)).toBeNull();
    }
  });
});
