import { describe, expect, it } from 'vitest';
import {
  CALLBACK_KEYS,
  callbackDestination,
  callbackErrorCode,
  callbackUrl,
} from '@/lib/auth/callback';
import { authErrorMessage, fr } from '@/lib/i18n/fr';

/**
 * Ces tests couvrent un échec réel : un lien de réinitialisation a renvoyé
 * l'utilisateur sur `/?error=access_denied&error_code=otp_expired`, page qui
 * affichait un accueil normal sans un mot d'explication.
 */

describe('destination du retour : liste fermée', () => {
  it('résout les clés connues', () => {
    expect(callbackDestination([])).toBe('/admin');
    expect(callbackDestination(undefined)).toBe('/admin');
    expect(callbackDestination(['nouveau-mot-de-passe'])).toBe('/nouveau-mot-de-passe');
  });

  it('ignore toute destination non prévue', () => {
    // Une URL de retour fabriquée ne peut pas rediriger ailleurs : la
    // destination ne vient pas de l'URL, elle est choisie dans la liste.
    for (const forged of [
      ['..', '..', 'etc'],
      ['https:', '', 'exemple.test'],
      ['admin', 'secret'],
      ['inconnu'],
      [''],
    ]) {
      expect(callbackDestination(forged), forged.join('/')).toBe('/admin');
    }
  });

  it('produit toujours un chemin interne', () => {
    for (const segments of [[], ['nouveau-mot-de-passe'], ['n’importe quoi']]) {
      const destination = callbackDestination(segments);
      expect(destination.startsWith('/')).toBe(true);
      expect(destination.startsWith('//')).toBe(false);
    }
  });
});

describe('URL de retour', () => {
  it('n’a aucune chaîne de requête, pour être autorisable telle quelle', () => {
    // La liste d'autorisations de Supabase compare des URL entières : une
    // chaîne de requête rend l'autorisation fragile.
    const url = callbackUrl('https://exemple.test', CALLBACK_KEYS.newPassword);
    expect(url).toBe('https://exemple.test/auth/callback/nouveau-mot-de-passe');
    expect(url).not.toContain('?');
  });

  it('gère la clé vide et la barre oblique finale du site', () => {
    expect(callbackUrl('https://exemple.test/', CALLBACK_KEYS.admin)).toBe(
      'https://exemple.test/auth/callback',
    );
  });
});

describe('traduction des erreurs de Supabase', () => {
  it('reconnaît un lien expiré', () => {
    expect(callbackErrorCode('otp_expired', 'access_denied')).toBe('linkExpired');
  });

  it('reconnaît un lien déjà utilisé ou remplacé', () => {
    expect(callbackErrorCode(null, 'access_denied')).toBe('linkInvalid');
    expect(callbackErrorCode('validation_failed', null)).toBe('linkInvalid');
  });

  it('retombe sur un message générique pour un code inconnu', () => {
    expect(callbackErrorCode('quelque_chose_de_nouveau', null)).toBe('sessionExpired');
  });

  it('ne signale rien quand il n’y a pas d’erreur', () => {
    expect(callbackErrorCode(null, null)).toBeNull();
    expect(callbackErrorCode(undefined, undefined)).toBeNull();
  });

  it('chaque code produit correspond à un message affichable', () => {
    for (const [errorCode, error] of [
      ['otp_expired', 'access_denied'],
      [null, 'access_denied'],
      ['inconnu', null],
    ] as const) {
      const code = callbackErrorCode(errorCode, error);
      expect(code).not.toBeNull();
      expect(Object.keys(fr.errors)).toContain(code!);
      expect(authErrorMessage(code!)).not.toBe(fr.errors.unexpected);
    }
  });

  it('le message d’expiration explique la cause ET la sortie', () => {
    // « lien invalide » sans explication laisse l'utilisateur sans recours.
    expect(fr.errors.linkExpired).toMatch(/une heure/);
    expect(fr.errors.linkExpired).toMatch(/nouveau/);
    expect(fr.errors.linkInvalid).toMatch(/déjà été utilisé/);
  });
});
