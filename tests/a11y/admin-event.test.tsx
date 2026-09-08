import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BannerUpload } from '@/components/admin/BannerUpload';
import { EventSettings, type EventDraft } from '@/components/admin/EventSettings';
import { LocationPicker } from '@/components/admin/LocationPicker';
import { validateSurveySchema } from '@/lib/survey/schema';
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

/**
 * Double de Leaflet qui reproduit UNE invariante du vrai : une carte ne se
 * démonte qu'une fois.
 *
 * Leaflet compare l'identifiant qu'il a mémorisé à celui du conteneur ; le
 * premier `remove()` effaçant ce dernier, un second appel lève « Map container
 * is being reused by another instance ». Un double qui accepterait deux
 * `remove()` laisserait passer exactement le défaut qui produisait une page
 * blanche en production.
 */
const leafletState = { maps: 0, removes: 0 };

vi.mock('leaflet', () => {
  const marker = {
    addTo: () => marker,
    on: () => marker,
    setLatLng: () => marker,
    setOpacity: () => marker,
    getLatLng: () => ({ lat: 0, lng: 0 }),
  };

  const makeMap = () => {
    let removed = false;
    const map = {
      setView: () => map,
      on: () => map,
      getZoom: () => 12,
      remove: () => {
        if (removed) {
          throw new Error('Map container is being reused by another instance');
        }
        removed = true;
        leafletState.removes += 1;
      },
    };
    return map;
  };

  return {
    map: () => {
      leafletState.maps += 1;
      return makeMap();
    },
    tileLayer: () => ({ addTo: () => ({}) }),
    divIcon: () => ({}),
    marker: () => marker,
  };
});

vi.mock('leaflet/dist/leaflet.css', () => ({}));

const schema = (() => {
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
              { value: 'oui', label: 'Oui' },
              { value: 'non', label: 'Non' },
            ],
          },
          {
            id: 'accompagnants',
            type: 'select',
            label: 'Combien vous accompagnent ?',
            options: [
              { value: 'a0', label: '0' },
              { value: 'a2', label: '2' },
            ],
          },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error('Schéma de test invalide');
  return result.schema;
})();

const draft: EventDraft = {
  attendance: {},
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
      <EventSettings
        organisationId={ORG}
        schema={schema}
        surveyDescription="Une soirée d’exception."
        organisationName="Organisation Témoin"
        publicUrl="https://exemple.test/s/org/invitation"
        surveyId={SURVEY}
        initial={draft}
        onSave={saved}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Latitude')).toBeTruthy());
    await expectNoA11yViolations(container);
  });

  it('affiche l’horaire dans le fuseau de l’événement, pas celui du poste', () => {
    render(
      <EventSettings
        organisationId={ORG}
        schema={schema}
        surveyDescription="Une soirée d’exception."
        organisationName="Organisation Témoin"
        publicUrl="https://exemple.test/s/org/invitation"
        surveyId={SURVEY}
        initial={draft}
        onSave={saved}
      />,
    );
    // 08:00 UTC le 1er juin, c'est 10 h à Paris.
    const start: HTMLInputElement = screen.getByLabelText(/^Début/);
    expect(start.value).toBe('2027-06-01T10:00');
  });

  it('recalcule l’instant quand le fuseau change, en gardant l’heure affichée', async () => {
    const user = userEvent.setup();
    render(
      <EventSettings
        organisationId={ORG}
        schema={schema}
        surveyDescription="Une soirée d’exception."
        organisationName="Organisation Témoin"
        publicUrl="https://exemple.test/s/org/invitation"
        surveyId={SURVEY}
        initial={draft}
        onSave={saved}
      />,
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
        schema={schema}
        surveyDescription="Une soirée d’exception."
        organisationName="Organisation Témoin"
        publicUrl="https://exemple.test/s/org/invitation"
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
      <EventSettings
        organisationId={ORG}
        schema={schema}
        surveyDescription="Une soirée d’exception."
        organisationName="Organisation Témoin"
        publicUrl="https://exemple.test/s/org/invitation"
        surveyId={SURVEY}
        initial={draft}
        onSave={saved}
      />,
    );

    const end = screen.getByLabelText(/^Fin/);
    await user.clear(end);
    await user.type(end, '2027-05-01T09:00');

    expect(await screen.findByText('La fin précède le début.')).toBeTruthy();
  });
});

