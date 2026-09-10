import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldInput } from '@/components/public/FieldInput';
import { SurveyRenderer } from '@/components/public/SurveyRenderer';
import { ConsentScreen, ThankYouScreen, WelcomeScreen } from '@/components/public/screens';
import { fr, responseErrorMessage } from '@/lib/i18n/fr';
import type { AttendanceSettings } from '@/lib/survey/attendance';
import { composeConsentNotice, consentCheckboxLabel } from '@/lib/survey/consent';
import { validateSurveySchema, type SurveyField, type SurveySchema } from '@/lib/survey/schema';
import { expectNoA11yViolations } from '../helpers/axe';

const noop = () => {};

function build(fields: unknown[]): SurveySchema {
  const result = validateSurveySchema({ version: 1, steps: [{ id: 'etape_1', fields }] });
  if (!result.ok) throw new Error(`Schéma de test invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
}

function fieldOf(schema: SurveySchema): SurveyField {
  return schema.steps[0]!.fields[0]!;
}

const notice = composeConsentNotice({
  organisationName: 'Organisation Témoin',
  purpose: 'Recenser un besoin',
  legalBasis: 'consent',
  retentionDays: 365,
  recipients: 'Service organisateur',
});

const branding = { organisationName: 'Organisation Témoin', logoUrl: null, bannerUrl: null };

describe('accessibilité des champs', () => {
  const cases: Array<[string, unknown]> = [
    ['texte', { id: 'nom', type: 'text', label: 'Votre nom', required: true }],
    ['zone de texte', { id: 'avis', type: 'textarea', label: 'Votre avis' }],
    ['adresse', { id: 'email', type: 'email', label: 'Adresse électronique' }],
    ['téléphone', { id: 'tel', type: 'tel', label: 'Téléphone' }],
    ['nombre', { id: 'n', type: 'number', label: 'Combien ?', min: 1, max: 9 }],
    ['date', { id: 'jour', type: 'date', label: 'Quel jour ?' }],
    [
      'liste déroulante',
      {
        id: 'choix',
        type: 'select',
        label: 'Votre choix',
        options: [
          { value: 'a', label: 'Option A' },
          { value: 'b', label: 'Option B' },
        ],
      },
    ],
    [
      'choix unique',
      {
        id: 'venue',
        type: 'radio',
        label: 'Venez-vous ?',
        options: [
          { value: 'oui', label: 'Oui' },
          { value: 'non', label: 'Non' },
        ],
      },
    ],
    [
      'choix multiple',
      {
        id: 'jours',
        type: 'checkbox',
        label: 'Quels jours ?',
        options: [
          { value: 'lundi', label: 'Lundi' },
          { value: 'mardi', label: 'Mardi' },
        ],
      },
    ],
    ['échelle', { id: 'note', type: 'scale', label: 'Votre note', min: 1, max: 5 }],
    [
      'grille',
      {
        id: 'dispos',
        type: 'checkbox_grid',
        label: 'Vos disponibilités',
        rows: [{ value: 'lundi', label: 'Lundi' }],
        columns: [
          { value: 'matin', label: 'Matin' },
          { value: 'apres_midi', label: 'Après-midi' },
        ],
      },
    ],
  ];

  it.each(cases)('%s : aucune violation axe', async (_label, definition) => {
    const schema = build([definition]);
    const { container } = render(
      <FieldInput field={fieldOf(schema)} value={undefined} otherValue="" onChange={noop} />,
    );
    await expectNoA11yViolations(container);
  });

  it('un champ en erreur est marqué invalide et relié à son message', () => {
    const schema = build([{ id: 'nom', type: 'text', label: 'Votre nom', required: true }]);
    render(
      <FieldInput
        field={fieldOf(schema)}
        value=""
        otherValue=""
        error={fr.survey.errors.required}
        onChange={noop}
      />,
    );

    const input = screen.getByLabelText(/Votre nom/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(fr.survey.errors.required);
  });

  it('un groupe de choix est un vrai fieldset annoncé par sa légende', () => {
    const schema = build([
      {
        id: 'venue',
        type: 'radio',
        label: 'Venez-vous ?',
        options: [{ value: 'oui', label: 'Oui' }],
      },
    ]);
    render(<FieldInput field={fieldOf(schema)} value={undefined} otherValue="" onChange={noop} />);
    expect(screen.getByRole('group', { name: /Venez-vous/ })).toBeInTheDocument();
  });

  it('la liste déroulante est une vraie <select> native', () => {
    const schema = build([
      {
        id: 'choix',
        type: 'select',
        label: 'Votre choix',
        options: [{ value: 'a', label: 'Option A' }],
      },
    ]);
    render(<FieldInput field={fieldOf(schema)} value={undefined} otherValue="" onChange={noop} />);
    expect(screen.getByLabelText(/Votre choix/).tagName).toBe('SELECT');
  });

  it('chaque case d’une grille est nommée par sa ligne ET sa colonne', () => {
    // Sans cela, un lecteur d'écran annonce « case à cocher » sans contexte :
    // l'information est purement visuelle.
    const schema = build([
      {
        id: 'dispos',
        type: 'checkbox_grid',
        label: 'Vos disponibilités',
        rows: [{ value: 'lundi', label: 'Lundi' }],
        columns: [{ value: 'matin', label: 'Matin' }],
      },
    ]);
    render(<FieldInput field={fieldOf(schema)} value={undefined} otherValue="" onChange={noop} />);
    expect(screen.getByRole('checkbox', { name: 'Lundi — Matin' })).toBeInTheDocument();
  });

  it('le choix « autre » ouvre un champ libre étiqueté', async () => {
    const user = userEvent.setup();
    const schema = build([
      {
        id: 'venue',
        type: 'radio',
        label: 'Venez-vous ?',
        allowOther: true,
        options: [{ value: 'oui', label: 'Oui' }],
      },
    ]);

    function Harness() {
      const [value, setValue] = useState<unknown>(undefined);
      return (
        <FieldInput
          field={fieldOf(schema)}
          value={value}
          otherValue=""
          onChange={(_id: string, next: unknown) => setValue(next)}
        />
      );
    }

    render(<Harness />);
    expect(screen.queryByPlaceholderText(fr.survey.otherPlaceholder)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: fr.survey.otherLabel }));
    expect(screen.getByPlaceholderText(fr.survey.otherPlaceholder)).toBeInTheDocument();
  });
});

describe('accessibilité des écrans d’encadrement', () => {
  it('accueil : aucune violation axe', async () => {
    const { container } = render(
      <WelcomeScreen
        content={{
          branding,
          badge: 'Inscription',
          title: 'Réunion d’information',
          description: 'Une description.',
          when: 'Le 15 juin 2027',
          place: { label: 'Salle des fêtes', address: null },
          ctaLabel: fr.survey.start,
        }}
        onStart={noop}
      />,
    );
    await expectNoA11yViolations(container);
  });

  it('consentement : aucune violation axe', async () => {
    const { container } = render(
      <ConsentScreen
        notice={notice}
        checkboxLabel={consentCheckboxLabel('consent')}
        checked={false}
        onToggle={noop}
        privacyHref="/confidentialite"
      />,
    );
    await expectNoA11yViolations(container);
  });

  it('consentement : affiche finalité, base légale, durée et destinataires', () => {
    render(
      <ConsentScreen
        notice={notice}
        checkboxLabel={consentCheckboxLabel('consent')}
        checked={false}
        onToggle={noop}
        privacyHref="/confidentialite"
      />,
    );
    expect(screen.getByText('Finalité')).toBeInTheDocument();
    expect(screen.getByText('Recenser un besoin')).toBeInTheDocument();
    expect(screen.getByText('votre consentement')).toBeInTheDocument();
    expect(screen.getByText('1 an')).toBeInTheDocument();
    expect(screen.getByText('Service organisateur')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: fr.survey.privacyLink })).toHaveAttribute(
      'href',
      '/confidentialite',
    );
  });

  it('remerciement : aucune violation axe, agenda et itinéraire compris', async () => {
    const { container } = render(
      <ThankYouScreen
        title={fr.survey.thankYouTitle}
        message={fr.survey.thankYouMessage}
        calendar={{ google: 'https://x.test/g', outlook: 'https://x.test/o', ics: '/api/ics/1' }}
        directions={{
          google: 'https://x.test/dg',
          openStreetMap: 'https://x.test/osm',
          apple: 'https://x.test/a',
        }}
        eventSummary={['Le 15 juin 2027']}
      />,
    );
    await expectNoA11yViolations(container);
    expect(screen.getByRole('link', { name: 'Autre agenda (.ics)' })).toHaveAttribute(
      'href',
      '/api/ics/1',
    );
  });

  it('accueil : l’agenda et l’itinéraire sont offerts AVANT l’inscription', async () => {
    // Un destinataire d'invitation bloque d'abord la date, s'inscrit ensuite.
    // L'obliger à s'inscrire pour pouvoir noter le rendez-vous inverse
    // l'ordre naturel des gestes.
    const { container } = render(
      <WelcomeScreen
        content={{
          branding,
          badge: 'Inscription',
          title: 'Soirée des 180 ans',
          description: 'Une soirée d’exception.',
          when: 'Le 18 novembre 2026 à 19 h 30',
          place: { label: 'Musée Jacquemart-André', address: null },
          ctaLabel: 'Je m’inscris',
          calendar: {
            google: 'https://x.test/g',
            outlook: 'https://x.test/o',
            ics: '/api/ics/1',
          },
          directions: {
            google: 'https://x.test/dg',
            openStreetMap: 'https://x.test/osm',
            apple: 'https://x.test/a',
          },
        }}
        onStart={noop}
      />,
    );

    await expectNoA11yViolations(container);
    expect(screen.getByRole('link', { name: 'Google Agenda' })).toHaveAttribute(
      'href',
      'https://x.test/g',
    );
    expect(screen.getByRole('link', { name: 'Google Maps' })).toHaveAttribute(
      'href',
      'https://x.test/dg',
    );
    // Le bouton d'inscription reste l'action principale de l'écran.
    expect(screen.getByRole('button', { name: 'Je m’inscris' })).toBeTruthy();
  });

  it('accueil sans événement : aucun bloc d’agenda inventé', () => {
    render(
      <WelcomeScreen
        content={{ branding, title: 'Enquête de satisfaction', ctaLabel: 'Commencer' }}
        onStart={noop}
      />,
    );
    expect(screen.queryByText('Ajouter à mon agenda')).toBeNull();
    expect(screen.queryByText('Itinéraire')).toBeNull();
  });

  it('itinéraire : Google Maps vient en premier', () => {
    // Ce n'est pas une préférence pour ce service — les tuiles de la
    // plateforme viennent d'OpenStreetMap — mais l'application que la plupart
    // des destinataires ont déjà ouverte.
    render(
      <ThankYouScreen
        title={fr.survey.thankYouTitle}
        directions={{
          google: 'https://x.test/dg',
          openStreetMap: 'https://x.test/osm',
          apple: 'https://x.test/a',
        }}
      />,
    );
    const names = screen
      .getAllByRole('link')
      .map((link) => link.textContent?.trim())
      .filter((name): name is string => Boolean(name));
    expect(names[0]).toBe('Google Maps');
  });
});

describe('enveloppe des écrans', () => {
  const schemaOne = (() => {
    const result = validateSurveySchema({
      version: 1,
      steps: [{ id: 'e1', fields: [{ id: 'nom', type: 'text', label: 'Votre nom' }] }],
    });
    if (!result.ok) throw new Error('Schéma invalide');
    return result.schema;
  })();

  function renderRunner() {
    return render(
      <SurveyRenderer
        schema={schemaOne}
        branding={branding}
        welcome={{ title: 'Invitation', ctaLabel: 'Commencer' }}
        consent={{
          required: false,
          notice,
          checkboxLabel: consentCheckboxLabel('consent'),
          privacyHref: '/confidentialite',
        }}
        thankYou={{ title: 'Merci', declined: { title: 'Merci de nous avoir prévenus' } }}
        onSubmit={() => Promise.resolve({ ok: true as const })}
      />,
    );
  }

  it('place l’accueil dans la MÊME scène que les questions', () => {
    // Défaut réel : l'accueil était rendu hors de `sp-runner`/`sp-stage`, donc
    // sans aucune marge horizontale — le texte touchait les bords de l'écran
    // là où chaque question respirait.
    const { container } = renderRunner();
    expect(container.querySelector('.sp-runner .sp-stage .sp-invite')).not.toBeNull();
  });

  it('place le remerciement dans la même scène', async () => {
    const user = userEvent.setup();
    const { container } = renderRunner();

    await user.click(screen.getByRole('button', { name: 'Commencer' }));
    await user.click(screen.getByRole('button', { name: /Envoyer/ }));
    await screen.findByText('Merci');

    expect(container.querySelector('.sp-runner .sp-stage .sp-screen--done')).not.toBeNull();
  });

  it('garde les questions dans cette scène', async () => {
    const user = userEvent.setup();
    const { container } = renderRunner();

    await user.click(screen.getByRole('button', { name: 'Commencer' }));
    // La même enveloppe partout : une marge réglée écran par écran finirait
    // par diverger.
    expect(container.querySelector('.sp-runner .sp-stage')).not.toBeNull();
  });
});

describe('parcours complet', () => {
  const schema = (() => {
    const result = validateSurveySchema({
      version: 1,
      steps: [
        {
          id: 'etape_1',
          fields: [
            { id: 'nom', type: 'text', label: 'Votre nom', required: true },
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
              type: 'number',
              label: 'Combien de personnes ?',
              min: 1,
              max: 9,
              condition: { field: 'presence', op: 'equals', value: 'oui' },
            },
          ],
        },
      ],
    });
    if (!result.ok) throw new Error('schéma invalide');
    return result.schema;
  })();

  function renderRunner(onSubmit = vi.fn().mockResolvedValue({ ok: true })) {
    render(
      <SurveyRenderer
        schema={schema}
        branding={branding}
        welcome={{ title: 'Formulaire', ctaLabel: fr.survey.start }}
        consent={{
          required: true,
          notice,
          checkboxLabel: consentCheckboxLabel('consent'),
          privacyHref: '/confidentialite',
        }}
        thankYou={{ title: fr.survey.thankYouTitle, declined: { title: 'Merci de nous avoir prévenus' } }}
        onSubmit={onSubmit}
      />,
    );
    return onSubmit;
  }

  it('commence par l’écran d’accueil, une question à la fois', async () => {
    const user = userEvent.setup();
    renderRunner();

    expect(screen.getByRole('heading', { name: 'Formulaire' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: fr.survey.start }));

    expect(screen.getByLabelText(/Votre nom/)).toBeInTheDocument();
    // Une seule question est affichée à la fois.
    expect(screen.queryByText(/Serez-vous présent/)).not.toBeInTheDocument();
  });

  it('refuse d’avancer sur un champ requis vide, et le dit', async () => {
    const user = userEvent.setup();
    renderRunner();
    await user.click(screen.getByRole('button', { name: fr.survey.start }));
    await user.click(screen.getByRole('button', { name: fr.survey.next }));

    expect(screen.getByText(fr.survey.errors.required)).toBeInTheDocument();
    // On reste sur la même question.
    expect(screen.getByLabelText(/Votre nom/)).toBeInTheDocument();
  });

  it('compte les questions RÉELLEMENT applicables', async () => {
    const user = userEvent.setup();
    renderRunner();
    await user.click(screen.getByRole('button', { name: fr.survey.start }));

    // Deux questions tant que la condition n'est pas remplie.
    expect(screen.getByText('1 / 2')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Votre nom/), 'Camille Martin');
    await user.click(screen.getByRole('button', { name: fr.survey.next }));
    await user.click(screen.getByRole('radio', { name: 'Oui' }));

    // La troisième question apparaît : le compteur suit le parcours réel.
    await waitFor(() => expect(screen.getByText('2 / 3')).toBeInTheDocument());
  });

  it('exige le consentement avant de pouvoir envoyer', async () => {
    const user = userEvent.setup();
    const onSubmit = renderRunner();

    await user.click(screen.getByRole('button', { name: fr.survey.start }));
    await user.type(screen.getByLabelText(/Votre nom/), 'Camille');
    await user.click(screen.getByRole('button', { name: fr.survey.next }));
    await user.click(screen.getByRole('radio', { name: 'Non' }));
    await user.click(screen.getByRole('button', { name: fr.survey.next }));

    const submitButton = screen.getByRole('button', { name: fr.survey.submit });
    // Réellement désactivé, pas seulement grisé : sinon le clavier
    // permettrait de l'activer quand même.
    expect(submitButton).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox'));
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: fr.survey.thankYouTitle })).toBeInTheDocument(),
    );

    expect(onSubmit).toHaveBeenCalledWith({
      data: { nom: 'Camille', presence: 'non' },
      consentGiven: true,
    });
  });

  /**
   * DÉFAUT RÉEL signalé en production. Une personne qui répondait « Non, je ne
   * pourrai pas venir » lisait « Votre inscription est enregistrée. Vous pouvez
   * ajouter l'événement à votre agenda », suivie de la date, du lieu, de
   * l'adresse et de l'organisateur.
   */
  describe('écran de fin d’un refus', () => {
    const event = {
      calendar: {
        google: 'https://exemple.test/g',
        outlook: 'https://exemple.test/o',
        ics: 'https://exemple.test/i',
        note: null,
      },
      directions: {
        google: 'https://exemple.test/dg',
        apple: 'https://exemple.test/da',
        openStreetMap: 'https://exemple.test/dosm',
      },
      summary: [
        'mercredi 18 novembre 2026 à 19:30',
        'Musée Jacquemart-André',
        'Organisé par Spie batignolles',
      ],
    } as const;

    async function answer(presence: 'Oui' | 'Non', attendance?: AttendanceSettings) {
      const user = userEvent.setup();
      render(
        <SurveyRenderer
          schema={schema}
          branding={branding}
          welcome={{ title: 'Formulaire', ctaLabel: fr.survey.start }}
          consent={{
            required: false,
            notice,
            checkboxLabel: consentCheckboxLabel('consent'),
            privacyHref: '/confidentialite',
          }}
          thankYou={{
            title: 'Votre inscription est enregistrée',
            message: 'Vous pouvez ajouter l’événement à votre agenda.',
            declined: {
              title: fr.survey.declinedTitle,
              message: fr.survey.declinedMessage,
            },
          }}
          {...(attendance ? { attendance } : {})}
          event={event}
          onSubmit={vi.fn().mockResolvedValue({ ok: true })}
        />,
      );

      await user.click(screen.getByRole('button', { name: fr.survey.start }));
      await user.type(screen.getByLabelText(/Votre nom/), 'Camille');
      await user.click(screen.getByRole('button', { name: fr.survey.next }));
      await user.click(screen.getByRole('radio', { name: presence }));
      if (presence === 'Oui') {
        await user.click(screen.getByRole('button', { name: fr.survey.next }));
        await user.type(screen.getByLabelText(/Combien de personnes/), '2');
      }
      await user.click(screen.getByRole('button', { name: fr.survey.submit }));
    }

    const attendance: AttendanceSettings = {
      presenceField: 'presence',
      presenceValue: 'oui',
    };

    it('ne parle ni d’inscription ni d’agenda à qui a décliné', async () => {
      await answer('Non', attendance);

      await waitFor(() =>
        expect(
          screen.getByRole('heading', { name: fr.survey.declinedTitle }),
        ).toBeInTheDocument(),
      );
      expect(screen.getByText(fr.survey.declinedMessage)).toBeInTheDocument();

      // Le texte de l'organisation ne s'affiche pas : il est écrit pour les
      // personnes qui viennent.
      expect(screen.queryByText(/ajouter l’événement à votre agenda/i)).toBeNull();
      // Ni agenda, ni itinéraire, ni rappel de la date ou du lieu.
      expect(screen.queryByRole('link', { name: /Google Agenda/i })).toBeNull();
      expect(screen.queryByRole('link', { name: /Google Maps/i })).toBeNull();
      expect(screen.queryByText('Musée Jacquemart-André')).toBeNull();
      expect(screen.queryByText(/18 novembre 2026/)).toBeNull();
    });

    it('laisse tout en place pour qui vient', async () => {
      // Contre-épreuve : le correctif ne doit pas priver un présent de son
      // rappel d'événement.
      await answer('Oui', attendance);

      await waitFor(() =>
        expect(
          screen.getByRole('heading', { name: 'Votre inscription est enregistrée' }),
        ).toBeInTheDocument(),
      );
      expect(screen.getByText('Musée Jacquemart-André')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Google Agenda/i })).toBeInTheDocument();
    });

    it('ne change rien sans question de présence désignée', async () => {
      // La plateforme ne peut pas savoir laquelle des réponses signifie « je ne
      // viens pas » : elle n'invente pas, et l'écran reste celui d'avant.
      await answer('Non');

      await waitFor(() =>
        expect(
          screen.getByRole('heading', { name: 'Votre inscription est enregistrée' }),
        ).toBeInTheDocument(),
      );
      expect(screen.getByText('Musée Jacquemart-André')).toBeInTheDocument();
    });
  });

  it('ramène au champ fautif quand le serveur refuse', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 'invalid_input', fields: { nom: 'too_long' } });
    renderRunner(onSubmit);

    await user.click(screen.getByRole('button', { name: fr.survey.start }));
    await user.type(screen.getByLabelText(/Votre nom/), 'Camille');
    await user.click(screen.getByRole('button', { name: fr.survey.next }));
    await user.click(screen.getByRole('radio', { name: 'Non' }));
    await user.click(screen.getByRole('button', { name: fr.survey.next }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: fr.survey.submit }));

    // Retour sur la question fautive, avec son message.
    await waitFor(() => expect(screen.getByLabelText(/Votre nom/)).toBeInTheDocument());
    expect(screen.getByText(fr.survey.errors.too_long)).toBeInTheDocument();
  });

  it('expose une barre de progression annoncée', async () => {
    const user = userEvent.setup();
    renderRunner();
    await user.click(screen.getByRole('button', { name: fr.survey.start }));

    const bar = screen.getByRole('progressbar', { name: fr.survey.progress });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('permet de revenir en arrière sans perdre sa réponse', async () => {
    const user = userEvent.setup();
    renderRunner();

    await user.click(screen.getByRole('button', { name: fr.survey.start }));
    await user.type(screen.getByLabelText(/Votre nom/), 'Camille Martin');
    await user.click(screen.getByRole('button', { name: fr.survey.next }));
    await user.click(screen.getByRole('button', { name: fr.survey.back }));

    expect(screen.getByLabelText(/Votre nom/)).toHaveValue('Camille Martin');
  });

  it('le parcours entier ne présente aucune violation axe', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SurveyRenderer
        schema={schema}
        branding={branding}
        welcome={{ title: 'Formulaire', ctaLabel: fr.survey.start }}
        consent={{
          required: true,
          notice,
          checkboxLabel: consentCheckboxLabel('consent'),
          privacyHref: '/confidentialite',
        }}
        thankYou={{ title: fr.survey.thankYouTitle, declined: { title: 'Merci de nous avoir prévenus' } }}
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    await expectNoA11yViolations(container);
    await user.click(screen.getByRole('button', { name: fr.survey.start }));
    await expectNoA11yViolations(container);
    await user.type(screen.getByLabelText(/Votre nom/), 'Camille');
    await user.click(screen.getByRole('button', { name: fr.survey.next }));
    await expectNoA11yViolations(container);
  });
});

describe('un refus DÉSIGNE toujours la question', () => {
  /**
   * Défaut réel signalé en production : « Certaines réponses doivent être
   * corrigées. » et rien d'autre — sur un formulaire de neuf questions, il
   * fallait chercher. Deux causes, corrigées ensemble : le parcours ne
   * validait qu'un champ à la fois (le tout n'était donc contrôlé que par le
   * serveur), et un champ fautif absent des écrans faisait retomber sur le
   * message générique.
   */
  const schema = (() => {
    const result = validateSurveySchema({
      version: 1,
      steps: [
        {
          id: 'etape_1',
          fields: [
            { id: 'nom', type: 'text', label: 'Quel est votre nom ?', required: true },
            {
              id: 'courriel',
              type: 'email',
              label: 'Quel est votre email ?',
              required: true,
            },
          ],
        },
      ],
    });
    if (!result.ok) throw new Error('Schéma invalide');
    return result.schema;
  })();

  type Submit = React.ComponentProps<typeof SurveyRenderer>['onSubmit'];

  function renderRunner(onSubmit: Submit): ReturnType<typeof render> {
    return render(
      <SurveyRenderer
        branding={branding}
        onSubmit={onSubmit}
        schema={schema}
        welcome={{ title: 'Invitation', ctaLabel: 'Commencer' }}
        consent={{
          required: false,
          notice,
          checkboxLabel: consentCheckboxLabel('consent'),
          privacyHref: '/confidentialite',
        }}
        thankYou={{ title: 'Merci', declined: { title: 'Merci de nous avoir prévenus' } }}
      />,
    );
  }

  it('n’envoie pas une réponse invalide, et ramène au champ fautif', async () => {
    // Ce que ce test prouve : le contrôle écran par écran de `goNext`. La
    // validation complète ajoutée avant l'envoi est une ceinture — elle ne
    // mord pas ici, et le commentaire du code le dit.
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true as const }));
    renderRunner(onSubmit);

    await user.click(screen.getByRole('button', { name: 'Commencer' }));
    await user.type(screen.getByLabelText(/Quel est votre nom/), 'Camille');
    await user.click(screen.getByRole('button', { name: /Suivant/ }));

    // Le courriel est laissé vide : l'envoi ne doit pas partir.
    await user.click(screen.getByRole('button', { name: /Envoyer/ }));
    expect(onSubmit).not.toHaveBeenCalled();

    // Et l'écran fautif est sous les yeux, avec son message en ligne — pas un
    // bandeau générique qui laisserait chercher.
    expect(screen.getByLabelText(/Quel est votre email/)).toBeInTheDocument();
    expect(screen.queryByText(/Certaines réponses doivent être corrigées/)).toBeNull();
    expect(screen.getByText(responseErrorMessage('required'))).toBeTruthy();
  });

  it('NOMME la question quand le refus porte sur un champ hors parcours', async () => {
    const user = userEvent.setup();
    // Le serveur refuse sur un champ que l'écran n'affiche pas : sans le nom
    // de la question, l'utilisateur n'a aucune prise.
    const onSubmit = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        code: 'invalid_input',
        fields: { courriel: 'invalid_email' },
      }),
    );
    const { container } = renderRunner(onSubmit);

    await user.click(screen.getByRole('button', { name: 'Commencer' }));
    await user.type(screen.getByLabelText(/Quel est votre nom/), 'Camille');
    await user.click(screen.getByRole('button', { name: /Suivant/ }));
    await user.type(screen.getByLabelText(/Quel est votre email/), 'camille@exemple.test');
    await user.click(screen.getByRole('button', { name: /Envoyer/ }));

    // Le champ EST dans le parcours : on y retourne, message en ligne.
    expect(screen.getByLabelText(/Quel est votre email/)).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('nomme la question même pour une clé inconnue du parcours', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        code: 'invalid_input',
        fields: { champ_disparu: 'unknown_field' },
      }),
    );
    renderRunner(onSubmit);

    await user.click(screen.getByRole('button', { name: 'Commencer' }));
    await user.type(screen.getByLabelText(/Quel est votre nom/), 'Camille');
    await user.click(screen.getByRole('button', { name: /Suivant/ }));
    await user.type(screen.getByLabelText(/Quel est votre email/), 'camille@exemple.test');
    await user.click(screen.getByRole('button', { name: /Envoyer/ }));

    const alert = await screen.findByRole('alert');
    // La clé est nommée, et le motif avec : jamais un message nu.
    expect(alert.textContent).toContain('champ_disparu');
    expect(alert.textContent).toContain('Cette question n’existe pas');
  });
});
