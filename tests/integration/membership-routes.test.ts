import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as getMe } from '@/app/api/me/route';
import { GET as listOrganisations } from '@/app/api/organisations/route';
import {
  GET as listRequests,
  POST as createRequest,
} from '@/app/api/membership-requests/route';
import { POST as approveRequest } from '@/app/api/super-admin/membership-requests/[id]/approve/route';
import { POST as rejectRequest } from '@/app/api/super-admin/membership-requests/[id]/reject/route';
import { OWNER, createTestDb, type TestDb } from '../helpers/db';
import { resetMemoryLimiter } from '@/lib/security/rate-limit';
import {
  createRouteHarness,
  jsonRequest,
  readJson,
  type ApiError,
  type RouteHarness,
} from '../helpers/route';
import { activateMember, createAccount, createOrganisation } from '../helpers/seed';

interface RequestBody {
  request: { id: string; status: string; requested_role: string };
  notificationSent: boolean;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('routes de rattachement', () => {
  let db: TestDb;
  let api: RouteHarness;
  let orgId: string;
  let superAdmin: string;
  let candidate: string;
  let otherCandidate: string;

  beforeAll(async () => {
    db = await createTestDb();
    api = createRouteHarness(db);

    orgId = await createOrganisation(db, 'org-routes', 'Organisation Routes');
    superAdmin = await createAccount(db, 'super@routes.test', 'Super Admin');
    await activateMember(db, superAdmin, null, 'super_admin');
    candidate = await createAccount(db, 'candidat@routes.test', 'Camille Candidat');
    otherCandidate = await createAccount(db, 'autre@routes.test', 'Autre Candidat');

    // Adresse de notification de la plateforme : évite d'énumérer les
    // super administrateurs pour envoyer un email.
    await db.query(
      OWNER,
      "update public.platform_settings set notifications_email = 'plateforme@routes.test' where id = 1",
    );
  }, 120_000);

  afterAll(async () => {
    api?.dispose();
    await db?.close();
  });

  beforeEach(() => {
    resetMemoryLimiter();
  });

  describe('POST /api/membership-requests', () => {
    it('refuse un visiteur non authentifié', async () => {
      api.actAsAnonymous();
      const response = await createRequest(
        jsonRequest('POST', '/api/membership-requests', { organisationId: orgId }),
      );
      const { status, body } = await readJson<ApiError>(response);
      expect(status).toBe(401);
      expect(body.error.code).toBe('unauthenticated');
    });

    it('enregistre la demande du compte connecté', async () => {
      api.actAs(candidate, 'candidat@routes.test');
      const response = await createRequest(
        jsonRequest('POST', '/api/membership-requests', {
          organisationId: orgId,
          requestedRole: 'editor',
          message: 'Je gère les inscriptions.',
        }),
      );
      const { status, body } = await readJson<RequestBody>(response);
      expect(status).toBe(201);
      expect(body.request.status).toBe('pending');
      expect(body.request.requested_role).toBe('editor');
      // Aucune clé Resend en test : l'email ne part pas, mais la demande est
      // bien enregistrée. C'est exactement le comportement attendu.
      expect(body.notificationSent).toBe(false);

      const stored = await db.queryOne<{ user_id: string; requester_name: string }>(
        OWNER,
        'select user_id, requester_name from public.membership_requests where id = $1',
        [body.request.id],
      );
      expect(stored?.user_id).toBe(candidate);
      expect(stored?.requester_name).toBe('Camille Candidat');
    });

    it('refuse une seconde demande en attente', async () => {
      api.actAs(candidate, 'candidat@routes.test');
      const response = await createRequest(
        jsonRequest('POST', '/api/membership-requests', { organisationId: orgId }),
      );
      const { status, body } = await readJson<ApiError>(response);
      expect(status).toBe(409);
      expect(body.error.code).toBe('conflict');
    });

    it('refuse un corps incohérent en nommant le champ', async () => {
      api.actAs(otherCandidate);
      const response = await createRequest(
        jsonRequest('POST', '/api/membership-requests', {
          organisationId: orgId,
          organisationName: 'Les deux à la fois',
        }),
      );
      const { status, body } = await readJson<ApiError>(response);
      expect(status).toBe(400);
      expect(body.error.code).toBe('invalid_input');
      expect(Object.keys(body.error.fields ?? {})).toContain('organisationId');
    });

    it('refuse le rôle super_admin', async () => {
      api.actAs(otherCandidate);
      const response = await createRequest(
        jsonRequest('POST', '/api/membership-requests', {
          organisationId: orgId,
          requestedRole: 'super_admin',
        }),
      );
      expect(response.status).toBe(400);
    });

    it('refuse un corps trop volumineux avant même de l’analyser', async () => {
      api.actAs(otherCandidate);
      const response = await createRequest(
        jsonRequest('POST', '/api/membership-requests', {
          organisationId: orgId,
          message: 'x'.repeat(20_000),
        }),
      );
      const { status, body } = await readJson<ApiError>(response);
      expect(status).toBe(413);
      expect(body.error.code).toBe('payload_too_large');
    });

    it('limite le débit par appelant', async () => {
      api.actAs(otherCandidate);
      const ip = '198.51.100.42';
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const response = await createRequest(
          jsonRequest(
            'POST',
            '/api/membership-requests',
            { organisationName: `Organisation ${i}` },
            { ip },
          ),
        );
        statuses.push(response.status);
      }
      // 3 requêtes par heure : la quatrième est refusée, quel que soit le
      // résultat métier des précédentes.
      expect(statuses[3]).toBe(429);
    });
  });

  describe('GET /api/membership-requests', () => {
    it('ne montre au demandeur que ses propres demandes', async () => {
      api.actAs(candidate);
      const { body } = await readJson<{ requests: { user_id: string }[] }>(
        await listRequests(jsonRequest('GET', '/api/membership-requests')),
      );
      expect(body.requests.length).toBeGreaterThan(0);
      expect(body.requests.every((r) => r.user_id === candidate)).toBe(true);
    });

    it('montre toutes les demandes au super administrateur', async () => {
      api.actAs(superAdmin);
      const { body } = await readJson<{ requests: { user_id: string }[] }>(
        await listRequests(jsonRequest('GET', '/api/membership-requests')),
      );
      const owners = new Set(body.requests.map((r) => r.user_id));
      expect(owners.has(candidate)).toBe(true);
      expect(owners.size).toBeGreaterThan(1);
    });

    it('filtre par statut', async () => {
      api.actAs(superAdmin);
      const { body } = await readJson<{ requests: { status: string }[] }>(
        await listRequests(jsonRequest('GET', '/api/membership-requests?status=pending')),
      );
      expect(body.requests.every((r) => r.status === 'pending')).toBe(true);
    });

    it('refuse un statut inconnu', async () => {
      api.actAs(superAdmin);
      const response = await listRequests(
        jsonRequest('GET', '/api/membership-requests?status=nimporte'),
      );
      expect(response.status).toBe(400);
    });
  });

  describe('validation par le super administrateur', () => {
    let requestId: string;

    beforeEach(async () => {
      const account = await createAccount(db, `valide-${crypto.randomUUID()}@routes.test`, 'Valide');
      const row = await db.queryOne<{ id: string }>(
        OWNER,
        `insert into public.membership_requests
           (user_id, requester_email, requester_name, organisation_id, requested_role)
         values ($1, 'valide@routes.test', 'Valide', $2, 'editor')
         returning id`,
        [account, orgId],
      );
      requestId = row!.id;
    });

    it('ne révèle pas l’existence d’une demande qu’on ne peut pas voir', async () => {
      // Le RLS masque la demande d'un autre compte : 404, pas 403. Répondre
      // « interdit » confirmerait que l'identifiant existe.
      api.actAs(candidate);
      const response = await approveRequest(
        jsonRequest('POST', `/api/super-admin/membership-requests/${requestId}/approve`, {
          role: 'editor',
        }),
        params(requestId),
      );
      const { status, body } = await readJson<ApiError>(response);
      expect(status).toBe(404);
      expect(body.error.code).toBe('not_found');
    });

    it('refuse au demandeur de valider sa propre demande', async () => {
      // Ici la demande EST visible (elle est à lui) : c'est la fonction SQL qui
      // refuse, et le refus est donc explicite.
      const account = await createAccount(db, `autopromo-${crypto.randomUUID()}@routes.test`);
      const own = await db.queryOne<{ id: string }>(
        OWNER,
        `insert into public.membership_requests
           (user_id, requester_email, organisation_id, requested_role)
         values ($1, 'autopromo@routes.test', $2, 'admin')
         returning id`,
        [account, orgId],
      );

      api.actAs(account);
      const response = await approveRequest(
        jsonRequest('POST', '/approve', { role: 'admin' }),
        params(own!.id),
      );
      const { status, body } = await readJson<ApiError>(response);
      expect(status).toBe(403);
      expect(body.error.code).toBe('forbidden');
    });

    it('attribue le rôle et les modules choisis', async () => {
      api.actAs(superAdmin);
      const response = await approveRequest(
        jsonRequest('POST', `/api/super-admin/membership-requests/${requestId}/approve`, {
          role: 'editor',
          moduleKeys: ['event'],
        }),
        params(requestId),
      );
      const { status, body } = await readJson<{ organisationId: string }>(response);
      expect(status).toBe(200);
      expect(body.organisationId).toBe(orgId);

      const decided = await db.queryOne<{
        status: string;
        decided_role: string;
        decided_modules: string[];
      }>(
        OWNER,
        'select status, decided_role, decided_modules from public.membership_requests where id = $1',
        [requestId],
      );
      expect(decided).toEqual({
        status: 'approved',
        decided_role: 'editor',
        decided_modules: ['event'],
      });
    });

    it('refuse une seconde décision', async () => {
      api.actAs(superAdmin);
      const first = await approveRequest(
        jsonRequest('POST', '/approve', { role: 'editor' }),
        params(requestId),
      );
      expect(first.status).toBe(200);

      const second = await approveRequest(
        jsonRequest('POST', '/approve', { role: 'admin' }),
        params(requestId),
      );
      const { status, body } = await readJson<ApiError>(second);
      expect(status).toBe(409);
      expect(body.error.code).toBe('conflict');
    });

    it('refuse d’accorder le rôle super_admin', async () => {
      api.actAs(superAdmin);
      const response = await approveRequest(
        jsonRequest('POST', '/approve', { role: 'super_admin' }),
        params(requestId),
      );
      expect(response.status).toBe(400);
    });

    it('refuse un identifiant de demande qui n’est pas un UUID', async () => {
      api.actAs(superAdmin);
      const response = await approveRequest(
        jsonRequest('POST', '/approve', { role: 'editor' }),
        params('pas-un-uuid'),
      );
      expect(response.status).toBe(400);
    });

    it('enregistre un refus motivé', async () => {
      api.actAs(superAdmin);
      const response = await rejectRequest(
        jsonRequest('POST', '/reject', { note: 'Organisation non reconnue.' }),
        params(requestId),
      );
      expect(response.status).toBe(200);

      const decided = await db.queryOne<{ status: string; decision_note: string }>(
        OWNER,
        'select status, decision_note from public.membership_requests where id = $1',
        [requestId],
      );
      expect(decided).toEqual({
        status: 'rejected',
        decision_note: 'Organisation non reconnue.',
      });
    });

    it('refuse un refus par un compte ordinaire', async () => {
      // Demande d'autrui : masquée par le RLS, donc 404.
      api.actAs(candidate);
      const invisible = await rejectRequest(
        jsonRequest('POST', '/reject', {}),
        params(requestId),
      );
      expect(invisible.status).toBe(404);

      // Sa propre demande : visible, mais la fonction SQL refuse la décision.
      const account = await createAccount(db, `refus-${crypto.randomUUID()}@routes.test`);
      const own = await db.queryOne<{ id: string }>(
        OWNER,
        `insert into public.membership_requests
           (user_id, requester_email, organisation_id, requested_role)
         values ($1, 'refus@routes.test', $2, 'editor')
         returning id`,
        [account, orgId],
      );
      api.actAs(account);
      const visible = await rejectRequest(jsonRequest('POST', '/reject', {}), params(own!.id));
      expect(visible.status).toBe(403);
    });
  });

  describe('création d’organisation à la validation', () => {
    it('dérive l’identifiant d’URL depuis le nom demandé', async () => {
      const account = await createAccount(db, 'fondateur@routes.test', 'Fondateur');
      const row = await db.queryOne<{ id: string }>(
        OWNER,
        `insert into public.membership_requests
           (user_id, requester_email, requested_organisation_name, requested_role)
         values ($1, 'fondateur@routes.test', 'Association Été 2027', 'admin')
         returning id`,
        [account],
      );

      api.actAs(superAdmin);
      const response = await approveRequest(
        jsonRequest('POST', '/approve', { role: 'admin', moduleKeys: ['event'] }),
        params(row!.id),
      );
      const { status, body } = await readJson<{ organisationId: string }>(response);
      expect(status).toBe(200);

      const organisation = await db.queryOne<{ slug: string; name: string }>(
        OWNER,
        'select slug, name from public.organisations where id = $1',
        [body.organisationId],
      );
      // Diacritiques retirés, espaces en tirets.
      expect(organisation).toEqual({ slug: 'association-ete-2027', name: 'Association Été 2027' });
    });

    it('refuse un nom dont on ne peut dériver aucun identifiant', async () => {
      const account = await createAccount(db, 'symboles@routes.test', 'Symboles');
      const row = await db.queryOne<{ id: string }>(
        OWNER,
        `insert into public.membership_requests
           (user_id, requester_email, requested_organisation_name, requested_role)
         values ($1, 'symboles@routes.test', '!!!', 'admin')
         returning id`,
        [account],
      );

      api.actAs(superAdmin);
      const response = await approveRequest(
        jsonRequest('POST', '/approve', { role: 'admin' }),
        params(row!.id),
      );
      const { status, body } = await readJson<ApiError>(response);
      expect(status).toBe(400);
      expect(body.error.code).toBe('invalid_input');
    });
  });

  describe('GET /api/organisations', () => {
    it("permet à un compte inerte de choisir l'organisation à rejoindre", async () => {
      const pending = await createAccount(db, 'choix@routes.test', 'Choix');
      api.actAs(pending, 'choix@routes.test');

      const { status, body } = await readJson<{
        organisations: { slug: string; name: string }[];
      }>(await listOrganisations(jsonRequest('GET', '/api/organisations')));

      expect(status).toBe(200);
      expect(body.organisations.map((o) => o.slug)).toContain('org-routes');
    });

    it("n'expose pour autant pas la table des organisations", async () => {
      const pending = await createAccount(db, 'curieux@routes.test', 'Curieux');
      api.actAs(pending, 'curieux@routes.test');

      // L'annuaire ne donne que de quoi choisir : ni coordonnées, ni réglages.
      const { body } = await readJson<{
        organisations: Record<string, unknown>[];
      }>(await listOrganisations(jsonRequest('GET', '/api/organisations')));
      const first = body.organisations[0]!;
      expect(Object.keys(first).sort()).toEqual(['id', 'logoUrl', 'name', 'slug']);

      // Et la table elle-même reste masquée pour ce compte.
      const direct = await db.query(
        { role: 'authenticated', userId: pending },
        'select id from public.organisations',
      );
      expect(direct).toEqual([]);
    });

    it('masque une organisation désactivée', async () => {
      const hidden = await createOrganisation(db, 'org-cachee', 'Organisation Cachée');
      await db.query(OWNER, 'update public.organisations set is_active = false where id = $1', [
        hidden,
      ]);

      const pending = await createAccount(db, 'filtre@routes.test', 'Filtre');
      api.actAs(pending, 'filtre@routes.test');
      const { body } = await readJson<{ organisations: { slug: string }[] }>(
        await listOrganisations(jsonRequest('GET', '/api/organisations')),
      );
      expect(body.organisations.map((o) => o.slug)).not.toContain('org-cachee');
    });

    it('refuse un visiteur anonyme', async () => {
      api.actAsAnonymous();
      expect((await listOrganisations(jsonRequest('GET', '/api/organisations'))).status).toBe(401);
    });
  });

  describe('GET /api/me', () => {
    it('refuse un visiteur anonyme', async () => {
      api.actAsAnonymous();
      expect((await getMe(jsonRequest('GET', '/api/me'))).status).toBe(401);
    });

    it('renvoie le profil, l’organisation et les modules autorisés', async () => {
      const member = await createAccount(db, 'membre@routes.test', 'Membre');
      await activateMember(db, member, orgId, 'editor');
      await db.query(
        OWNER,
        `insert into public.organisation_modules (organisation_id, module_key)
         values ($1, 'event') on conflict do nothing`,
        [orgId],
      );
      await db.query(
        OWNER,
        `insert into public.profile_module_overrides (profile_id, module_key, allowed)
         values ($1, 'event', false)
         on conflict (profile_id, module_key) do update set allowed = false`,
        [member],
      );

      api.actAs(member, 'membre@routes.test');
      const { status, body } = await readJson<{
        profile: { role: string; organisationId: string };
        organisation: { slug: string } | null;
        modules: { key: string; allowed: boolean; isCore: boolean }[];
      }>(await getMe(jsonRequest('GET', '/api/me')));

      expect(status).toBe(200);
      expect(body.profile.role).toBe('editor');
      expect(body.organisation?.slug).toBe('org-routes');

      const core = body.modules.find((m) => m.key === 'core');
      const event = body.modules.find((m) => m.key === 'event');
      expect(core).toMatchObject({ isCore: true, allowed: true });
      // Interdit nominativement, alors que l'organisation a le module.
      expect(event).toMatchObject({ allowed: false });
    });

    it('ne renvoie rien de plus qu’un profil en attente pour un compte inerte', async () => {
      const pending = await createAccount(db, 'inerte@routes.test', 'Inerte');
      api.actAs(pending, 'inerte@routes.test');
      const { body } = await readJson<{
        profile: { role: string; status: string; organisationId: string | null };
        organisation: unknown;
      }>(await getMe(jsonRequest('GET', '/api/me')));

      expect(body.profile).toMatchObject({
        role: 'viewer',
        status: 'pending',
        organisationId: null,
      });
      expect(body.organisation).toBeNull();
    });
  });
});
