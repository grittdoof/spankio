import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminNav } from '@/components/admin/AdminNav';
import { FieldEditor } from '@/components/admin/FieldEditor';
import { StatisticsPanel } from '@/components/admin/StatisticsPanel';
import { SurveyBuilder, type SurveyDraft } from '@/components/admin/SurveyBuilder';
import { SURVEY_TEMPLATES, templateByKey } from '@/lib/event/templates';
import { computeStatistics } from '@/lib/survey/statistics';
import { validateSurveySchema, type SurveyField, type SurveySchema } from '@/lib/survey/schema';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Accessibilité de l'espace d'administration.
 *
 * L'éditeur visuel est l'écran le plus dense de la plateforme : c'est celui où
 * un contrôle sans libellé, un bouton sans nom accessible ou une hiérarchie de
 * titres cassée passerait le plus facilement inaperçu. Il est donc rendu ici
 * avec un vrai modèle, puis manipulé au clavier.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/sondages' }));

function schemaOf(key: string): SurveySchema {
  const template = templateByKey(key);
  if (!template) throw new Error(`Modèle « ${key} » introuvable.`);
  return template.schema;
}

function draft(schema: SurveySchema): SurveyDraft {
  return {
    title: 'Formulaire témoin',
    slug: 'formulaire-temoin',
    description: null,
    status: 'draft',
    schema,
    settings: {},
    purpose: null,
    legalBasis: null,
    retentionDays: null,
    recipients: null,
    requireConsent: true,
    dedupField: null,
  };
}

const saved = () => Promise.resolve({ ok: true as const });

/**
 * Va à une étape de l'éditeur comme le ferait un utilisateur : par la liste
 * d'étapes. Aucune propriété de test n'est ajoutée au composant pour cela —
 * un accès réservé aux tests ne prouverait rien du chemin réel.
 */
async function goToStep(user: ReturnType<typeof userEvent.setup>, label: string) {
  // Le numéro d'étape est `aria-hidden` : il repère visuellement, il n'a pas
  // à être annoncé avant le nom de l'étape.
  await user.click(screen.getByRole('button', { name: label }));
}

describe('accessibilité de l’éditeur visuel', () => {
  it.each(SURVEY_TEMPLATES.map((template) => [template.name, template.key] as const))(
    'ne signale aucune violation avec le modèle « %s »',
    async (_name, key) => {
      const { container } = render(
        <SurveyBuilder
          surveyId="00000000-0000-4000-8000-000000000001"
          initial={draft(schemaOf(key))}
          publicUrl="https://exemple.test/s/organisation/formulaire-temoin"
          onSave={saved}
        />,
      );
      await expectNoA11yViolations(container);
    },
  );

  it('ne signale aucune violation sur un formulaire vide', async () => {
    const empty = validateSurveySchema({ version: 1, steps: [] });
    // Un schéma sans étape n'est pas publiable : c'est justement l'état
    // initial d'un formulaire vierge, celui qu'il faut pouvoir éditer.
    expect(empty.ok).toBe(false);

    const user = userEvent.setup();
    const { container } = render(
      <SurveyBuilder
        surveyId="00000000-0000-4000-8000-000000000001"
        initial={{ ...draft(schemaOf('needs_survey')), schema: { version: 1, steps: [] } }}
        publicUrl="https://exemple.test/s/organisation/formulaire-temoin"
        onSave={saved}
      />,
    );
    await expectNoA11yViolations(container);

    await goToStep(user, 'Questions');
    await expectNoA11yViolations(container);
    expect(screen.getByText(/Aucune question pour l’instant/)).toBeTruthy();
  });
});