describe('comptage des présents', () => {
  it('ne propose le comptage qu’à partir des questions du formulaire', async () => {
    const user = userEvent.setup();
    render(
      <EventSettings
        organisationId={ORG}
        schema={schema}
        surveyDescription="Une soirée d’exception."
        organisationName="Organisation Témoin"
        publicUrl="https://exemple.test/s/org/invitation"
        surveyId={SURVEY}
        initial={draft}
        onSave={saved}
      />,
    );

    // Seules les questions à choix unique peuvent dire « je viens » : une
    // réponse libre ne se compare pas de façon fiable.
    const presence = screen.getByLabelText(/Question qui dit si la personne vient/);
    expect([...presence.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Ne pas compter les présents',
      'Serez-vous présent ?',
      'Combien vous accompagnent ?',
    ]);

    await user.selectOptions(presence, 'presence');
    // La valeur attendue est préremplie : un comptage à moitié configuré ne
    // se déclencherait jamais.
    expect(screen.getByLabelText(/Réponse qui signifie/)).toHaveValue('oui');
  });

  it('réinitialise la réponse attendue quand la question change', async () => {
    const user = userEvent.setup();
    render(
      <EventSettings
        organisationId={ORG}
        schema={schema}
        surveyDescription="Une soirée d’exception."
        organisationName="Organisation Témoin"
        publicUrl="https://exemple.test/s/org/invitation"
        surveyId={SURVEY}
        initial={{
          ...draft,
          attendance: { presenceField: 'presence', presenceValue: 'oui' },
        }}
        onSave={saved}
      />,
    );

    // « oui » n'existe pas dans l'autre question : la conserver produirait un
    // comptage muet.
    await user.selectOptions(
      screen.getByLabelText(/Question qui dit si la personne vient/),
      'accompagnants',
    );
    expect(screen.getByLabelText(/Réponse qui signifie/)).toHaveValue('a0');
  });

  it('demande si le nombre compte les accompagnants ou le total', async () => {
    const user = userEvent.setup();
    render(
      <EventSettings
        organisationId={ORG}
        schema={schema}
        surveyDescription="Une soirée d’exception."
        organisationName="Organisation Témoin"
        publicUrl="https://exemple.test/s/org/invitation"
        surveyId={SURVEY}
        initial={{
          ...draft,
          attendance: { presenceField: 'presence', presenceValue: 'oui' },
        }}
        onSave={saved}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText(/Question donnant le nombre de personnes/),
      'accompagnants',
    );
    // Sans cette question, « 2 » vaudrait deux ou trois personnes selon la
    // lecture — et personne ne saurait laquelle.
    expect(screen.getByRole('group', { name: 'Ce nombre compte…' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Les accompagnants/ })).toBeTruthy();
  });

  it('dit ce que coûte une question d’effectif FACULTATIVE', async () => {
    // Défaut réel rencontré en production : « Nombre de personnes vous
    // accompagnant » était facultative, une invitée a annoncé venir
    // accompagnée sans dire de combien, et sa réponse est ressortie « à
    // vérifier » sans que personne ne comprenne pourquoi.
    const user = userEvent.setup();
    render(
      <EventSettings
        organisationId={ORG}
        schema={schema}
        surveyDescription="Une soirée d’exception."
        organisationName="Organisation Témoin"
        publicUrl="https://exemple.test/s/org/invitation"
        surveyId={SURVEY}
        initial={{
          ...draft,
          attendance: { presenceField: 'presence', presenceValue: 'oui' },
        }}
        onSave={saved}
      />,
    );

    expect(screen.queryByText(/Cette question est/)).toBeNull();

    await user.selectOptions(
      screen.getByLabelText(/Question donnant le nombre de personnes/),
      'accompagnants',
    );

    expect(screen.getByText(/un invité peut/)).toBeTruthy();
    expect(screen.getByText(/à vérifier/)).toBeTruthy();
  });

  it('ne signale aucune violation, comptage configuré', async () => {
    const { container } = render(
      <EventSettings
        organisationId={ORG}
        schema={schema}
        surveyDescription="Une soirée d’exception."
        organisationName="Organisation Témoin"
        publicUrl="https://exemple.test/s/org/invitation"
        surveyId={SURVEY}
        initial={{
          ...draft,
          attendance: {
            presenceField: 'presence',
            presenceValue: 'oui',
            partyField: 'accompagnants',
            partyMode: 'extra',
          },
        }}
        onSave={saved}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Latitude')).toBeTruthy());
    await expectNoA11yViolations(container);
  });
});

describe('note ajoutée à l’agenda', () => {
  const context = {
    surveyDescription: 'Une soirée d’exception.',
    organisationName: 'Organisation Témoin',
    publicUrl: 'https://exemple.test/s/org/invitation',
  };

  function renderSettings(initial: EventDraft) {
    return render(
      <EventSettings
        organisationId={ORG}
        schema={schema}
        surveyDescription={context.surveyDescription}
        organisationName={context.organisationName}
        publicUrl={context.publicUrl}
        surveyId={SURVEY}
        initial={initial}
        onSave={saved}
      />,
    );
  }

  it('affiche par défaut le texte automatique, et l’aperçu le montre', () => {
    renderSettings(draft);

    const auto: HTMLInputElement = screen.getByRole('radio', { name: /Texte automatique/ });
    expect(auto.checked).toBe(true);
    // L'aperçu vient de la MÊME fonction que les liens d'agenda : il ne peut
    // pas montrer autre chose que ce que recevra le répondant.
    expect(screen.getByText(/Une soirée d’exception\./)).toBeTruthy();
    expect(screen.getByText(/Organisé par Organisation Témoin/)).toBeTruthy();
    expect(screen.getByText(new RegExp(context.publicUrl))).toBeTruthy();
  });

  it('part du texte automatique quand on passe en note personnalisée', async () => {
    // Commencer d'une page blanche ferait perdre le lien vers l'invitation
    // sans que personne s'en aperçoive.
    const user = userEvent.setup();
    renderSettings(draft);

    await user.click(screen.getByRole('radio', { name: /Note personnalisée/ }));
    const zone: HTMLTextAreaElement = screen.getByLabelText('Votre note');
    expect(zone.value).toContain('Une soirée d’exception.');
    expect(zone.value).toContain(context.publicUrl);
  });

  it('remplace entièrement le texte automatique', async () => {
    const user = userEvent.setup();
    const { container } = renderSettings({
      ...draft,
      eventDetails: 'Tenue de ville. Accueil dès 19 h.',
    });

    const custom: HTMLInputElement = screen.getByRole('radio', { name: /Note personnalisée/ });
    expect(custom.checked).toBe(true);

    // L'aperçu ne porte QUE la note : ni mention d'organisateur, ni lien
    // ajoutés dans le dos de l'organisation. On le lit dans l'aperçu, la note
    // figurant aussi dans la zone de saisie.
    const preview = container.querySelector('.sp-note-preview__body');
    expect(preview?.textContent).toBe('Tenue de ville. Accueil dès 19 h.');
    expect(screen.queryByText(/Organisé par/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reprendre le texte automatique' }));
    const zone: HTMLTextAreaElement = screen.getByLabelText('Votre note');
    expect(zone.value).toContain(context.publicUrl);
  });

  it('revient au texte automatique en changeant de mode', async () => {
    const user = userEvent.setup();
    renderSettings({ ...draft, eventDetails: 'Ma note.' });

    await user.click(screen.getByRole('radio', { name: /Texte automatique/ }));
    expect(screen.queryByLabelText('Votre note')).toBeNull();
    expect(screen.getByText(/Organisé par Organisation Témoin/)).toBeTruthy();
  });

  it('annonce un rendez-vous muet plutôt que de le laisser deviner', () => {
    // Sans description, sans organisateur et sans lien, il n'y a rien à
    // déposer : le dire vaut mieux qu'un aperçu vide.
    render(
      <EventSettings
        organisationId={ORG}
        schema={schema}
        surveyDescription={null}
        organisationName=""
        publicUrl=""
        surveyId={SURVEY}
        initial={{ ...draft, eventOrganiser: null }}
        onSave={saved}
      />,
    );
    expect(screen.getByText(/n’aura ni description ni lien de retour/)).toBeTruthy();
  });

  it('ne signale aucune violation, note personnalisée ouverte', async () => {
    const { container } = renderSettings({ ...draft, eventDetails: 'Ma note.' });
    await waitFor(() => expect(screen.getByLabelText('Latitude')).toBeTruthy());
    await expectNoA11yViolations(container);
  });
});

describe('cycle de vie de la carte', () => {
  it('ne démonte la carte qu’UNE fois', async () => {
    // Défaut réel corrigé : le nettoyage appelait `remove()` deux fois sur la
    // même carte, ce qui faisait lever Leaflet et affichait une page blanche
    // au retour depuis l'écran de l'événement.
    leafletState.maps = 0;
    leafletState.removes = 0;

    const { unmount } = render(<LocationPicker value={null} onChange={() => {}} />);
    await waitFor(() => expect(leafletState.maps).toBe(1));

    expect(() => unmount()).not.toThrow();
    expect(leafletState.removes).toBe(1);
  });

  it('remonte proprement après un démontage', async () => {
    // Aller sur l'écran, revenir, y retourner : le geste qui a révélé le
    // défaut.
    leafletState.maps = 0;
    leafletState.removes = 0;

    for (let pass = 0; pass < 3; pass += 1) {
      const { unmount } = render(<LocationPicker value={null} onChange={() => {}} />);
      await waitFor(() => expect(leafletState.maps).toBe(pass + 1));
      expect(() => unmount()).not.toThrow();
    }
    expect(leafletState.removes).toBe(3);
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
