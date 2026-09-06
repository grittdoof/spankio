import { describe, expect, it } from 'vitest';
import {
  organisationGaps,
  organisationProgress,
  organisationProfileSchema,
} from '@/lib/services/organisation';

const FULL = {
  logo_url: 'https://exemple.test/logo.png',
  contact_email: 'contact@exemple.test',
  address: '1 rue de la Paix, 75002 Paris',
};

describe('complétude du profil', () => {
  it('ne signale rien sur un profil complet', () => {
    expect(organisationGaps(FULL)).toEqual([]);
    expect(organisationProgress(organisationGaps(FULL))).toBe(100);
  });

  it.each([
    ['logo', { logo_url: null }],
    ['contactEmail', { contact_email: null }],
    ['address', { address: null }],
  ])('signale l’absence de %s', (key, patch) => {
    const gaps = organisationGaps({ ...FULL, ...patch });
    expect(gaps.map((gap) => gap.key)).toContain(key);
  });

  it('traite un champ rempli d’espaces comme absent', () => {
    // Un espace satisferait un contrôle de présence naïf, et le logo affiché
    // serait une image vide.
    expect(organisationGaps({ ...FULL, logo_url: '   ' }).map((g) => g.key)).toEqual(['logo']);
  });

  it('dit toujours ce que l’absence coûte', () => {
    // Une liste de champs vides ne motive personne ; dire la conséquence
    // transforme une corvée en décision.
    for (const gap of organisationGaps({ logo_url: null, contact_email: null, address: null })) {
      expect(gap.consequence.length).toBeGreaterThan(40);
      expect(gap.label.length).toBeGreaterThan(3);
    }
  });

  it('calcule un avancement borné', () => {
    expect(organisationProgress(organisationGaps({ logo_url: null, contact_email: null, address: null }))).toBe(0);
    expect(organisationProgress(organisationGaps({ ...FULL, logo_url: null }))).toBe(67);
  });
});

describe('validation du profil', () => {
  it('accepte un profil renseigné', () => {
    expect(
      organisationProfileSchema.safeParse({
        name: 'Organisation Témoin',
        logoUrl: 'https://exemple.test/logo.png',
        contactEmail: 'contact@exemple.test',
        contactPhone: '01 23 45 67 89',
        address: '1 rue de la Paix',
      }).success,
    ).toBe(true);
  });

  it('accepte les champs facultatifs vides', () => {
    expect(
      organisationProfileSchema.safeParse({
        name: 'Organisation Témoin',
        logoUrl: null,
        contactEmail: null,
        contactPhone: null,
        address: null,
      }).success,
    ).toBe(true);
  });

  it.each([
    ['un nom trop court', { name: 'A' }],
    ['une adresse électronique invalide', { contactEmail: 'pas-une-adresse' }],
    ['un logo qui n’est pas une URL', { logoUrl: 'logo.png' }],
  ])('refuse %s', (_label, patch) => {
    expect(
      organisationProfileSchema.safeParse({
        name: 'Organisation Témoin',
        logoUrl: null,
        contactEmail: null,
        contactPhone: null,
        address: null,
        ...patch,
      }).success,
    ).toBe(false);
  });
});
