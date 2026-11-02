import { describe, expect, it } from 'vitest';
import {
  accessMessage,
  deskUrl,
  identifierLocalPart,
  isPasswordAcceptable,
  isStaffIdentifier,
  isStaffLabelShape,
  mayResetPassword,
  slugifyLabel,
  staffIdentifier,
  staffIdentifierHost,
  suggestPassword,
} from '@/lib/checkin/account';

/**
 * Comptes de pointage fabriqués par l'organisation.
 *
 * Ces tests fixent surtout deux refus. D'abord qu'aucun identifiant ne se
 * DEVINE ni ne se répète : deux « Marie » dans la même organisation sont la
 * règle, et un identifiant incrémenté obligerait à interroger la base pour
 * savoir quel numéro est libre. Ensuite que la reconnaissance d'un compte
 * fabriqué soit exacte — c'est elle qui décide si l'écran propose de remettre
 * un mot de passe, et la proposer sur le compte d'un éditeur serait une prise
 * de contrôle.
 */

describe('slugifyLabel', () => {
  it('retire les accents et la ponctuation', () => {
    expect(slugifyLabel('Élodie Lévêque')).toBe('elodie-leveque');
    expect(slugifyLabel('Entrée principale — nord')).toBe('entree-principale-nord');
  });

  it('ne laisse jamais de tiret en bordure', () => {
    expect(slugifyLabel('  Marie  ')).toBe('marie');
    expect(slugifyLabel('!!! Vestiaire !!!')).toBe('vestiaire');
  });

  it('retombe sur « poste » plutôt que de ne rien produire', () => {
    // Un segment vide donnerait une adresse refusée par la base, avec un
    // message que personne à l'écran ne saurait relier à ce qu'il a tapé.
    expect(slugifyLabel('!!!')).toBe('poste');
    expect(slugifyLabel('')).toBe('poste');
  });

  it('tronque sans laisser le tiret de coupure', () => {
    const slug = slugifyLabel('entree principale cote jardin et cour reunies');
    expect(slug.length).toBeLessThanOrEqual(24);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('staffIdentifierHost', () => {
  it('préfixe le domaine du site', () => {
    expect(staffIdentifierHost('https://spankio.example')).toBe('accueil.spankio.example');
    expect(staffIdentifierHost('https://spankio.example/')).toBe('accueil.spankio.example');
  });

  it('ne lève jamais sur une adresse illisible', () => {
    // Une variable d'environnement mal remplie ne doit pas empêcher de tenir
    // une porte : on dégrade, on ne plante pas.
    expect(staffIdentifierHost('pas une url')).toBe('accueil.localhost');
  });
});

describe('staffIdentifier', () => {
  const host = 'accueil.spankio.example';

  it('compose nom, tirage et hôte', () => {
    expect(staffIdentifier('Marie', host)).toMatch(
      /^marie\.[bcdfghjkmnpqrstvwxz23456789]{4}@accueil\.spankio\.example$/,
    );
  });

  it('ne produit pas deux fois le même identifiant', () => {
    // Le vrai juge reste la contrainte d'unicité de la base ; ce test vérifie
    // seulement que le tirage ne dégénère pas en constante.
    const drawn = new Set(Array.from({ length: 200 }, () => staffIdentifier('Marie', host)));
    expect(drawn.size).toBeGreaterThan(190);
  });
});

describe('isStaffIdentifier', () => {
  const host = 'accueil.spankio.example';

  it('reconnaît un compte fabriqué, quelle que soit la casse', () => {
    expect(isStaffIdentifier('marie.k3rt@accueil.spankio.example', host)).toBe(true);
    expect(isStaffIdentifier('Marie.K3RT@Accueil.Spankio.Example', host)).toBe(true);
  });

  it('refuse l’adresse réelle d’une personne', () => {
    expect(isStaffIdentifier('marie@spankio.example', host)).toBe(false);
    expect(isStaffIdentifier('marie@accueil.autre.example', host)).toBe(false);
    expect(isStaffIdentifier(null, host)).toBe(false);
  });

  it('ne se laisse pas prendre à un domaine qui se TERMINE pareil', () => {
    // « @mauvais-accueil.spankio.example » finit par les mêmes lettres sans
    // être le même domaine : l'arrobase doit faire partie de la comparaison.
    expect(isStaffIdentifier('x@mauvais-accueil.spankio.example', host)).toBe(false);
  });
});

describe('identifierLocalPart', () => {
  it('rend ce qui précède l’arrobase', () => {
    expect(identifierLocalPart('marie.k3rt@accueil.test')).toBe('marie.k3rt');
    expect(identifierLocalPart('sans-arobase')).toBe('sans-arobase');
  });
});

describe('isStaffLabelShape', () => {
  it('exige au moins une lettre ou un chiffre', () => {
    expect(isStaffLabelShape('Marie')).toBe(true);
    expect(isStaffLabelShape('Poste 1')).toBe(true);
    expect(isStaffLabelShape('   ')).toBe(false);
    expect(isStaffLabelShape('!!!')).toBe(false);
  });

  it('borne la longueur', () => {
    expect(isStaffLabelShape('a'.repeat(60))).toBe(true);
    expect(isStaffLabelShape('a'.repeat(61))).toBe(false);
  });
});

describe('isPasswordAcceptable', () => {
  it('impose dix caractères', () => {
    expect(isPasswordAcceptable('bako-tire-muso-47')).toBe(true);
    expect(isPasswordAcceptable('court')).toBe(false);
  });

  it('refuse les espaces de bordure', () => {
    // Un mot de passe dicté puis collé avec une espace finale ne se
    // reconnaîtrait pas, et personne ne comprendrait pourquoi.
    expect(isPasswordAcceptable(' bako-tire-muso ')).toBe(false);
  });
});

describe('suggestPassword', () => {
  it('se dicte : des syllabes, puis deux chiffres', () => {
    expect(suggestPassword()).toMatch(/^[a-z]{4}-[a-z]{4}-[a-z]{4}-\d{2}$/);
  });

  it('est accepté par sa propre validation', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(isPasswordAcceptable(suggestPassword())).toBe(true);
    }
  });

  it('ne se répète pas', () => {
    const drawn = new Set(Array.from({ length: 200 }, () => suggestPassword()));
    expect(drawn.size).toBeGreaterThan(190);
  });
});

describe('accessMessage', () => {
  const base = {
    eventTitle: 'Soirée des 180 ans',
    deskUrl: 'https://spankio.example/accueil/abc',
    identifier: 'marie.k3rt@accueil.spankio.example',
  };

  it('porte le lien, l’identifiant et le mot de passe', () => {
    const message = accessMessage({ ...base, password: 'bako-tire-muso-47' });
    expect(message).toContain('https://spankio.example/accueil/abc');
    expect(message).toContain('marie.k3rt@accueil.spankio.example');
    expect(message).toContain('bako-tire-muso-47');
  });

  it('omet le mot de passe quand il n’est pas connu', () => {
    // Il n'est jamais relu depuis la base : un message qui laisserait une
    // ligne « Mot de passe : » vide se lirait comme une panne.
    const message = accessMessage(base);
    expect(message).not.toContain('Mot de passe');
  });
});

describe('deskUrl', () => {
  it('ne double jamais la barre oblique', () => {
    expect(deskUrl('https://spankio.example/', 'abc')).toBe('https://spankio.example/accueil/abc');
    expect(deskUrl('https://spankio.example', 'abc')).toBe('https://spankio.example/accueil/abc');
  });
});

describe('mayResetPassword', () => {
  const HOST = 'accueil.spankio.example';
  const ORG = 'org-a';
  const fabricated = {
    organisationId: ORG,
    role: 'host',
    email: 'marie.k3rt@accueil.spankio.example',
  };

  it('laisse passer un compte fabriqué de sa propre organisation', () => {
    expect(mayResetPassword(fabricated, ORG, HOST).ok).toBe(true);
  });

  it('refuse un compte d’une autre organisation', () => {
    // La clé de service contourne le RLS : sans ce refus, l'écran d'un tenant
    // atteindrait les comptes d'un autre.
    const verdict = mayResetPassword({ ...fabricated, organisationId: 'org-b' }, ORG, HOST);
    expect(verdict).toMatchObject({ ok: false, code: 'PT403' });
  });

  it('refuse un compte sans rattachement', () => {
    const verdict = mayResetPassword({ ...fabricated, organisationId: null }, ORG, HOST);
    expect(verdict.ok).toBe(false);
  });

  it('refuse un éditeur, même affecté à la porte', () => {
    // Affecter un éditeur au poste est permis ; lui prendre son mot de passe
    // ne l'est pas — il ouvre son espace, pas seulement une liste d'invités.
    const verdict = mayResetPassword(
      { organisationId: ORG, role: 'editor', email: 'ines@spankio.example' },
      ORG,
      HOST,
    );
    expect(verdict.ok).toBe(false);
  });

  it('refuse un super-administrateur de la même organisation', () => {
    // Le cas le plus grave : l'éditeur de la plateforme est souvent aussi
    // l'administrateur de la première organisation cliente.
    const verdict = mayResetPassword(
      { organisationId: ORG, role: 'super_admin', email: 'admin@spankio.example' },
      ORG,
      HOST,
    );
    expect(verdict.ok).toBe(false);
  });

  it('refuse un host dont le compte N’EST PAS fabriqué', () => {
    // Quelqu'un entré par une invitation du lot 4b, avec sa vraie adresse :
    // le compte est le sien, et son mot de passe ouvre peut-être autre chose.
    const verdict = mayResetPassword(
      { organisationId: ORG, role: 'host', email: 'marie@exemple.fr' },
      ORG,
      HOST,
    );
    expect(verdict.ok).toBe(false);
  });

  it('refuse un compte sans adresse', () => {
    // Fail-closed : on ne peut pas prouver qu'il est fabriqué, donc non.
    expect(mayResetPassword({ ...fabricated, email: null }, ORG, HOST).ok).toBe(false);
  });
});
