import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeskDenied } from '@/components/checkin/DeskDenied';
import { expectNoA11yViolations } from '../helpers/axe';

/**
 * L'écran qui a remplacé un `404`.
 *
 * Défaut réel : une hôtesse portait sur son téléphone la session d'un compte
 * créé pour un autre événement. En ouvrant le lien de sa soirée, le RLS
 * masquait le sondage, la page appelait `notFound()`, et elle lisait « 404 ».
 * Le même lien marchait en navigation privée — ce qui désignait l'application
 * plutôt que le compte, et ne disait toujours pas quoi faire.
 *
 * Ce que ce test fige, et qui compte plus que l'absence de violation axe :
 * l'écran NOMME le compte connecté, propose la sortie, et ne laisse rien
 * échapper de l'événement demandé.
 */

// Le bouton poste une action serveur ; le module `'use server'` n'a pas sa
// place dans jsdom, et ce n'est pas lui qu'on vérifie ici.
vi.mock('@/app/(auth)/actions', () => ({ signOut: async () => {} }));

describe('le refus du poste', () => {
  it('nomme le compte connecté et propose la sortie', async () => {
    const { container } = render(<DeskDenied identifier="test1" />);

    expect(screen.getByText(/test1/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /se déconnecter/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /événements de ce compte/i })).toBeTruthy();

    await expectNoA11yViolations(container);
  });

  it('ne dit RIEN de l’événement demandé', () => {
    const { container } = render(<DeskDenied identifier="test1" />);
    const texte = container.textContent ?? '';

    // Le message est le même que l'affectation manque, qu'elle ait expiré ou
    // que l'adresse ne désigne rien : un texte qui varierait répondrait à qui
    // essaie des identifiants au hasard.
    expect(texte).not.toMatch(/expir/i);
    expect(texte).not.toMatch(/n’existe pas|nexiste pas|introuvable/i);
    expect(texte).toMatch(/n’ouvre aucune liste/);
  });

  it('reste lisible sans identifiant', async () => {
    const { container } = render(<DeskDenied identifier={null} />);

    // Un compte sans adresse lisible ne doit pas produire « connecté avec
    // « null » » : la phrase change, la sortie reste.
    expect(container.textContent).not.toMatch(/null|undefined/);
    expect(screen.getByRole('button', { name: /se déconnecter/i })).toBeTruthy();

    await expectNoA11yViolations(container);
  });
});
