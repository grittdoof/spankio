import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as listModules, PATCH as patchModule } from '@/app/api/admin/modules/route';
import { GET as listMembers, PATCH as patchMember } from '@/app/api/admin/members/route';
import { OWNER, createTestDb, type TestDb } from '../helpers/db';
import {
  createRouteHarness,
  jsonRequest,
  readJson,
  type ApiError,
  type RouteHarness,
} from '../helpers/route';
import { insertResponse, seedTwoTenants, type Tenant } from '../helpers/seed';
import { resolveRequestContext } from '@/lib/data/context';
import { softDeleteResponses } from '@/lib/services/surveys';

/**
 * Isolation multi-tenant AU NIVEAU DES ROUTES.
 *
 * Ces routes ne filtrent volontairement pas par organisation : elles laissent
 * le RLS le faire. Ces tests vérifient que ce pari tient — c'est-à-dire qu'une
 * route qui « oublie » le tenant reste néanmoins étanche.
 */
describe("routes d'administration", () => {
  let db: TestDb;
  let api: RouteHarness;
  let a: Tenant;
  let b: Tenant;
  let superAdmin: string;

  beforeAll(async () => {
    db = await createTestDb();
    api = createRouteHarness(db);
    const seeded = await seedTwoTenants(db);
    a = seeded.a;
    b = seeded.b;
    superAdmin = seeded.superAdmin;
  }, 120_000);

  afterAll(async () => {
    api?.dispose();
    await db?.close();
  });

  describe('GET /api/admin/modules', () => {
    it("ne montre que les modules concédés à sa propre organisation", async () => {
      api.actAs(a.admin);
      const { status, body } = await readJson<{
        catalogue: { key: string }[];
        granted: { organisation_id: string; module_key: string }[];
      }>(await listModules(jsonRequest('GET', '/api/admin/modules')));

      expect(status).toBe(200);
      expect(body.catalogue.map((m) => m.key)).toEqual(['core', 'event']);
      expect(body.granted.every((m) => m.organisation_id === a.organisationId)).toBe(true);
    });

    it('refuse un visiteur anonyme', async () => {
      api.actAsAnonymous();
      expect((await listModules(jsonRequest('GET', '/api/admin/modules'))).status).toBe(401);
    });
  });

  describe('PATCH /api/admin/modules', () => {
    it("permet à l'admin d'activer un module de son organisation", async () => {
      api.actAs(a.admin);
      const { status, body } = await readJson<{ module: { enabled: boolean } }>(
        await patchModule(
          jsonRequest('PATCH', '/api/admin/modules', { moduleKey: 'event', enabled: false }),
        ),
      );
      expect(status).toBe(200);
      expect(body.module.enabled).toBe(false);

      // Remise en état.
      await patchModule(
        jsonRequest('PATCH', '/api/admin/modules', { moduleKey: 'event', enabled: true }),
      );
    });

    it("ne touche JAMAIS la ligne de l'autre organisation", async () => {
      api.actAs(a.admin);
      await patchModule(
        jsonRequest('PATCH', '/api/admin/modules', { moduleKey: 'event', enabled: false }),
      );

      const other = await db.queryOne<{ enabled: boolean }>(
        OWNER,
        'select enabled from public.organisation_modules where organisation_id = $1 and module_key = $2',
        [b.organisationId, 'event'],
      );
      expect(other?.enabled).toBe(true);

      api.actAs(a.admin);
      await patchModule(
        jsonRequest('PATCH', '/api/admin/modules', { moduleKey: 'event', enabled: true }),
      );
    });

    it("refuse à un editor d'activer un module", async () => {
      api.actAs(a.editor);
      const { status, body } = await readJson<ApiError>(
        await patchModule(
          jsonRequest('PATCH', '/api/admin/modules', { moduleKey: 'event', enabled: false }),
        ),
      );
      expect(status).toBe(403);
      expect(body.error.code).toBe('forbidden');
    });

    it('refuse un module non concédé à son organisation', async () => {
      await db.query(
        OWNER,
        'delete from public.organisation_modules where organisation_id = $1 and module_key = $2',
        [a.organisationId, 'event'],
      );

      api.actAs(a.admin);
      const response = await patchModule(
        jsonRequest('PATCH', '/api/admin/modules', { moduleKey: 'event', enabled: true }),
      );
      expect(response.status).toBe(403);

      await db.query(
        OWNER,
        `insert into public.organisation_modules (organisation_id, module_key)
         values ($1, 'event') on conflict do nothing`,
        [a.organisationId],
      );
    });

    it('refuse une clé de module malformée', async () => {
      api.actAs(a.admin);
      const response = await patchModule(
        jsonRequest('PATCH', '/api/admin/modules', {
          moduleKey: 'event; drop table profiles',
          enabled: true,
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  describe('suppression groupée de réponses', () => {
    /**
     * Le geste demandé par le client : cocher plusieurs invités, un seul
     * bouton. Ce qui se vérifie ici, ce sont les deux garde-fous — le RLS,
     * et la PORTÉE au sondage affiché — plus le chiffre annoncé.
     */
    let une: string;
    let deux: string;
    let autreSondage: string;
    let chezB: string;

    beforeAll(async () => {
      une = await insertResponse(db, a.survey, { q1: 'première' });
      deux = await insertResponse(db, a.survey, { q1: 'deuxième' });
      autreSondage = await insertResponse(db, a.eventSurvey, { q1: 'ailleurs' });
      chezB = await insertResponse(db, b.survey, { q1: 'chez B' });
    }, 120_000);

    const vivante = async (id: string): Promise<boolean> => {
      const row = await db.queryOne<{ deleted_at: string | null }>(
        OWNER,
        'select deleted_at from public.survey_responses where id = $1',
        [id],
      );
      return row?.deleted_at === null;
    };

    it('supprime la sélection en une fois, et ne compte que ce qu’elle a écrit', async () => {
      api.actAs(a.editor);
      const context = await resolveRequestContext();

      // La sélection comporte volontairement une réponse d'un AUTRE sondage de
      // la même organisation, et une réponse de l'organisation B : le RLS
      // écarte la seconde, la portée au sondage écarte la première.
      const result = await softDeleteResponses(context, a.survey, [
        une,
        deux,
        autreSondage,
        chezB,
      ]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.ids.sort()).toEqual([une, deux].sort());

      expect(await vivante(une)).toBe(false);
      expect(await vivante(deux)).toBe(false);
      // Les deux réponses hors portée sont intactes.
      expect(await vivante(autreSondage)).toBe(true);
      expect(await vivante(chezB)).toBe(true);
    });

    it('ne re-date pas une réponse déjà supprimée', async () => {
      // Sinon le délai de grâce avant la purge repartirait de zéro, et le
      // compte rendu annoncerait une suppression qui n'a pas eu lieu.
      api.actAs(a.editor);
      const context = await resolveRequestContext();

      const before = await db.queryOne<{ deleted_at: string }>(
        OWNER,
        'select deleted_at from public.survey_responses where id = $1',
        [une],
      );

      const result = await softDeleteResponses(context, a.survey, [une]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.ids).toEqual([]);

      const after = await db.queryOne<{ deleted_at: string }>(
        OWNER,
        'select deleted_at from public.survey_responses where id = $1',
        [une],
      );
      // PGlite renvoie un `Date`, pas une chaîne : la comparaison est donc
      // structurelle, sinon deux instants identiques échoueraient sur
      // l'identité de l'objet.
      expect(after?.deleted_at).toEqual(before?.deleted_at);
    });

    it('n’écrit rien pour une sélection vide, sans appeler la base', async () => {
      api.actAs(a.editor);
      const context = await resolveRequestContext();
      const result = await softDeleteResponses(context, a.survey, []);
      expect(result).toEqual({ ok: true, value: { ids: [] } });
    });

    it('refuse à un lecteur ce qu’il accorde à un éditeur', async () => {
      const troisieme = await insertResponse(db, a.survey, { q1: 'troisième' });

      api.actAs(a.viewer);
      const refused = await softDeleteResponses(await resolveRequestContext(), a.survey, [
        troisieme,
      ]);
      // Le RLS ne refuse pas l'écriture : il ne voit simplement aucune ligne à
      // écrire. Le résultat est donc vide, et la réponse reste vivante.
      expect(refused.ok).toBe(true);
      expect(await vivante(troisieme)).toBe(true);

      api.actAs(a.editor);
      const allowed = await softDeleteResponses(await resolveRequestContext(), a.survey, [
        troisieme,
      ]);
      expect(allowed.ok).toBe(true);
      if (!allowed.ok) return;
      expect(allowed.value.ids).toEqual([troisieme]);
    });
  });

  describe('GET /api/admin/members', () => {
    it("ne montre que les membres de sa propre organisation", async () => {
      api.actAs(a.admin);
      const { body } = await readJson<{ members: { id: string; email: string }[] }>(
        await listMembers(jsonRequest('GET', '/api/admin/members')),
      );
      const ids = body.members.map((m) => m.id);
      expect(ids).toContain(a.admin);
      expect(ids).toContain(a.editor);
      expect(ids).not.toContain(b.admin);
      expect(ids).not.toContain(superAdmin);
    });

    it("ne montre à un editor que son propre profil", async () => {
      api.actAs(a.editor);
      const { body } = await readJson<{ members: { id: string }[] }>(
        await listMembers(jsonRequest('GET', '/api/admin/members')),
      );
      expect(body.members.map((m) => m.id)).toEqual([a.editor]);
    });
  });

  describe('PATCH /api/admin/members', () => {
    it("permet à l'admin de changer le rôle d'un membre de son organisation", async () => {
      api.actAs(a.admin);
      const { status, body } = await readJson<{ member: { role: string } }>(
        await patchMember(
          jsonRequest('PATCH', '/api/admin/members', { memberId: a.viewer, role: 'editor' }),
        ),
      );
      expect(status).toBe(200);
      expect(body.member.role).toBe('editor');

      api.actAs(a.admin);
      await patchMember(
        jsonRequest('PATCH', '/api/admin/members', { memberId: a.viewer, role: 'viewer' }),
      );
    });

    it("refuse de modifier un membre d'une autre organisation", async () => {
      api.actAs(a.admin);
      const { status, body } = await readJson<ApiError>(
        await patchMember(
          jsonRequest('PATCH', '/api/admin/members', { memberId: b.editor, role: 'viewer' }),
        ),
      );
      expect(status).toBe(403);
      expect(body.error.code).toBe('forbidden');

      const untouched = await db.queryOne<{ role: string }>(
        OWNER,
        'select role from public.profiles where id = $1',
        [b.editor],
      );
      expect(untouched?.role).toBe('editor');
    });

    it("refuse l'auto-promotion", async () => {
      api.actAs(a.editor);
      const response = await patchMember(
        jsonRequest('PATCH', '/api/admin/members', { memberId: a.editor, role: 'admin' }),
      );
      expect(response.status).toBe(403);
    });

    it("refuse à un admin de se modifier lui-même", async () => {
      api.actAs(a.admin);
      const response = await patchMember(
        jsonRequest('PATCH', '/api/admin/members', { memberId: a.admin, role: 'viewer' }),
      );
      expect(response.status).toBe(403);
    });

    it('refuse le rôle super_admin', async () => {
      api.actAs(a.admin);
      const response = await patchMember(
        jsonRequest('PATCH', '/api/admin/members', { memberId: a.editor, role: 'super_admin' }),
      );
      expect(response.status).toBe(400);
    });

    it('applique une surcharge de module par utilisateur', async () => {
      api.actAs(a.admin);
      const response = await patchMember(
        jsonRequest('PATCH', '/api/admin/members', {
          memberId: a.editor,
          moduleOverrides: [{ moduleKey: 'event', allowed: false }],
        }),
      );
      expect(response.status).toBe(200);

      const override = await db.queryOne<{ allowed: boolean }>(
        OWNER,
        'select allowed from public.profile_module_overrides where profile_id = $1 and module_key = $2',
        [a.editor, 'event'],
      );
      expect(override?.allowed).toBe(false);
    });

    it("refuse une surcharge sur un membre d'une autre organisation", async () => {
      api.actAs(a.admin);
      const response = await patchMember(
        jsonRequest('PATCH', '/api/admin/members', {
          memberId: b.editor,
          moduleOverrides: [{ moduleKey: 'event', allowed: true }],
        }),
      );
      expect(response.status).toBe(403);

      const leaked = await db.query(
        OWNER,
        'select 1 from public.profile_module_overrides where profile_id = $1',
        [b.editor],
      );
      expect(leaked).toEqual([]);
    });

    it('refuse une requête sans aucune modification', async () => {
      api.actAs(a.admin);
      const response = await patchMember(
        jsonRequest('PATCH', '/api/admin/members', { memberId: a.editor }),
      );
      expect(response.status).toBe(400);
    });

    it('refuse un identifiant de membre qui n’est pas un UUID', async () => {
      api.actAs(a.admin);
      const response = await patchMember(
        jsonRequest('PATCH', '/api/admin/members', { memberId: 'x', role: 'viewer' }),
      );
      expect(response.status).toBe(400);
    });
  });
});
