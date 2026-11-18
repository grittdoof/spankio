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

  it('ne lève pas sur un pourcentage isolé', () => {
    // `decodeURIComponent('%zz')` lève. L'écran de connexion est celui qui
    // doit marcher quand tout le reste est fermé : une adresse malformée est
    // un retour refusé, jamais une page en panne.
    expect(() => safeAfterSignIn('/accueil/invitation?jeton=%zz')).not.toThrow();
    expect(safeAfterSignIn('/accueil/invitation?jeton=%zz')).toBe('/admin');
  });
});

describe('le retour au poste après connexion', () => {
  const id = '6a9ffafd-00b4-4aa0-b432-9220977b1966';

  /*
   * Deuxième forme de la liste fermée, et elle vient d'un défaut réel : une
   * hôtesse qui suit le lien de SA soirée sans être connectée se retrouvait,
   * après connexion, sur le poste de sa première affectation — pas celui du
   * lien.
   */
  it('conserve le poste d’un événement', () => {
    expect(safeAfterSignIn(`/accueil/${id}`)).toBe(`/accueil/${id}`);
  });

  it('normalise la casse de l’identifiant', () => {
    expect(safeAfterSignIn(`/accueil/${id.toUpperCase()}`)).toBe(`/accueil/${id}`);
  });

  it('REFUSE tout ce qui n’est pas exactement un poste', () => {
    for (const hostile of [
      '/accueil',
      '/accueil/',
      '/accueil/pas-un-identifiant',
      `/accueil/${id}/impression`,
      `/accueil/${id}?essai=1`,
      `/accueil/${id}#ancre`,
      `/accueil/${id} `,
      '/accueil//ailleurs.test',
      `https://ailleurs.test/accueil/${id}`,
      `//ailleurs.test/accueil/${id}`,
    ]) {
      expect(safeAfterSignIn(hostile)).toBe('/admin');
    }
  });

  it('ne rend jamais autre chose que ce qu’il a validé', () => {
    // La valeur rendue est RECONSTRUITE à partir de l'identifiant : aucune
    // portion de l'entrée ne peut la traverser telle quelle.
    const rendu = safeAfterSignIn(`/accueil/${id}`);
    expect(rendu.startsWith('/accueil/')).toBe(true);
    expect(/^\/accueil\/[0-9a-f-]{36}$/.test(rendu)).toBe(true);
  });
});
