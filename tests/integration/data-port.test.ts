import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, isNull } from '@/lib/data/port';
import { ANON, OWNER, asUser, createTestDb, type TestDb } from '../helpers/db';
import { createPglitePort } from '../helpers/pglite-port';
import { activateMember, createAccount, createOrganisation, createSurvey } from '../helpers/seed';

/**
 * L'adaptateur de test doit se comporter comme l'adaptateur Supabase : mêmes
 * signatures, mêmes conventions d'erreur. Si ce contrat dérive, les tests
 * d'intégration ne prouvent plus rien sur le code de production.
 */
describe('adaptateur PGlite du port de données', () => {
  let db: TestDb;
  let orgId: string;
  let editor: string;
  let surveyId: string;

  beforeAll(async () => {
    db = await createTestDb();
    orgId = await createOrganisation(db, 'org-port', 'Organisation port');
    editor = await createAccount(db, 'editor@port.test');
    await activateMember(db, editor, orgId, 'editor');
    surveyId = await createSurvey(db, { organisationId: orgId, slug: 'via-port' });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it('lit avec projection et filtres', async () => {
    const port = createPglitePort(db, asUser(editor));
    const { data, error } = await port.select<{ slug: string; title: string }>({
      table: 'surveys',
      columns: 'slug, title',
      where: [eq('organisation_id', orgId), isNull('deleted_at')],
      order: { column: 'slug' },
    });
    expect(error).toBeNull();
    expect(data).toEqual([{ slug: 'via-port', title: 'Sondage via-port' }]);
  });

  it('renvoie PT404 quand selectOne ne trouve rien', async () => {
    const port = createPglitePort(db, asUser(editor));
    const { data, error } = await port.selectOne({
      table: 'surveys',
      columns: 'id',
      where: [eq('slug', 'inexistant')],
    });
    expect(data).toBeNull();
    expect(error?.code).toBe('PT404');
  });

  it('remonte le refus du RLS sous forme de code 42501', async () => {
    const port = createPglitePort(db, ANON);
    const { error } = await port.select({ table: 'surveys', columns: 'id' });
    expect(error?.code).toBe('42501');
  });

  it('écrit, met à jour et supprime en respectant le RLS', async () => {
    const port = createPglitePort(db, asUser(editor));

    const created = await port.insert<{ id: string; slug: string }>(
      'surveys',
      { organisation_id: orgId, slug: 'cree-par-port', title: 'Créé par le port' },
      'id, slug',
    );
    expect(created.error).toBeNull();
    expect(created.data?.slug).toBe('cree-par-port');

    const updated = await port.update<{ title: string }>(
      'surveys',
      { title: 'Titre corrigé' },
      [eq('id', created.data!.id)],
      'title',
    );
    expect(updated.data).toEqual([{ title: 'Titre corrigé' }]);

    const removed = await port.remove<{ id: string }>(
      'surveys',
      [eq('id', created.data!.id)],
      'id',
    );
    expect(removed.data).toEqual([{ id: created.data!.id }]);
  });

  it('appelle une fonction avec des arguments nommés', async () => {
    const port = createPglitePort(db, ANON);
    const { data, error } = await port.rpc<string>('submit_survey_response', {
      p_survey_id: surveyId,
      p_data: { q1: 'via rpc' },
    });
    expect(error).toBeNull();
    expect(data).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('remonte les SQLSTATE applicatifs des RPC', async () => {
    const port = createPglitePort(db, ANON);
    const { error } = await port.rpc('submit_survey_response', {
      p_survey_id: '00000000-0000-0000-0000-000000000000',
      p_data: {},
    });
    expect(error?.code).toBe('PT404');
  });

  it('plafonne les lectures non bornées', async () => {
    const port = createPglitePort(db, OWNER);
    for (let i = 0; i < 5; i += 1) {
      await createSurvey(db, { organisationId: orgId, slug: `masse-${i}` });
    }
    const { data } = await port.select({ table: 'surveys', columns: 'id', limit: 2 });
    expect(data).toHaveLength(2);
  });

  it('refuse un identifiant de table ou de colonne non conforme', async () => {
    const port = createPglitePort(db, asUser(editor));
    await expect(
      port.select({ table: 'surveys; drop table profiles', columns: 'id' }),
    ).rejects.toThrow(/Table invalide/);
    await expect(
      port.select({ table: 'surveys', columns: 'id, (select 1)' }),
    ).rejects.toThrow(/Colonne invalide/);
  });
});