describe('manipulation au clavier', () => {
  it('ajoute une étape puis une question sans souris', async () => {
    const user = userEvent.setup();
    render(
      <SurveyBuilder
        surveyId="00000000-0000-4000-8000-000000000001"
        initial={{ ...draft(schemaOf('needs_survey')), schema: { version: 1, steps: [] } }}
        publicUrl="https://exemple.test/s/organisation/formulaire-temoin"
        onSave={saved}
      />,
    );

    await goToStep(user, 'Questions');
    await user.click(screen.getByRole('button', { name: 'Ajouter une étape' }));
    expect(screen.getByRole('heading', { name: 'Étape 1' })).toBeTruthy();
    // Une étape neuve arrive avec une première question : un écran d'étape
    // vide n'aurait rien à montrer.
    expect(screen.getAllByRole('button', { name: /^Supprimer la question/ })).toHaveLength(1);

    // Le TYPE est choisi d'abord : c'est ce qui détermine la question, et le
    // changer après coup orphelinerait les réponses déjà reçues.
    await user.click(screen.getByRole('button', { name: 'Ajouter une question' }));
    expect(screen.getByRole('group', { name: 'Quel type de question ?' })).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: /^Adresse électronique/ }),
    );

    // La question apparaît avec son type annoncé, et avec des commandes
    // nommées — pas une zone de saisie sans identité dans la page.
    expect(screen.getByText('Adresse électronique', { selector: '.sp-badge' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Supprimer la question/ })).toHaveLength(2);
  });

  it('déplace et supprime une question par des boutons nommés', async () => {
    const user = userEvent.setup();
    render(
      <SurveyBuilder
        surveyId="00000000-0000-4000-8000-000000000001"
        initial={draft(schemaOf('satisfaction_survey'))}
        publicUrl="https://exemple.test/s/organisation/formulaire-temoin"
        onSave={saved}
      />,
    );

    await goToStep(user, 'Questions');
    const before = screen.getAllByRole('button', { name: /^Descendre/ });
    expect(before.length).toBeGreaterThan(0);
    await user.click(before[0]!);

    const removals = screen.getAllByRole('button', { name: /^Supprimer la question/ });
    const countBefore = screen.getAllByRole('button', { name: /^Supprimer la question/ }).length;
    await user.click(removals[0]!);
    expect(
      screen.queryAllByRole('button', { name: /^Supprimer la question/ }).length,
    ).toBe(countBefore - 1);
  });

  it('refuse de quitter une étape dont un champ obligatoire est mal rempli, et désigne lequel', async () => {
    const user = userEvent.setup();
    render(
      <SurveyBuilder
        surveyId="00000000-0000-4000-8000-000000000001"
        initial={{ ...draft(schemaOf('needs_survey')), title: '' }}
        publicUrl="https://exemple.test/s/organisation/formulaire-temoin"
        onSave={saved}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Continuer' }));

    // On reste sur l'étape, le champ fautif est signalé ET reçoit le focus :
    // « certains champs sont invalides » sur un écran qui en compte six
    // laisse chercher lequel.
    const title = screen.getByLabelText(/^Titre/);
    expect(title).toHaveFocus();
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Indiquez un titre d’au moins deux caractères.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Identité' }).getAttribute('aria-current'),
    ).toBe('step');
  });

  it('laisse repartir en arrière même depuis une étape incomplète', async () => {
    // Revenir n'aggrave rien : bloquer le retour enfermerait l'utilisateur
    // dans l'étape qu'il n'arrive pas à remplir.
    const user = userEvent.setup();
    render(
      <SurveyBuilder
        surveyId="00000000-0000-4000-8000-000000000001"
        initial={draft(schemaOf('needs_survey'))}
        publicUrl="https://exemple.test/s/organisation/formulaire-temoin"
        onSave={saved}
      />,
    );

    await goToStep(user, 'Questions');
    await user.clear(screen.getAllByLabelText(/^Titre de l’étape/)[0]!);
    await user.click(screen.getByRole('button', { name: 'Retour' }));
    expect(
      screen.getByRole('button', { name: 'Identité' }).getAttribute('aria-current'),
    ).toBe('step');
  });

  it('annonce l’échec d’un enregistrement au lieu de le taire', async () => {
    const user = userEvent.setup();
    render(
      <SurveyBuilder
        surveyId="00000000-0000-4000-8000-000000000001"
        initial={draft(schemaOf('needs_survey'))}
        publicUrl="https://exemple.test/s/organisation/formulaire-temoin"
        onSave={() =>
          Promise.resolve({
            ok: false as const,
            fields: { purpose: 'La finalité est obligatoire.' },
            message: 'L’enregistrement a échoué',
          })
        }
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    // UNE seule zone d'annonce, qui porte à la fois la cause et le détail.
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain('L’enregistrement a échoué');
    expect(alerts[0]!.textContent).toContain('La finalité est obligatoire.');
  });

  it('empêche de publier un formulaire incomplet, et dit ce qui manque', async () => {
    // Le brouillon de test n'a ni finalité, ni base légale, ni durée : le
    // bouton reste inerte, mais l'écran énumère les manques AVANT le clic —
    // les découvrir après avoir cliqué fait perdre le geste.
    const user = userEvent.setup();
    render(
      <SurveyBuilder
        surveyId="00000000-0000-4000-8000-000000000001"
        initial={draft(schemaOf('needs_survey'))}
        publicUrl="https://exemple.test/s/organisation/formulaire-temoin"
        onSave={saved}
      />,
    );

    await goToStep(user, 'Publication');

    const publish: HTMLButtonElement = screen.getByRole('button', {
      name: 'Publier le formulaire',
    });
    expect(publish.disabled).toBe(true);
    expect(screen.getByText('Avant de pouvoir publier')).toBeTruthy();
    // Chaque manque est un bouton qui CONDUIT à l'étape où le corriger.
    expect(
      screen.getByRole('button', { name: 'La finalité de la collecte' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'La base légale' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'La durée de conservation' })).toBeTruthy();
  });

  it('autorise la publication dès que tout est renseigné', async () => {
    const user = userEvent.setup();
    render(
      <SurveyBuilder
        surveyId="00000000-0000-4000-8000-000000000001"
        initial={{
          ...draft(schemaOf('needs_survey')),
          purpose: 'Recenser un besoin',
          legalBasis: 'consent',
          retentionDays: 365,
        }}
        publicUrl="https://exemple.test/s/organisation/formulaire-temoin"
        onSave={saved}
      />,
    );

    await goToStep(user, 'Publication');

    const publish: HTMLButtonElement = screen.getByRole('button', {
      name: 'Publier le formulaire',
    });
    expect(publish.disabled).toBe(false);
    expect(screen.getByText('Prêt à publier')).toBeTruthy();
  });

  it('exige aussi la date quand c’est un événement', async () => {
    const user = userEvent.setup();
    render(
      <SurveyBuilder
        surveyId="00000000-0000-4000-8000-000000000001"
        initial={{
          ...draft(schemaOf('event_registration')),
          purpose: 'Organiser un événement',
          legalBasis: 'consent',
          retentionDays: 365,
        }}
        publicUrl="https://exemple.test/s/organisation/formulaire-temoin"
        eventStartsAt={null}
        onSave={saved}
      />,
    );

    await goToStep(user, 'Publication');

    expect(screen.getByText('La date de l’événement')).toBeTruthy();
    const publish: HTMLButtonElement = screen.getByRole('button', {
      name: 'Publier le formulaire',
    });
    expect(publish.disabled).toBe(true);
  });
});

