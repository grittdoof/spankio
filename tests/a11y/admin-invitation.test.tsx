import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  InvitationSettings,
  type InvitationTexts,
} from '@/components/admin/InvitationSettings';
import type { PublicPageSettings } from '@/lib/survey/public-page';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * Réglages de la page publique.
 *
 * Ce qui est vérifié ici : que chaque bloc a bien un interrupteur ÉTIQUETÉ —
 * une case à cocher sans libellé est invisible au clavier comme au lecteur
 * d'écran — et que fermer un bloc n'efface pas son contenu. Perdre un déroulé
 * en décochant une case serait une destruction silencieuse.
 */

const noop = () => Promise.resolve({ ok: true as const });

/** Schéma minimal, avec une question d'adresse à désigner. */
const schema: SurveySchema = (() => {
  const result = validateSurveySchema({
    version: 1,
    steps: [
      {
        id: 'etape_1',
        fields: [
          { id: 'nom', type: 'text', label: 'Nom et prénom' },
          { id: 'email', type: 'email', label: 'Adresse électronique' },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error(`Schéma invalide : ${JSON.stringify(result.issues)}`);
  return result.schema;
})();

/**
 * Enveloppe à état : le panneau garde son brouillon en interne, mais
 * l'enregistrement doit être observable. Ce double retient le dernier
 * brouillon envoyé.
 */
function Harness({
  initial,
  texts = {},
}: {
  initial: PublicPageSettings;
  texts?: InvitationTexts;
}) {
  const [saved, setSaved] = useState<PublicPageSettings | null>(null);
  const [savedTexts, setSavedTexts] = useState<InvitationTexts | null>(null);
  return (
    <>
      <InvitationSettings
        initial={initial}
        initialTexts={texts}
        schema={schema}
        onSave={(draft, nextTexts) => {
          setSaved(draft);
          setSavedTexts(nextTexts);
          return Promise.resolve({ ok: true });
        }}
        publicUrl="https://spankio.test/s/org/invitation"
        published
      />
      <output data-testid="enregistre">{saved ? JSON.stringify(saved) : ''}</output>
      <output data-testid="textes">{savedTexts ? JSON.stringify(savedTexts) : ''}</output>
    </>
  );
}

describe('accessibilité', () => {
  it('ne signale aucune violation sur un écran vierge', async () => {
    const { container } = render(
      <InvitationSettings
        initial={{}}
        initialTexts={{}}
        schema={schema}
        onSave={noop}
        publicUrl="https://spankio.test/s/org/invitation"
        published
      />,
    );
    await expectNoA11yViolations(container);
  });

  it('ne signale aucune violation avec du contenu', async () => {
    const { container } = render(
      <InvitationSettings
        initial={{
          hidden: ['share'],
          details: [{ label: 'Tenue de soirée' }],
          programme: [{ time: '19h30', title: 'Accueil' }],
          faq: [{ question: 'Où ?', answer: 'Ici.' }],
          organiserWord: { text: 'Bonjour.' },
          travelNote: 'Métro Miromesnil.',
        }}
        initialTexts={{ thankYou: { title: 'Votre inscription est enregistrée' } }}
        schema={schema}
        onSave={noop}
        publicUrl="https://spankio.test/s/org/invitation"
        published
      />,
    );
    await expectNoA11yViolations(container);
  });

  it('étiquette chaque interrupteur, et l’explique', () => {
    render(
      <InvitationSettings
        initial={{}}
        initialTexts={{}}
        schema={schema}
        onSave={noop}
        publicUrl="https://spankio.test/s/org/invitation"
        published
      />,
    );
    // Un échantillon suffit : le registre est vérifié exhaustivement par
    // tests/unit/public-page.test.ts.
    expect(screen.getByRole('checkbox', { name: /Le compte à rebours/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Le déroulé/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Le partage du lien/ })).toBeTruthy();
  });

  it('dit qu’une page non publiée n’existe pas encore', () => {
    render(
      <InvitationSettings
        initial={{}}
        initialTexts={{}}
        schema={schema}
        onSave={noop}
        publicUrl="https://spankio.test/s/org/invitation"
        published={false}
      />,
    );
    expect(screen.getByText(/n’est pas encore publié/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Voir la page publique/ })).toBeNull();
  });
});

describe('interrupteurs', () => {
  it('reflète les défauts : le partage est fermé, le déroulé ouvert', () => {
    render(<Harness initial={{}} />);
    expect(screen.getByRole('checkbox', { name: /Le partage du lien/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Le déroulé/ })).toBeChecked();
  });

  it('fige les défauts au premier clic, sans rien réactiver au passage', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{}} />);

    await user.click(screen.getByRole('checkbox', { name: /Le partage du lien/ }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const saved = JSON.parse(screen.getByTestId('enregistre').textContent ?? '') as PublicPageSettings;
    expect(saved.hidden).toContain('responseCount');
    expect(saved.hidden).not.toContain('share');
  });

  it('fermer un bloc ne détruit PAS son contenu', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ programme: [{ time: '19h30', title: 'Accueil' }] }} />);

    await user.click(screen.getByRole('checkbox', { name: /Le déroulé/ }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const saved = JSON.parse(screen.getByTestId('enregistre').textContent ?? '') as PublicPageSettings;
    expect(saved.hidden).toContain('programme');
    expect(saved.programme).toEqual([{ time: '19h30', title: 'Accueil' }]);
  });
});

describe('contenus répétables', () => {
  it('ajoute un moment au déroulé, puis le retire', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{}} />);

    await user.click(screen.getByRole('button', { name: 'Ajouter un moment' }));
    await user.type(screen.getByLabelText('Ce qui se passe'), 'Accueil');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    let saved = JSON.parse(screen.getByTestId('enregistre').textContent ?? '') as PublicPageSettings;
    expect(saved.programme).toEqual([{ title: 'Accueil' }]);

    await user.click(screen.getByRole('button', { name: /Retirer « Accueil »/ }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    saved = JSON.parse(screen.getByTestId('enregistre').textContent ?? '') as PublicPageSettings;
    expect(saved.programme).toEqual([]);
  });

  it('réordonne le déroulé : son ordre est l’information', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          programme: [
            { title: 'Dîner' },
            { title: 'Accueil' },
          ],
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Déplacer « Accueil » vers le haut/ }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const saved = JSON.parse(screen.getByTestId('enregistre').textContent ?? '') as PublicPageSettings;
    expect(saved.programme?.map((moment) => moment.title)).toEqual(['Accueil', 'Dîner']);
  });

  it('efface le mot de l’organisateur quand on vide son texte', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ organiserWord: { text: 'Bonjour.' } }} />);

    await user.clear(screen.getByLabelText('Le mot'));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const saved = JSON.parse(screen.getByTestId('enregistre').textContent ?? '') as PublicPageSettings;
    // Une signature sans texte afficherait une carte vide sur la page publique.
    expect(saved.organiserWord).toBeUndefined();
  });
});

