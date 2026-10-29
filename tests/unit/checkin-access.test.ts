import { describe, expect, it } from 'vitest';
import { isCheckinOnly } from '@/lib/admin/session';

/**
 * Ce que le rôle d'accueil FERME.
 *
 * Le module « Accueil » repose sur un rôle qui ne donne rien par lui-même :
 * c'est l'affectation qui ouvre, et le rôle qui referme. Un de ces
 * fermetures est un ESPACE entier, et elle se décide ici plutôt que dans une
 * mise en page.
 */

describe('un compte d’accueil n’a pas d’espace d’administration', () => {
  it('reconnaît le rôle qui n’a que le poste', () => {
    const base = {
      userId: 'u1',
      status: 'active',
      organisationId: 'o1',
      organisationName: 'Org',
      organisationSlug: 'org',
      organisationLogoUrl: null,
      fullName: null,
      attached: true,
      isPlatformAdmin: false,
      modules: [],
    };
    // `attached` est VRAI pour un host — il est bien rattaché. C'est donc le
    // rôle, et lui seul, qui dit qu'il n'a pas d'espace de travail.
    expect(isCheckinOnly({ ...base, role: 'host' })).toBe(true);
    expect(isCheckinOnly({ ...base, role: 'viewer' })).toBe(false);
    expect(isCheckinOnly({ ...base, role: 'admin' })).toBe(false);
    expect(isCheckinOnly(null)).toBe(false);
  });
});
