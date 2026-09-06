import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConditionEditor } from '@/components/admin/ConditionEditor';
import { SurveyRenderer } from '@/components/public/SurveyRenderer';
import { composeConsentNotice, consentCheckboxLabel } from '@/lib/survey/consent';
import { validateSurveySchema, type Condition, type SurveyField } from '@/lib/survey/schema';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Conditions d'affichage : de l'éditeur jusqu'au répondant.
 *
 * Le défaut corrigé ici était réel et observé en production : l'éditeur ne
 * savait composer que « a une réponse », si bien qu'une question conditionnée
 * apparaissait dès qu'une réponse — n'importe laquelle — avait été donnée. Un
 * formulaire d'inscription demandait donc le nombre d'accompagnants à qui
 * venait de répondre « Non, je viens seul ».
 *
 * Ces tests couvrent les deux bouts : ce que l'éditeur permet d'écrire, et ce
 * que le répondant voit.
 */

function schemaOf(fields: unknown[]) {
  const result = validateSurveySchema({ version: 1, steps: [{ id: 'etape_1', fields }] });
  if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
}

const ACCOMPAGNE = {
  id: 'accompagne',
  type: 'radio',
  label: 'Serez-vous accompagné ?',
  required: true,
  options: [
    { value: 'oui', label: 'Oui' },
    { value: 'non', label: 'Non' },
  ],
};

const candidates: readonly SurveyField[] = schemaOf([ACCOMPAGNE]).steps[0]!.fields;

describe('éditeur de condition', () => {
  it('ne signale aucune violation', async () => {
    const { container } = render(
      <ConditionEditor
        candidates={candidates}
        condition={{ field: 'accompagne', op: 'equals', value: 'oui' }}
        prefix="q2"
        onChange={() => {}}
      />,
    );
    await expectNoA11yViolations(container);
  });

  it('compose une égalité dès qu’une question est choisie', async () => {
    const user = userEvent.setup();
    const seen: (Condition | undefined)[] = [];
    render(
      <ConditionEditor
        candidates={candidates}
        condition={undefined}
        prefix="q2"
        onChange={(condition) => seen.push(condition)}
      />,
    );

    await user.selectOptions(screen.getByLabelText('N’afficher que si'), 'accompagne');

    // Le premier opérateur d'un choix unique est l'égalité, et sa première
    // option est retenue : la condition est valide dès le premier geste, sans
    // état intermédiaire qui ne se déclencherait jamais.
    expect(seen.at(-1)).toEqual({ field: 'accompagne', op: 'equals', value: 'oui' });
  });

  it('propose la réponse attendue, et seulement les options existantes', () => {
    render(
      <ConditionEditor
        candidates={candidates}
        condition={{ field: 'accompagne', op: 'equals', value: 'oui' }}
        prefix="q2"
        onChange={() => {}}
      />,
    );
    const values = screen.getByLabelText('Réponse attendue');
    expect([...values.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Oui',
      'Non',
    ]);
  });

  it('retire la réponse attendue quand l’opérateur n’en veut pas', async () => {
    const user = userEvent.setup();
    const seen: (Condition | undefined)[] = [];
    render(
      <ConditionEditor
        candidates={candidates}
        condition={{ field: 'accompagne', op: 'equals', value: 'oui' }}
        prefix="q2"
        onChange={(condition) => seen.push(condition)}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Condition'), 'answered');
    expect(seen.at(-1)).toEqual({ field: 'accompagne', op: 'answered' });
  });

  it('relit la condition en une phrase', () => {
    render(
      <ConditionEditor
        candidates={candidates}
        condition={{ field: 'accompagne', op: 'not_equals', value: 'non' }}
        prefix="q2"
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByText('Affichée si « Serez-vous accompagné ? » a une réponse autre que « Non ».'),
    ).toBeTruthy();
  });

  it('explique qu’une première question ne peut rien observer', () => {
    render(
      <ConditionEditor candidates={[]} condition={undefined} prefix="q1" onChange={() => {}} />,
    );
    expect(screen.getByText(/ne peut observer qu’une question qui la précède/)).toBeTruthy();
    expect(screen.queryByLabelText('N’afficher que si')).toBeNull();
  });

  it('refuse de modifier une condition combinée par bribes', async () => {
    // La modifier champ par champ l'écraserait au premier changement ; la
    // remplacer entièrement est le seul geste sûr.
    const user = userEvent.setup();
    const seen: (Condition | undefined)[] = [];
    render(
      <ConditionEditor
        candidates={candidates}
        condition={{ all: [{ field: 'accompagne', op: 'answered' }] }}
        prefix="q2"
        onChange={(condition) => seen.push(condition)}
      />,
    );

    expect(screen.getByText('Condition avancée')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Supprimer la condition' }));
    expect(seen.at(-1)).toBeUndefined();
  });
});

describe('ce que voit le répondant', () => {
  const schema = schemaOf([
    ACCOMPAGNE,
    {
      id: 'combien',
      type: 'radio',
      label: 'Combien de personnes vous accompagnent ?',
      options: [
        { value: 'une', label: '1' },
        { value: 'deux', label: '2' },
      ],
      // La condition que l'éditeur ne savait pas écrire.
      condition: { field: 'accompagne', op: 'equals', value: 'oui' },
    },
  ]);

  const notice = composeConsentNotice({
    organisationName: 'Organisation Témoin',
    purpose: 'Organiser un événement',
    legalBasis: 'consent',
    retentionDays: 365,
    recipients: null,
  });

  function renderForm() {
    return render(
      <SurveyRenderer
        schema={schema}
        branding={{ organisationName: 'Organisation Témoin', logoUrl: null, bannerUrl: null }}
        welcome={{ title: 'Invitation', ctaLabel: 'Commencer' }}
        consent={{
          required: false,
          notice,
          checkboxLabel: consentCheckboxLabel('consent'),
          privacyHref: '/confidentialite',
        }}
        thankYou={{ title: 'Merci' }}
        onSubmit={() => Promise.resolve({ ok: true as const })}
      />,
    );
  }

  it('affiche la question suivante quand la réponse est « Oui »', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Commencer' }));
    await user.click(screen.getByRole('radio', { name: 'Oui' }));
    await user.click(screen.getByRole('button', { name: /Suivant/ }));

    expect(
      screen.getByRole('group', { name: /Combien de personnes vous accompagnent/ }),
    ).toBeTruthy();
  });

  it('SAUTE la question quand la réponse est « Non »', async () => {
    // Le défaut observé : avec « a une réponse », cette question apparaissait
    // aussi à qui venait de répondre « Non ».
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Commencer' }));
    await user.click(screen.getByRole('radio', { name: 'Non' }));
    await user.click(screen.getByRole('button', { name: /Envoyer/ }));

    expect(await screen.findByText('Merci')).toBeTruthy();
    expect(
      screen.queryByRole('group', { name: /Combien de personnes vous accompagnent/ }),
    ).toBeNull();
  });

  it('referme la question si l’on revient changer la réponse', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Commencer' }));
    await user.click(screen.getByRole('radio', { name: 'Oui' }));
    await user.click(screen.getByRole('button', { name: /Suivant/ }));
    expect(
      screen.getByRole('group', { name: /Combien de personnes vous accompagnent/ }),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Retour/ }));
    await user.click(screen.getByRole('radio', { name: 'Non' }));

    // Le dernier écran devient celui-ci : le bouton passe à « Envoyer ».
    expect(screen.getByRole('button', { name: /Envoyer/ })).toBeTruthy();
  });
});