describe('couleur du bouton', () => {
  it('n’écrit rien tant que la saisie est incomplète', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{}} />);

    // On ne peut pas atteindre « #0B4A96 » sans passer par « #0 », « #0B »…
    // Écrire ces états intermédiaires rendrait le champ inutilisable.
    await user.type(screen.getByLabelText('Code hexadécimal'), '#0B4A96');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const saved = JSON.parse(
      screen.getByTestId('enregistre').textContent ?? '',
    ) as PublicPageSettings;
    expect(saved.ctaColor).toBe('#0B4A96');
  });

  it('refuse une couleur illisible AVANT d’appeler le serveur, et dit le ratio', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{}} />);

    await user.type(screen.getByLabelText('Code hexadécimal'), '#7F7F7F');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(screen.getByRole('alert').textContent).toMatch(/ne permet pas un libellé lisible/);
    // Rien n'a été envoyé : le refus est en amont.
    expect(screen.getByTestId('enregistre').textContent).toBe('');
  });

  it('annonce le contraste mesuré quand la couleur convient', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{}} />);

    await user.type(screen.getByLabelText('Code hexadécimal'), '#0B4A96');
    expect(screen.getByText(/Contraste du libellé/)).toBeTruthy();
  });

  it('peint l’aperçu avec la palette, encre comprise', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness initial={{}} />);

    await user.type(screen.getByLabelText('Code hexadécimal'), '#F5C518');
    const preview = container.querySelector('.sp-cta-preview .sp-btn');
    // Fond clair : l'encre passe au foncé, sinon le libellé disparaîtrait.
    expect(preview?.getAttribute('style')).toContain('#F5C518');
    expect(preview?.getAttribute('style')).toContain('#1A1D26');
  });

  it('revient à la charte, et efface la couleur enregistrée', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ctaColor: '#0B4A96' }} />);

    await user.click(screen.getByRole('button', { name: /Revenir à la couleur de la charte/ }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const saved = JSON.parse(
      screen.getByTestId('enregistre').textContent ?? '',
    ) as PublicPageSettings;
    expect(saved.ctaColor).toBeUndefined();
  });

  it('ne signale aucune violation avec le sélecteur de couleur', async () => {
    const { container } = render(
      <InvitationSettings
        initial={{ ctaColor: '#0B4A96' }}
        initialTexts={{}}
        schema={schema}
        onSave={noop}
        publicUrl="https://spankio.test/s/org/invitation"
        published
      />,
    );
    await expectNoA11yViolations(container);
  });
});

