import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldInput } from '@/components/public/FieldInput';
import { SurveyRenderer } from '@/components/public/SurveyRenderer';
import { ConsentScreen, ThankYouScreen, WelcomeScreen } from '@/components/public/screens';
import { fr } from '@/lib/i18n/fr';
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
        branding={branding}
        badge="Inscription"
        title="Réunion d’information"
        description="Une description."
        meta={['Le 15 juin 2027', 'Salle des fêtes']}
        ctaLabel={fr.survey.start}
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
    expect(screen.getByRole('link', { name: 'Fichier .ics' })).toHaveAttribute(
      'href',
      '/api/ics/1',
    );
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
        thankYou={{ title: fr.survey.thankYouTitle }}
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
        thankYou={{ title: fr.survey.thankYouTitle }}
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
