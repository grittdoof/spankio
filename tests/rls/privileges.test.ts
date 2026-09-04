import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER, asUser, createTestDb, expectError, sqlErrorCode, type TestDb } from '../helpers/db';
import {
  activateMember,
  createAccount,
  createOrganisation,
  createSurvey,
  grantModule,
  insertResponse,
  setModuleOverride,
} from '../helpers/seed';

describe('escalade de privilèges', () => {
  let db: TestDb;
  let orgId: string;
  let admin: string;
  let editor: string;
  let viewer: string;
  let superAdmin: string;

  beforeAll(async () => {
    db = await createTestDb();
    orgId = await createOrganisation(db, 'org-priv', 'Organisation privilèges');
    superAdmin = await createAccount(db, 'super@priv.test');
    admin = await createAccount(db, 'admin@priv.test');
    editor = await createAccount(db, 'editor@priv.test');
    viewer = await createAccount(db, 'viewer@priv.test');
    await activateMember(db, superAdmin, null, 'super_admin');
    await activateMember(db, admin, orgId, 'admin');
    await activateMember(db, editor, orgId, 'editor');
    await activateMember(db, viewer, orgId, 'viewer');
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it('un viewer ne peut pas se promouvoir admin', async () => {
    const error = await expectError(
      db.query(asUser(viewer), "update public.profiles set role = 'admin' where id = $1", [viewer]),
    );
    expect(sqlErrorCode(error)).toBe('42501');

    const check = await db.queryOne<{ role: string }>(
      OWNER,
      'select role from public.profiles where id = $1',
      [viewer],
    );
    expect(check?.role).toBe('viewer');
  });

  it('un editor ne peut pas se promouvoir super_admin', async () => {
    const error = await expectError(
      db.query(asUser(editor), "update public.profiles set role = 'super_admin' where id = $1", [
        editor,
      ]),
    );
    expect(sqlErrorCode(error)).toBe('42501');
  });

  it("un utilisateur ne peut pas changer son propre rattachement", async () => {
    const other = await createOrganisation(db, 'org-autre', 'Autre organisation');
    const error = await expectError(
      db.query(asUser(editor), 'update public.profiles set organisation_id = $2 where id = $1', [
        editor,
        other,
      ]),
    );
    expect(sqlErrorCode(error)).toBe('42501');
  });

  it("un utilisateur suspendu ne peut pas se réactiver", async () => {
    const suspended = await createAccount(db, 'suspendu@priv.test');
    await db.query(
      OWNER,
      `update public.profiles set organisation_id = $2, role = 'editor', status = 'suspended'
        where id = $1`,
      [suspended, orgId],
    );
    const error = await expectError(
      db.query(asUser(suspended), "update public.profiles set status = 'active' where id = $1", [
        suspended,
      ]),
    );
    expect(sqlErrorCode(error)).toBe('42501');
  });

  it('un admin ne peut pas promouvoir un membre super_admin', async () => {
    const error = await expectError(
      db.query(asUser(admin), "update public.profiles set role = 'super_admin' where id = $1", [
        editor,
      ]),
    );
    expect(sqlErrorCode(error)).toBe('42501');
  });

  it('un admin ne peut pas se promouvoir lui-même', async () => {
    const error = await expectError(
      db.query(asUser(admin), "update public.profiles set role = 'super_admin' where id = $1", [
        admin,
      ]),
    );
    expect(sqlErrorCode(error)).toBe('42501');
  });

  it('un admin peut changer le rôle d’un membre de son organisation', async () => {
    const rows = await db.query<{ id: string }>(
      asUser(admin),
      "update public.profiles set role = 'viewer' where id = $1 returning id",
      [editor],
    );
    expect(rows).toEqual([{ id: editor }]);

    // Remise en état pour les tests suivants.
    await activateMember(db, editor, orgId, 'editor');
  });

  it('chacun peut modifier son propre nom sans toucher à ses droits', async () => {
    const rows = await db.query<{ full_name: string }>(
      asUser(viewer),
      "update public.profiles set full_name = 'Nouveau nom' where id = $1 returning full_name",
      [viewer],
    );
    expect(rows).toEqual([{ full_name: 'Nouveau nom' }]);
  });

  it('personne ne peut créer un profil directement (aucune policy d’insertion)', async () => {
    const account = await createAccount(db, 'fantome@priv.test');
    await db.query(OWNER, 'delete from public.profiles where id = $1', [account]);

    const error = await expectError(
      db.query(
        asUser(admin),
        `insert into public.profiles (id, email, role, status, organisation_id)
         values ($1, 'fantome@priv.test', 'admin', 'active', $2)`,
        [account, orgId],
      ),
    );
    expect(sqlErrorCode(error)).toBe('42501');
  });

  it('un profil est créé automatiquement à l’inscription, inerte', async () => {
    const account = await createAccount(db, 'nouveau@priv.test', 'Nouveau Venu');
    const profile = await db.queryOne<{
      role: string;
      status: string;
      organisation_id: string | null;
      full_name: string;
    }>(OWNER, 'select role, status, organisation_id, full_name from public.profiles where id = $1', [
      account,
    ]);
    expect(profile).toEqual({
      role: 'viewer',
      status: 'pending',
      organisation_id: null,
      full_name: 'Nouveau Venu',
    });
  });
});

describe('restriction des modules par utilisateur', () => {
  let db: TestDb;
  let orgId: string;
  let admin: string;
  let editorWithEvent: string;
  let editorWithoutEvent: string;
  let eventSurvey: string;

  beforeAll(async () => {
    db = await createTestDb();
    orgId = await createOrganisation(db, 'org-mod', 'Organisation modules');
    await grantModule(db, orgId, 'event');

    admin = await createAccount(db, 'admin@mod.test');
    editorWithEvent = await createAccount(db, 'avec@mod.test');
    editorWithoutEvent = await createAccount(db, 'sans@mod.test');
    await activateMember(db, admin, orgId, 'admin');
    await activateMember(db, editorWithEvent, orgId, 'editor');
    await activateMember(db, editorWithoutEvent, orgId, 'editor');

    // La surcharge par utilisateur interdit le module à ce compte précis,
    // alors que l'organisation y a bien droit.
    await setModuleOverride(db, editorWithoutEvent, 'event', false);
    await setModuleOverride(db, editorWithEvent, 'event', true);

    eventSurvey = await createSurvey(db, {
      organisationId: orgId,
      slug: 'gala',
      moduleKey: 'event',
      kind: 'event',
    });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it('le module core est toujours autorisé', async () => {
    const rows = await db.query<{ ok: boolean }>(
      asUser(editorWithoutEvent),
      "select app.can_use_module('core') as ok",
    );
    expect(rows[0]?.ok).toBe(true);
  });

  it('la surcharge utilisateur prime sur l’activation de l’organisation', async () => {
    const denied = await db.query<{ ok: boolean }>(
      asUser(editorWithoutEvent),
      "select app.can_use_module('event') as ok",
    );
    expect(denied[0]?.ok).toBe(false);

    const allowed = await db.query<{ ok: boolean }>(
      asUser(editorWithEvent),
      "select app.can_use_module('event') as ok",
    );
    expect(allowed[0]?.ok).toBe(true);
  });

  it('sans surcharge, l’activation de l’organisation s’applique', async () => {
    const neutral = await createAccount(db, 'neutre@mod.test');
    await activateMember(db, neutral, orgId, 'editor');
    const rows = await db.query<{ ok: boolean }>(
      asUser(neutral),
      "select app.can_use_module('event') as ok",
    );
    expect(rows[0]?.ok).toBe(true);

    await grantModule(db, orgId, 'event', false);
    const afterDisable = await db.query<{ ok: boolean }>(
      asUser(neutral),
      "select app.can_use_module('event') as ok",
    );
    expect(afterDisable[0]?.ok).toBe(false);
    await grantModule(db, orgId, 'event', true);
  });

  it('un compte privé du module ne peut pas créer de sondage de ce module', async () => {
    const error = await expectError(
      db.query(
        asUser(editorWithoutEvent),
        `insert into public.surveys (organisation_id, module_key, slug, title, kind)
         values ($1, 'event', 'interdit', 'Interdit', 'event')`,
        [orgId],
      ),
    );
    expect(sqlErrorCode(error)).toBe('42501');
  });

  it('un compte autorisé peut créer un sondage de ce module', async () => {
    const rows = await db.query<{ id: string }>(
      asUser(editorWithEvent),
      `insert into public.surveys (organisation_id, module_key, slug, title, kind)
       values ($1, 'event', 'autorise', 'Autorisé', 'event')
       returning id`,
      [orgId],
    );
    expect(rows).toHaveLength(1);
  });

  it('un compte privé du module ne peut pas modifier un sondage de ce module', async () => {
    const rows = await db.query(
      asUser(editorWithoutEvent),
      "update public.surveys set title = 'Détourné' where id = $1 returning id",
      [eventSurvey],
    );
    expect(rows).toEqual([]);
  });

  it('la restriction s’applique aussi aux réponses (ressource imbriquée)', async () => {
    const responseId = await insertResponse(db, eventSurvey, { presence: 'oui' });

    const denied = await db.query<{ id: string }>(
      asUser(editorWithoutEvent),
      'select id from public.survey_responses where survey_id = $1',
      [eventSurvey],
    );
    expect(denied).toEqual([]);

    const allowed = await db.query<{ id: string }>(
      asUser(editorWithEvent),
      'select id from public.survey_responses where survey_id = $1',
      [eventSurvey],
    );
    expect(allowed).toEqual([{ id: responseId }]);
  });

  it('un admin ne peut pas autoriser un module que son organisation n’a pas', async () => {
    await db.query(OWNER, 'delete from public.organisation_modules where organisation_id = $1', [
      orgId,
    ]);
    const error = await expectError(
      db.query(
        asUser(admin),
        `insert into public.profile_module_overrides (profile_id, module_key, allowed)
         values ($1, 'event', true)`,
        [admin],
      ),
    );
    expect(sqlErrorCode(error)).toBe('42501');
    await grantModule(db, orgId, 'event');
  });
});
