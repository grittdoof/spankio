import { describe, expect, it } from 'vitest';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkNewPassword,
  checkSubmittedPassword,
} from '@/lib/auth/password';

/**
 * Ce fichier existe à cause d'un compte réel devenu inutilisable.
 *
 * La longueur minimale était appliquée À LA CONNEXION. Un compte créé depuis le
 * tableau de bord Supabase — dont le minimum par défaut est plus bas — ne
 * pouvait donc jamais se connecter : l'application refusait la saisie sans même
 * interroger le serveur d'authentification, et affichait « mot de passe
 * incorrect » alors que rien n'était incorrect.
 */

describe('fixer un mot de passe', () => {
  it('exige la longueur minimale de la politique', () => {
    expect(checkNewPassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBe('ok');
    expect(checkNewPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe('too_short');
  });

  it('refuse une saisie vide ou absente', () => {
    expect(checkNewPassword('')).toBe('empty');
    expect(checkNewPassword(null)).toBe('empty');
    expect(checkNewPassword(undefined)).toBe('empty');
  });

  it('borne la longueur pour ne pas offrir un déni de service au hachage', () => {
    expect(checkNewPassword('a'.repeat(MAX_PASSWORD_LENGTH))).toBe('ok');
    expect(checkNewPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe('too_long');
  });

  it('compte en points de code, pas en unités UTF-16', () => {
    // 12 emoji sont 12 caractères pour la personne qui les saisit, même s'ils
    // pèsent 24 unités en interne.
    expect(checkNewPassword('🔒'.repeat(MIN_PASSWORD_LENGTH))).toBe('ok');
    expect(checkNewPassword('🔒'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe('too_short');
  });
});

describe('vérifier un mot de passe soumis', () => {
  it('n’impose AUCUNE longueur minimale', () => {
    // C'est le correctif : un mot de passe court doit être transmis au serveur
    // d'authentification, qui seul sait s'il est le bon.
    expect(checkSubmittedPassword('court')).toBe('ok');
    expect(checkSubmittedPassword('a')).toBe('ok');
  });

  it('refuse seulement une saisie vide', () => {
    expect(checkSubmittedPassword('')).toBe('empty');
    expect(checkSubmittedPassword(null)).toBe('empty');
  });

  it('garde le plafond de longueur', () => {
    expect(checkSubmittedPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe('too_long');
  });

  it('accepte tout ce que la création accepte', () => {
    // Sans cette propriété, un compte créé par l'application pourrait ne pas
    // pouvoir s'y connecter — exactement le défaut corrigé.
    for (const candidate of ['a'.repeat(MIN_PASSWORD_LENGTH), '🔒'.repeat(12), 'MotDePasseTrèsLong!']) {
      if (checkNewPassword(candidate) === 'ok') {
        expect(checkSubmittedPassword(candidate), candidate).toBe('ok');
      }
    }
  });
});
