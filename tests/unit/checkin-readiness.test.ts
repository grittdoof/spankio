import { describe, expect, it } from 'vitest';
import {
  checkinReadiness,
  readinessState,
  type ReadinessInput,
  type StaffMember,
} from '@/lib/checkin/readiness';

/**
 * Ce qui manque avant la soirée.
 *
 * L'enjeu de ces tests n'est pas la liste, c'est la FRONTIÈRE entre
 * « impossible » et « pénible ». La confondre ferait l'un de deux défauts :
 * refuser une soirée qui aurait parfaitement eu lieu, ou laisser passer en
 * silence ce qui la gâchera.
 */

function staff(partial: Partial<StaffMember> = {}): StaffMember {
  return {
    profileId: 'p1',
    name: 'Camille',
    email: 'camille@test.local',
    expiresAt: null,
    firstSeenAt: '2026-11-17T09:00:00.000Z',
    lastSeenAt: '2026-11-17T09:00:00.000Z',
    ...partial,
  };
}

function input(partial: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    moduleGranted: true,
    staff: [staff()],
    attendance: { identityField: 'nom', presenceField: 'presence', presenceValue: 'oui' },
    responses: 12,
    startsAt: '2026-11-18T18:00:00.000Z',
    ...partial,
  };
}

function itemFor(result: ReturnType<typeof checkinReadiness>, key: string) {
  return result.find((item) => item.key === key);
}

describe('ce qui EMPÊCHE de tenir la porte', () => {
  it('le module non autorisé', () => {
    const items = checkinReadiness(input({ moduleGranted: false }));
    expect(itemFor(items, 'module')?.state).toBe('blocked');
    expect(readinessState(items)).toBe('blocked');
  });

  it('personne d’affecté', () => {
    const items = checkinReadiness(input({ staff: [] }));
    expect(itemFor(items, 'staff')?.state).toBe('blocked');
  });

  it('une affectation qui expire avant le début', () => {
    // Pire que pas d'affectation : elle marche à l'ouverture des portes, puis
    // cesse de marcher en plein service, sans prévenir.
    const items = checkinReadiness(
      input({ staff: [staff({ expiresAt: '2026-11-18T12:00:00.000Z' })] }),
    );
    expect(itemFor(items, 'expiry')?.state).toBe('blocked');
    expect(itemFor(items, 'expiry')?.consequence).toContain('en plein service');
  });

  it('mais pas une affectation qui expire APRÈS', () => {
    const items = checkinReadiness(
      input({ staff: [staff({ expiresAt: '2026-11-20T23:59:59.000Z' })] }),
    );
    expect(itemFor(items, 'expiry')?.state).toBe('ok');
  });
});

describe('ce qui la DÉGRADE sans l’empêcher', () => {
  it('une personne qui ne s’est jamais connectée', () => {
    const items = checkinReadiness(
      input({ staff: [staff(), staff({ profileId: 'p2', firstSeenAt: null })] }),
    );
    const item = itemFor(items, 'signedIn');
    // Dégradé, pas bloquant : elle peut encore se connecter d'ici là. C'est
    // justement pour cela que l'écran se lit la veille.
    expect(item?.state).toBe('degraded');
    expect(item?.label).toContain('1 personne affectée ne s’est jamais connectée');
    expect(readinessState(items)).toBe('degraded');
  });

  it('aucune question ne nomme l’invité', () => {
    const items = checkinReadiness(input({ attendance: { presenceField: 'p', presenceValue: 'o' } }));
    const item = itemFor(items, 'identity');
    expect(item?.state).toBe('degraded');
    expect(item?.consequence).toContain('horodatage');
  });

  it('la présence non désignée', () => {
    const items = checkinReadiness(input({ attendance: { identityField: 'nom' } }));
    expect(itemFor(items, 'presence')?.state).toBe('degraded');
  });

  it('une présence désignée sans valeur ne compte pas comme désignée', () => {
    // Sans `presenceValue`, la comparaison ne se déclencherait jamais : le
    // comptage serait muet, et l'écran doit le dire plutôt que d'afficher vert.
    const items = checkinReadiness(input({ attendance: { identityField: 'n', presenceField: 'p' } }));
    expect(itemFor(items, 'presence')?.state).toBe('degraded');
  });

  it('aucune inscription reçue', () => {
    const items = checkinReadiness(input({ responses: 0 }));
    expect(itemFor(items, 'responses')?.state).toBe('degraded');
  });
});

describe('la forme de la liste', () => {
  it('montre aussi les lignes satisfaites', () => {
    const items = checkinReadiness(input());
    // Un écran qui ne montrerait que les manques laisserait croire, une fois
    // vide, qu'il n'a rien vérifié.
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.every((item) => item.state === 'ok')).toBe(true);
    expect(readinessState(items)).toBe('ok');
  });

  it('n’interroge ni les connexions ni les expirations sans personne affectée', () => {
    const items = checkinReadiness(input({ staff: [] }));
    expect(itemFor(items, 'signedIn')).toBeUndefined();
    expect(itemFor(items, 'expiry')).toBeUndefined();
  });

  it('ne juge pas les expirations sans date d’événement', () => {
    const items = checkinReadiness(
      input({ startsAt: null, staff: [staff({ expiresAt: '2020-01-01T00:00:00.000Z' })] }),
    );
    // Sans date de début, « expire avant l'événement » n'a aucun sens : on se
    // tait plutôt que d'arbitrer.
    expect(itemFor(items, 'expiry')).toBeUndefined();
  });

  it('énonce une conséquence pour tout ce qui n’est pas « ok », et jamais sinon', () => {
    const degraded = checkinReadiness(input({ moduleGranted: false, responses: 0 }));
    for (const item of degraded) {
      if (item.state === 'ok') expect(item.consequence).toBeNull();
      else expect(item.consequence).not.toBeNull();
    }
  });
});
