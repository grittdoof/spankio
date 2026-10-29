import { describe, expect, it } from 'vitest';
import {
  defaultInvitationExpiry,
  generateInvitationToken,
  invitationLink,
  isEmailShape,
  isInvitationTokenShape,
  normaliseEmail,
  INVITATION_TTL_DAYS,
} from '@/lib/checkin/invitation';
import { safeAfterSignIn } from '@/lib/auth/after-sign-in';

/**
 * Le jeton d'invitation, et la destination après connexion.
 *
 * Le second est le plus sensible des deux : un paramètre de retour non borné
 * est le mécanisme classique de la redirection ouverte — un attaquant envoie
 * un lien vers notre écran de connexion, la victime s'y connecte pour de bon,
 * et atterrit sur une page qui imite la nôtre.
 */

describe('le jeton', () => {
  it('est imprévisible et assez long', () => {
    const vus = new Set<string>();
    for (let i = 0; i < 200; i += 1) vus.add(generateInvitationToken());
    expect(vus.size).toBe(200);
    expect(generateInvitationToken().length).toBeGreaterThanOrEqual(32);
  });

  it('ne contient aucun caractère à échapper dans une URL', () => {
    for (let i = 0; i < 50; i += 1) {
      const token = generateInvitationToken();
      // Un jeton qui se corromprait au copier-coller produirait un refus
      // parfaitement incompréhensible.
      expect(encodeURIComponent(token)).toBe(token);
      expect(isInvitationTokenShape(token)).toBe(true);
    }
  });

  it('refuse une forme tronquée ou bavarde', () => {
    expect(isInvitationTokenShape('')).toBe(false);
    expect(isInvitationTokenShape('trop-court')).toBe(false);
    expect(isInvitationTokenShape(`${'a'.repeat(65)}`)).toBe(false);
    expect(isInvitationTokenShape(`${'a'.repeat(40)}/..`)).toBe(false);
  });

  it('compose un lien complet', () => {
    expect(invitationLink('https://exemple.test/', 'abc')).toBe(
      'https://exemple.test/accueil/invitation?jeton=abc',
    );
  });

  it('périme au bout de la durée annoncée', () => {
    const now = new Date('2026-11-01T12:00:00.000Z');
    const expiry = defaultInvitationExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(INVITATION_TTL_DAYS * 24 * 3600 * 1000);
  });
});

describe('l’adresse', () => {
  it('se compare en minuscules et sans espaces', () => {
    expect(normaliseEmail('  Camille.Roux@Traiteur.TEST ')).toBe('camille.roux@traiteur.test');
  });

  it('accepte les formes ordinaires et refuse le reste', () => {
    expect(isEmailShape('a@b.fr')).toBe(true);
    expect(isEmailShape('prenom.nom+accueil@sous.domaine.test')).toBe(true);
    expect(isEmailShape('pas-une-adresse')).toBe(false);
    expect(isEmailShape('a@b')).toBe(false);
    expect(isEmailShape(`${'a'.repeat(250)}@b.fr`)).toBe(false);
  });
});

describe('la destination après connexion', () => {
  const token = 'a'.repeat(43);

  it('ramène à l’espace de travail par défaut', () => {
    expect(safeAfterSignIn(undefined)).toBe('/admin');
    expect(safeAfterSignIn(null)).toBe('/admin');
    expect(safeAfterSignIn('')).toBe('/admin');
  });

  it('conserve un lien d’invitation bien formé', () => {
    expect(safeAfterSignIn(`/accueil/invitation?jeton=${token}`)).toBe(
      `/accueil/invitation?jeton=${token}`,
    );
  });

  it('REFUSE toute destination externe', () => {
    for (const hostile of [
      'https://ailleurs.test',
      '//ailleurs.test',
      'http://ailleurs.test/accueil/invitation?jeton=' + token,
      '/accueil/invitation?jeton=' + token + '&next=https://ailleurs.test',
      '/admin/sondages',
      '/accueil/invitation',
      'javascript:alert(1)',
    ]) {
      expect(safeAfterSignIn(hostile)).toBe('/admin');
    }
  });

  it('refuse un jeton mal formé même sur le bon chemin', () => {
    // On ne vérifie pas que la destination « a l'air » interne : on vérifie
    // qu'elle est exactement celle qu'on attend, jeton compris.
    expect(safeAfterSignIn('/accueil/invitation?jeton=court')).toBe('/admin');
  });
});
