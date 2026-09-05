import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BannerUpload } from '@/components/admin/BannerUpload';
import { EventSettings, type EventDraft } from '@/components/admin/EventSettings';
import { LocationPicker } from '@/components/admin/LocationPicker';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Accessibilité des réglages d'événement.
 *
 * Leaflet est REMPLACÉ par un double : jsdom n'a ni moteur de rendu ni
 * dimensions, et une carte réelle y produirait des échecs qui ne disent rien
 * du code. Ce qui est vérifié ici est justement ce qui reste quand la carte
 * n'est pas utilisable : la recherche d'adresse et les deux champs de
 * coordonnées, seuls chemins praticables au clavier. La carte elle-même n'est
 * pas couverte (risque R3).
 */

vi.mock('leaflet', () => {
  const chain = () => ({ addTo: () => marker, on: () => marker, setLatLng: () => marker, setOpacity: () => marker, getLatLng: () => ({ lat: 0, lng: 0 }) });
  const marker = chain();
  const map = {
    setView: () => map,
    on: () => map,
    remove: () => {},
    getZoom: () => 12,
  };
  return {
    map: () => map,
    tileLayer: () => ({ addTo: () => ({}) }),
    divIcon: () => ({}),
    marker: () => marker,
  };
});

vi.mock('leaflet/dist/leaflet.css', () => ({}));

const draft: EventDraft = {
  bannerPath: null,
  eventStartsAt: '2027-06-01T08:00:00.000Z',
  eventEndsAt: null,
  eventAllDay: false,
  eventTimezone: 'Europe/Paris',
  eventLocationLabel: 'Salle des fêtes',
  eventAddress: null,
  eventLat: null,
  eventLng: null,
  eventOrganiser: null,
  eventDetails: null,
};

const ORG = '11111111-1111-4111-8111-111111111111';
const SURVEY = '22222222-2222-4222-8222-222222222222';

const saved = () => Promise.resolve({ ok: true as const });

describe('accessibilité du panneau événement', () => {
  it('ne signale aucune violation', async () => {
    const { container } = render(
      <EventSettings organisationId={ORG} surveyId={SURVEY} initial={draft} onSave={saved} />,
    );
    await waitFor(() => expect(screen.getByLabelText('Latitude')).toBeTruthy());
    await expectNoA11yViolations(container);
  });

  it('affiche l’horaire dans le fuseau de l’événement, pas celui du poste', () => {
    render(
      <EventSettings organisationId={ORG} surveyId={SURVEY} initial={draft} onSave={saved} />,
    );
    // 08:00 UTC le 1er juin, c'est 10 h à Paris.
    const start: HTMLInputElement = screen.getByLabelText(/^Début/);
    expect(start.value).toBe('2027-06-01T10:00');
  });

  it('recalcule l’instant quand le fuseau change, en gardant l’heure affichée', async () => {
    const user = userEvent.setup();
    render(
      <EventSettings organisationId={ORG} surveyId={SURVEY} initial={draft} onSave={saved} />,
    );

    await user.selectOptions(screen.getByLabelText(/Fuseau horaire/), 'Europe/Lisbon');

    // L'heure de calendrier ne bouge pas : « 10 h », maintenant à Lisbonne.
    const start: HTMLInputElement = screen.getByLabelText(/^Début/);
    expect(start.value).toBe('2027-06-01T10:00');
  });

  it('propose le fuseau enregistré même s’il est absent de la liste du moteur', () => {
    // « UTC » est compris par le moteur mais absent de
    // `Intl.supportedValuesOf('timeZone')`. Sans garde-fou, la liste
    // afficherait sa première option et le premier enregistrement écraserait
    // le fuseau réel.
    render(
      <EventSettings
        organisationId={ORG}
        surveyId={SURVEY}
        initial={{ ...draft, eventTimezone: 'UTC' }}
        onSave={saved}
      />,
    );
    const select: HTMLSelectElement = screen.getByLabelText(/Fuseau horaire/);
    expect(select.value).toBe('UTC');
  });

  it('signale une fin antérieure au début', async () => {
    const user = userEvent.setup();
    render(
      <EventSettings organisationId={ORG} surveyId={SURVEY} initial={draft} onSave={saved} />,
    );

    const end = screen.getByLabelText(/^Fin/);
    await user.clear(end);
    await user.type(end, '2027-05-01T09:00');

    expect(await screen.findByText('La fin précède le début.')).toBeTruthy();
  });
});

describe('accessibilité du choix de lieu', () => {
  it('offre un chemin clavier complet, sans passer par la carte', async () => {
    const user = userEvent.setup();

    // Composant contrôlé, comme en production : sans état, chaque frappe
    // repartirait de la valeur initiale et le test ne prouverait rien.
    function Harness() {
      const [value, setValue] = useState<{ latitude: number; longitude: number } | null>(null);
      return (
        <>
          <LocationPicker value={value} onChange={setValue} />
          <output>{value ? `${value.latitude}/${value.longitude}` : 'aucun'}</output>
        </>
      );
    }

    render(<Harness />);
    await user.type(screen.getByLabelText('Latitude'), '45.5');
    await user.type(screen.getByLabelText('Longitude'), '4.8');

    expect(screen.getByRole('status').textContent).toBe('45.5/4.8');
  });

  it('ne signale aucune violation', async () => {
    const { container } = render(<LocationPicker value={null} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Latitude')).toBeTruthy());
    await expectNoA11yViolations(container);
  });

  it('décrit la carte au lieu de la présenter comme utilisable', () => {
    render(<LocationPicker value={{ latitude: 45.5, longitude: 4.5 }} onChange={() => {}} />);
    const map = screen.getByRole('img', { name: /Carte centrée sur la latitude 45.5/ });
    expect(map).toBeTruthy();
  });
});

describe('accessibilité du téléversement de bannière', () => {
  it('ne signale aucune violation', async () => {
    const { container } = render(
      <BannerUpload organisationId={ORG} surveyId={SURVEY} value={null} onChange={() => {}} />,
    );
    await expectNoA11yViolations(container);
  });

  it('annonce les formats et la taille acceptés', () => {
    render(
      <BannerUpload organisationId={ORG} surveyId={SURVEY} value={null} onChange={() => {}} />,
    );
    const input = screen.getByLabelText(/Bannière de l’événement/);
    expect(input.getAttribute('accept')).toContain('image/png');
    expect(input.getAttribute('accept')).not.toContain('svg');
    expect(screen.getByText(/3 Mio au maximum/)).toBeTruthy();
  });
});
