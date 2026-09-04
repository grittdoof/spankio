import { describe, expect, it } from 'vitest';
import { authErrorCodeFor, classifyAuthFailure } from '@/lib/auth/failures';
import { authErrorMessage, fr } from '@/lib/i18n/fr';

/**
 * Ce fichier existe à cause d'un défaut réel, constaté en production : quand le
 * service d'envoi de courriels de Supabase était saturé, l'écran d'inscription
 * annonçait « compte créé, ouvrez le message de confirmation » alors que rien
 * n'avait été créé et qu'aucun message ne partirait.
 *
 * La règle testée ici : ne rien révéler sur un COMPTE, tout dire sur une PANNE.
 */

describe('refus liés au compte : réponse indifférenciée', () => {
  it('classe des identifiants incorrects comme un refus de compte', () => {
    expect(
      classifyAuthFailure({ message: 'Invalid login credentials', status: 400 }),
    ).toBe('account');
  });

  it('classe une adresse déjà utilisée comme un refus de compte', () => {
    expect(
      classifyAuthFailure({ message: 'User already registered', code: 'user_already_exists' }),
    ).toBe('account');
  });

  it('ne produit aucun code d’erreur pour ces cas', () => {
    // Un code distinct permettrait d'énumérer les comptes inscrits.
    expect(authErrorCodeFor('account')).toBeNull();
  });
});

describe('pannes de plateforme : à dire franchement', () => {
  it('reconnaît le quota d’envoi de courriels par son code', () => {
    expect(
      classifyAuthFailure({ message: 'quota', code: 'over_email_send_rate_limit', status: 429 }),
    ).toBe('unavailable');
  });

  it('le reconnaît aussi par son message, les codes n’étant pas garantis', () => {
    // C'est le message exact renvoyé par le service d'envoi par défaut d'un
    // projet Supabase neuf, bridé à quelques courriels par heure.
    expect(classifyAuthFailure({ message: 'email rate limit exceeded' })).toBe('unavailable');
    expect(classifyAuthFailure({ message: 'Error sending confirmation email: smtp error' })).toBe(
      'unavailable',
    );
  });

  it('reconnaît un service d’envoi désactivé ou en échec', () => {
    expect(classifyAuthFailure({ message: 'x', code: 'email_provider_disabled' })).toBe(
      'unavailable',
    );
    expect(classifyAuthFailure({ message: 'x', code: 'smtp_send_failed' })).toBe('unavailable');
  });

  it('ne confond pas un quota d’envoi avec un excès de tentatives', () => {
    // Les deux sont des 429, mais l'un est une panne de plateforme et l'autre
    // une limite appliquée à l'appelant.
    expect(classifyAuthFailure({ message: 'email rate limit exceeded', status: 429 })).toBe(
      'unavailable',
    );
    expect(classifyAuthFailure({ message: 'Too many requests', status: 429 })).toBe('rate_limited');
    expect(classifyAuthFailure({ message: 'x', code: 'over_request_rate_limit' })).toBe(
      'rate_limited',
    );
  });

  it('produit un code affichable pour chaque panne', () => {
    expect(authErrorCodeFor('unavailable')).toBe('emailServiceUnavailable');
    expect(authErrorCodeFor('rate_limited')).toBe('tooManyAttempts');
  });
});

describe('adresse non confirmée', () => {
  it('la distingue d’un refus d’identifiants', () => {
    expect(classifyAuthFailure({ message: 'Email not confirmed', status: 400 })).toBe(
      'unconfirmed',
    );
    expect(classifyAuthFailure({ message: 'x', code: 'email_not_confirmed' })).toBe('unconfirmed');
    expect(authErrorCodeFor('unconfirmed')).toBe('emailNotConfirmed');
  });
});

describe('les codes produits sont tous affichables', () => {
  it('chaque code correspond à un message d’interface existant', () => {
    // Un code sans message afficherait « erreur inattendue » à la place de
    // l'explication réelle.
    for (const kind of ['unconfirmed', 'rate_limited', 'unavailable'] as const) {
      const code = authErrorCodeFor(kind);
      expect(code, kind).not.toBeNull();
      expect(Object.keys(fr.errors), kind).toContain(code!);
      expect(authErrorMessage(code!), kind).not.toBe(fr.errors.unexpected);
    }
  });

  it('le message de panne d’envoi dit que la demande n’a PAS abouti', () => {
    // Le défaut d'origine était un message rassurant sur une action ratée.
    expect(fr.errors.emailServiceUnavailable).toMatch(/n’a pas pu aboutir/);
  });
});
