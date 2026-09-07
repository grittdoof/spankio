import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Invitation } from '@/components/public/Invitation';
import { countdownParts } from '@/lib/event/countdown';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Accessibilité de l'invitation publique.
 *
 * Deux propriétés sont vérifiées au-delà d'axe, parce qu'elles ne s'attrapent
 * pas autrement :
 *
 *  1. **Un bloc absent ne laisse AUCUN titre orphelin.** Le filtrage vit dans
 *     la page, pas ici : ces tests confirment que le composant obéit, et
 *     n'invente ni section vide ni intitulé isolé.
 *  2. **Le compte à rebours ne parle pas.** Un compteur de secondes annoncé
 *     interromprait le lecteur d'écran une fois par seconde. Les chiffres sont
 *     masqués, la phrase écrite n'est pas une zone live.
 */

const branding = {
  organisationName: 'Organisation Témoin',
  logoUrl: null,
  bannerUrl: null,
};

const now = new Date('2026-09-07T10:00:00Z');
const initial = countdownParts('2026-11-18T18:30:00Z', now)!;

const full = {
  branding,
  status: 'Inscriptions ouvertes',
  badge: 'Inscription',
  title: 'Une soirée d’exception pour nos 180 ans',
  description: 'Exposition privée, dîner d’honneur et soirée dansante.',
  when: 'mercredi 18 novembre 2026 à 19:30',
  whenNote: 'Fin prévue à 00:30',
  place: { label: 'Musée Jacquemart-André', address: '158 bd Haussmann, 75008 Paris' },
  countdown: { startsAt: '2026-11-18T18:30:00Z', initial },
  responseCount: 248,
  deadline: '30 octobre 2026',
  details: [{ label: 'Tenue de soirée souhaitée', value: 'Vestiaire sur place' }],
  organiserWord: {
    author: 'L’équipe de direction',
    role: 'Organisateur',
    text: 'Premier paragraphe.\n\nSecond paragraphe.',
  },
  programme: [
    { time: '19h30', title: 'Accueil', note: 'Cocktail dans la cour.' },
    { title: 'Dîner d’honneur' },
  ],
  calendar: { google: 'https://x.test/g', outlook: 'https://x.test/o', ics: '/api/ics/1' },
  directions: {
    google: 'https://x.test/dg',
    openStreetMap: 'https://x.test/osm',
    apple: 'https://x.test/a',
  },
  travelNote: 'Métro Miromesnil (9 · 13) à 4 min.',
  faq: [{ question: 'Puis-je venir accompagné ?', answer: 'Oui, jusqu’à quatre personnes.' }],
  shareUrl: 'https://spankio.test/s/org/invitation',
  privacyNote: 'Les données enregistrées sont celles des champs de ce formulaire.',
  ctaLabel: 'Je m’inscris',
};

const noop = () => {};