describe('accessibilité de l’éditeur de question', () => {
  it('ne signale aucune violation sur un champ à options', async () => {
    const schema = schemaOf('satisfaction_survey');
    const field: SurveyField | undefined = schema.steps
      .flatMap((step) => step.fields)
      .find((candidate) => 'options' in candidate);
    expect(field).toBeDefined();

    const { container } = render(
      <ul className="sp-list">
        <FieldEditor
          field={field!}
          index={0}
          count={2}
          conditionCandidates={[]}
          onChange={() => {}}
          onMove={() => {}}
          onRemove={() => {}}
        />
      </ul>,
    );
    await expectNoA11yViolations(container);
  });
});

describe('accessibilité du tableau de bord', () => {
  it('ne signale aucune violation sur les agrégats', async () => {
    const schema = schemaOf('satisfaction_survey');
    const responses = [
      { data: {} as Record<string, unknown> },
      { data: {} as Record<string, unknown> },
    ];
    const { container } = render(
      <StatisticsPanel statistics={computeStatistics(schema, responses)} />,
    );
    await expectNoA11yViolations(container);
  });

  it('ne signale aucune violation sur la navigation latérale', async () => {
    const { container } = render(
      <AdminNav
        items={[
          { href: '/admin', label: 'Mon espace', icon: 'home' },
          { href: '/admin/sondages', label: 'Formulaires', icon: 'forms' },
        ]}
      />,
    );
    await expectNoA11yViolations(container);

    // La page courante est ANNONCÉE, pas seulement surlignée.
    expect(screen.getByRole('link', { name: 'Formulaires' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});