describe('écran de fin', () => {
  it('rend le texte enregistré modifiable', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{}}
        texts={{ thankYou: { title: 'Votre inscription est enregistrée' } }}
      />,
    );

    await user.type(
      screen.getByLabelText('Phrase'),
      'Vous pouvez ajouter l’événement à votre agenda grâce au lien ci-dessous.',
    );
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const saved = JSON.parse(
      screen.getByTestId('textes').textContent ?? '',
    ) as { thankYou?: { title?: string; message?: string } };
    expect(saved.thankYou?.title).toBe('Votre inscription est enregistrée');
    expect(saved.thankYou?.message).toBe(
      'Vous pouvez ajouter l’événement à votre agenda grâce au lien ci-dessous.',
    );
  });

  it('retire la clé plutôt que d’enregistrer une chaîne vide', async () => {
    // Un titre vide afficherait un écran de fin sans titre ; l'absence de clé
    // fait retomber le rendu sur le libellé par défaut de l'interface.
    const user = userEvent.setup();
    render(<Harness initial={{}} texts={{ thankYou: { title: 'Merci !' } }} />);

    await user.clear(screen.getByLabelText('Titre'));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const saved = JSON.parse(
      screen.getByTestId('textes').textContent ?? '',
    ) as { thankYou?: Record<string, unknown> };
    expect(saved.thankYou?.['title']).toBeUndefined();
  });
});

describe('courriel de confirmation', () => {
  it('reste fermé par défaut, et rien ne se règle avant', () => {
    render(<Harness initial={{}} />);
    const toggle = screen.getByRole('checkbox', { name: /Envoyer un courriel/ });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByLabelText(/Question portant l’adresse/)).toBeNull();
  });

  it('désigne d’office la seule question candidate à l’activation', async () => {
    // Un réglage à moitié fait n'enverrait rien, sans rien dire.
    const user = userEvent.setup();
    render(<Harness initial={{}} />);

    await user.click(screen.getByRole('checkbox', { name: /Envoyer un courriel/ }));
    expect(screen.getByLabelText(/Question portant l’adresse/)).toHaveValue('email');

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const saved = JSON.parse(
      screen.getByTestId('textes').textContent ?? '',
    ) as { confirmation?: { enabled?: boolean; emailField?: string } };
    expect(saved.confirmation).toMatchObject({ enabled: true, emailField: 'email' });
  });

  it('signale que le champ « Accès » est vide, puisqu’il alimente le courriel', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{}} />);
    await user.click(screen.getByRole('checkbox', { name: /Envoyer un courriel/ }));
    expect(screen.getByText(/Le champ « Accès » est vide/)).toBeTruthy();
  });

  it('se taît sur l’accès quand il est renseigné', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ travelNote: 'Métro Miromesnil.' }} />);
    await user.click(screen.getByRole('checkbox', { name: /Envoyer un courriel/ }));
    expect(screen.queryByText(/Le champ « Accès » est vide/)).toBeNull();
  });

  it('ferme un bloc du courriel sans toucher aux autres', async () => {
    // Le cas demandé : ne pas annoncer une heure de fin seulement indicative.
    const user = userEvent.setup();
    render(<Harness initial={{}} texts={{ confirmation: { enabled: true, emailField: 'email' } }} />);

    // Les interrupteurs du courriel sont interrogés DANS leur groupe : la page
    // publique a ses propres blocs, dont certains portent un nom voisin.
    const group = within(screen.getByRole('group', { name: 'Ce que le courriel affiche' }));
    const endTime = group.getByRole('checkbox', { name: /L’heure de fin/ });
    const date = group.getByRole('checkbox', { name: /^La date/ });
    expect(endTime).toBeChecked();
    expect(date).toBeChecked();

    await user.click(endTime);
    expect(endTime).not.toBeChecked();
    expect(date).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const saved = JSON.parse(
      screen.getByTestId('textes').textContent ?? '',
    ) as { confirmation?: { hidden?: string[] } };
    // La liste enregistrée est celle des blocs MASQUÉS, pas des blocs montrés.
    expect(saved.confirmation?.hidden).toEqual(['endTime']);
  });

  it('n’avertit plus sur l’accès quand le bloc « Accès » est fermé', async () => {
    // L'avertissement dit une conséquence ; sans le bloc, il n'y en a pas.
    const user = userEvent.setup();
    render(<Harness initial={{}} texts={{ confirmation: { enabled: true, emailField: 'email' } }} />);
    expect(screen.getByText(/Le champ « Accès » est vide/)).toBeTruthy();

    const group = within(screen.getByRole('group', { name: 'Ce que le courriel affiche' }));
    await user.click(group.getByRole('checkbox', { name: /L’accès/ }));
    expect(screen.queryByText(/Le champ « Accès » est vide/)).toBeNull();
  });

  it('ne signale aucune violation, courriel activé', async () => {
    const { container } = render(
      <InvitationSettings
        initial={{ travelNote: 'Métro Miromesnil.' }}
        initialTexts={{ confirmation: { enabled: true, emailField: 'email' } }}
        onSave={noop}
        publicUrl="https://spankio.test/s/org/invitation"
        published
        schema={schema}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