describe('invitation complète', () => {
  it('ne signale aucune violation', async () => {
    const { container } = render(<Invitation {...full} onStart={noop} />);
    await expectNoA11yViolations(container);
  });

  it('affiche un seul titre de niveau 1 : celui de l’événement', () => {
    render(<Invitation {...full} onStart={noop} />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]!.textContent).toContain('180 ans');
  });

  it('porte l’état par un MOT, jamais par la seule couleur du point', () => {
    render(<Invitation {...full} onStart={noop} />);
    expect(screen.getByText('Inscriptions ouvertes')).toBeTruthy();
  });

  it('rend chaque paragraphe du mot de l’organisateur', () => {
    render(<Invitation {...full} onStart={noop} />);
    expect(screen.getByText('Premier paragraphe.')).toBeTruthy();
    expect(screen.getByText('Second paragraphe.')).toBeTruthy();
  });

  it('énumère le déroulé dans une liste ORDONNÉE : son ordre est l’information', () => {
    const { container } = render(<Invitation {...full} onStart={noop} />);
    const timeline = container.querySelector('ol.sp-timeline');
    expect(timeline).not.toBeNull();
    expect(timeline?.querySelectorAll('li')).toHaveLength(2);
  });

  it('ouvre une question fréquente au clavier, sans JavaScript maison', async () => {
    const user = userEvent.setup();
    const { container } = render(<Invitation {...full} onStart={noop} />);
    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    await user.click(screen.getByText('Puis-je venir accompagné ?'));
    expect(details?.open).toBe(true);
  });

  it('propose l’agenda et l’itinéraire AVANT l’inscription', () => {
    render(<Invitation {...full} onStart={noop} />);
    expect(screen.getByRole('link', { name: 'Google Agenda' })).toHaveAttribute(
      'href',
      'https://x.test/g',
    );
    expect(screen.getByRole('link', { name: 'Google Maps' })).toHaveAttribute(
      'href',
      'https://x.test/dg',
    );
  });

  it('déclenche l’inscription depuis l’appel à l’action', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<Invitation {...full} onStart={onStart} />);
    await user.click(screen.getByRole('button', { name: 'Je m’inscris' }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('écrit l’adresse de partage : c’est le seul partage qui marche partout', () => {
    render(<Invitation {...full} onStart={noop} />);
    expect(screen.getByText('https://spankio.test/s/org/invitation')).toBeTruthy();
  });
});

describe('compte à rebours', () => {
  it('masque les chiffres et n’annonce rien en continu', () => {
    const { container } = render(<Invitation {...full} onStart={noop} />);
    const cells = container.querySelector('.sp-countdown__cells');
    expect(cells?.getAttribute('aria-hidden')).toBe('true');
    // Aucune zone live : un compteur de secondes annoncé rendrait la page
    // inutilisable au lecteur d'écran.
    expect(container.querySelectorAll('.sp-countdown [aria-live]')).toHaveLength(0);
  });

  it('écrit la même information en une phrase, sans les secondes', () => {
    render(<Invitation {...full} onStart={noop} />);
    expect(screen.getByText(initial.label)).toBeTruthy();
    expect(initial.label).not.toMatch(/seconde/);
  });

  it('disparaît une fois l’échéance atteinte', () => {
    const reached = countdownParts('2026-09-07T09:00:00Z', now)!;
    const { container } = render(
      <Invitation
        {...full}
        countdown={{ startsAt: '2026-09-07T09:00:00Z', initial: reached }}
        onStart={noop}
      />,
    );
    expect(container.querySelector('.sp-countdown')).toBeNull();
  });
});

describe('blocs fermés', () => {
  const bare = {
    branding,
    title: 'Réunion d’information',
    ctaLabel: 'Commencer',
  };

  it('ne signale aucune violation avec le strict minimum', async () => {
    const { container } = render(<Invitation {...bare} onStart={noop} />);
    await expectNoA11yViolations(container);
  });

  it('ne laisse AUCUN titre orphelin', () => {
    render(<Invitation {...bare} onStart={noop} />);
    for (const orphan of [
      'Déroulé',
      'Questions fréquentes',
      'S’y rendre',
      'Ajouter à mon agenda',
      'Informations pratiques',
      'Partager cette invitation',
    ]) {
      expect(screen.queryByText(orphan)).toBeNull();
    }
  });

  it('n’invente ni compte à rebours, ni compteur, ni date limite', () => {
    const { container } = render(<Invitation {...bare} onStart={noop} />);
    expect(container.querySelector('.sp-countdown')).toBeNull();
    expect(screen.queryByText(/inscription déjà enregistrée/)).toBeNull();
    expect(screen.queryByText(/Réponse attendue/)).toBeNull();
  });

  it('garde l’appel à l’action : c’est la raison d’être de la page', () => {
    render(<Invitation {...bare} onStart={noop} />);
    expect(screen.getByRole('button', { name: 'Commencer' })).toBeTruthy();
  });

  it('affiche le nom de l’organisation même sans logo : une invitation a un émetteur', () => {
    render(<Invitation {...bare} onStart={noop} />);
    expect(screen.getByText('Organisation Témoin')).toBeTruthy();
  });
});
