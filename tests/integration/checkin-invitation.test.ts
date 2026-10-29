import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER, createTestDb, type TestDb } from '../helpers/db';
import { createRouteHarness, type RouteHarness } from '../helpers/route';
import { createAccount, seedTwoTenants, type Tenant } from '../helpers/seed';
import { resolveRequestContext } from '@/lib/data/context';
import {
  claimInvitation,
  createInvitation,
  listInvitations,
  revokeInvitation,
} from '@/lib/services/checkin';
import { defaultInvitationExpiry } from '@/lib/checkin/invitation';
import { sha256Hex } from '@/lib/utils/hash';

/**
 * L'invitation, de bout en bout.
 *
 * Ce fichier existe pour UNE raison avant toutes les autres : l'empreinte du
 * jeton est calculée en TypeScript à la création et recalculée en SQL à la
 * consommation. Si les deux divergeaient d'un octet, rien ne planterait — la
 * fonction répondrait simplement « lien invalide » à tous les liens, pour
 * toujours, et personne ne comprendrait pourquoi. C'est exactement la forme du
 * défaut `dedup_field` qui a fait perdre neuf inscriptions.
 */
describe('invitation : la chaîne complète', () => {
  let db: TestDb;
  let api: RouteHarness;
  let a: Tenant;

  beforeAll(async () => {
    db = await createTestDb();
    api = createRouteHarness(db);
    const seeded = await seedTwoTenants(db);
    a = seeded.a;
  }, 120_000);

  afterAll(async () => {
    api?.dispose();
    await db?.close();
  });

  it('calcule la MÊME empreinte en TypeScript et en SQL', async () => {
    const token = 'un-jeton-de-controle';
    const ts = await sha256Hex(token);
    const sql = await db.query<{ hash: string }>(
      OWNER,
      "select encode(sha256(convert_to($1::text, 'UTF8')), 'hex') as hash",
      [token],
    );
    // Le contrôle le plus important du lot, et le moins spectaculaire.
    expect(ts).toBe(sql[0]!.hash);
  });

  it('crée un lien, le consomme, et ouvre la porte', async () => {
    api.actAs(a.admin, 'admin@a.test');
    const context = await resolveRequestContext();

    const created = await createInvitation(context, {
      surveyId: a.eventSurvey,
      organisationId: a.organisationId,
      email: 'Nouvelle.Hotesse@Traiteur.test',
      expiresAt: defaultInvitationExpiry().toISOString(),
      staffExpiresAt: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Le jeton revient en clair UNE fois ; la base n'en a que l'empreinte.
    const stored = await db.query<{ token_hash: string; email: string }>(
      OWNER,
      'select token_hash, email from public.checkin_invitations where id = $1',
      [created.value.id],
    );
    expect(stored[0]!.token_hash).not.toBe(created.value.token);
    expect(stored[0]!.token_hash).toBe(await sha256Hex(created.value.token));
    // L'adresse est normalisée des deux côtés, sinon une majuscule suffirait
    // à rendre le lien inutilisable.
    expect(stored[0]!.email).toBe('nouvelle.hotesse@traiteur.test');

    const invitee = await createAccount(db, 'nouvelle.hotesse@traiteur.test', 'Nouvelle');
    api.actAs(invitee, 'Nouvelle.Hotesse@Traiteur.test');
    const inviteeContext = await resolveRequestContext();

    const claimed = await claimInvitation(inviteeContext, created.value.token);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.value.surveyId).toBe(a.eventSurvey);

    const profile = await db.query<{ role: string; organisation_id: string }>(
      OWNER,
      'select role, organisation_id from public.profiles where id = $1',
      [invitee],
    );
    expect(profile[0]!.role).toBe('host');
    expect(profile[0]!.organisation_id).toBe(a.organisationId);
  });

  it('liste les invitations de l’événement, consommées comprises', async () => {
    api.actAs(a.admin, 'admin@a.test');
    const context = await resolveRequestContext();

    const rows = await listInvitations(context, a.eventSurvey);
    expect(rows.ok).toBe(true);
    if (!rows.ok) return;
    expect(rows.value.length).toBeGreaterThan(0);
    // Une invitation consommée RESTE affichée : savoir qui a rejoint la porte,
    // et quand, fait partie du compte rendu de la soirée.
    expect(rows.value.some((row) => row.claimedAt !== null)).toBe(true);
    // Et la liste ne porte jamais le jeton.
    expect(JSON.stringify(rows.value)).not.toContain('token');
  });

  it('un retrait est borné au sondage affiché', async () => {
    api.actAs(a.admin, 'admin@a.test');
    const context = await resolveRequestContext();

    const created = await createInvitation(context, {
      surveyId: a.eventSurvey,
      organisationId: a.organisationId,
      email: 'a-retirer@traiteur.test',
      expiresAt: defaultInvitationExpiry().toISOString(),
      staffExpiresAt: null,
    });
    if (!created.ok) return;

    // Le bon sondage retire ; un autre sondage de la MÊME organisation ne
    // retire rien, alors que le RLS l'y autoriserait.
    const wrong = await revokeInvitation(context, a.survey, created.value.id);
    expect(wrong.ok && wrong.value.removed).toBe(0);

    const right = await revokeInvitation(context, a.eventSurvey, created.value.id);
    expect(right.ok && right.value.removed).toBe(1);
  });

  it('un jeton tronqué est refusé comme un jeton inconnu', async () => {
    api.actAs(a.admin, 'admin@a.test');
    const context = await resolveRequestContext();
    const created = await createInvitation(context, {
      surveyId: a.eventSurvey,
      organisationId: a.organisationId,
      email: 'tronque@traiteur.test',
      expiresAt: defaultInvitationExpiry().toISOString(),
      staffExpiresAt: null,
    });
    if (!created.ok) return;

    const invitee = await createAccount(db, 'tronque@traiteur.test', 'Tronqué');
    api.actAs(invitee, 'tronque@traiteur.test');
    const inviteeContext = await resolveRequestContext();

    const claimed = await claimInvitation(
      inviteeContext,
      created.value.token.slice(0, -1),
    );
    expect(claimed.ok).toBe(false);
  });
});
