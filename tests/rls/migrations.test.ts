import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER, createTestDb, type TestDb } from '../helpers/db';

describe('migrations', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it('crée toutes les tables attendues', async () => {
    const rows = await db.query<{ tablename: string }>(
      OWNER,
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      'audit_log',
      'erasure_requests',
      'membership_requests',
      'modules',
      'organisation_modules',
      'organisations',
      'platform_settings',
      'profile_module_overrides',
      'profiles',
      'survey_responses',
      'surveys',
    ]);
  });

  it('active le RLS sur toutes les tables publiques', async () => {
    const rows = await db.query<{ relname: string }>(
      OWNER,
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and not c.relrowsecurity
        order by c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('sème le catalogue de modules avec core marqué comme tel', async () => {
    const rows = await db.query<{ key: string; is_core: boolean }>(
      OWNER,
      'select key, is_core from public.modules order by sort_order',
    );
    expect(rows).toEqual([
      { key: 'core', is_core: true },
      { key: 'event', is_core: false },
    ]);
  });

  it('sème la ligne unique de platform_settings', async () => {
    const rows = await db.query<{ id: number }>(OWNER, 'select id from public.platform_settings');
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('est rejouable : toutes les migrations passent deux fois', async () => {
    const { applyMigrations } = await import('../helpers/db');
    await expect(applyMigrations(db.pg)).resolves.toBeInstanceOf(Array);

    // Les seeds ne sont pas dupliqués.
    const modules = await db.query<{ count: number }>(
      OWNER,
      'select count(*)::int as count from public.modules',
    );
    expect(modules[0]?.count).toBe(2);
    const settings = await db.query<{ count: number }>(
      OWNER,
      'select count(*)::int as count from public.platform_settings',
    );
    expect(settings[0]?.count).toBe(1);
  }, 120_000);
});
