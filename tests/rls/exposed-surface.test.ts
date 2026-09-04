import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER, createTestDb, type TestDb } from '../helpers/db';

/**
 * SURFACE EXPOSÉE PAR L'API.
 *
 * Ce test existe à cause d'une faille réelle, trouvée en déployant sur un vrai
 * projet Supabase : PostgREST publie AUTOMATIQUEMENT toute fonction du schéma
 * `public` que le rôle appelant peut exécuter, et PostgreSQL accorde par
 * défaut `EXECUTE` à `PUBLIC` sur toute nouvelle fonction (Supabase y ajoute
 * des droits nommés pour `anon` et `authenticated`).
 *
 * Résultat avant correction : `write_audit` était appelable par un visiteur
 * anonyme via `/rest/v1/rpc/write_audit`, ce qui permettait de forger des
 * entrées du journal d'audit ; et plusieurs fonctions internes divulguaient le
 * rattachement ou les droits de comptes tiers à partir de leur identifiant.
 *
 * La règle est donc devenue : le schéma `public` ne contient QUE des fonctions
 * destinées à être appelées par le réseau, et chacune est listée ici. Ajouter
 * une fonction interne dans `public` fait échouer ce test.
 */

/** Fonctions que l'application appelle réellement par RPC, et pour quel rôle. */
const SURFACE_ATTENDUE: Readonly<Record<string, { anon: boolean; authenticated: boolean }>> = {
  // Soumission publique et dépôt d'une demande d'effacement : sans compte.
  submit_survey_response: { anon: true, authenticated: true },
  request_erasure: { anon: true, authenticated: true },
  // Actes d'administration : session obligatoire.
  approve_membership_request: { anon: false, authenticated: true },
  reject_membership_request: { anon: false, authenticated: true },
  apply_erasure: { anon: false, authenticated: true },
  purge_expired_responses: { anon: false, authenticated: true },
  purge_deleted_surveys: { anon: false, authenticated: true },
  my_modules: { anon: false, authenticated: true },
};

interface FunctionRow {
  nom: string;
  anon: boolean;
  authenticated: boolean;
  definer: boolean;
}

describe('surface exposée par PostgREST', () => {
  let db: TestDb;
  let fonctions: FunctionRow[];

  beforeAll(async () => {
    db = await createTestDb();
    fonctions = await db.query<FunctionRow>(
      OWNER,
      `select p.proname as nom,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              p.prosecdef as definer
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
        order by p.proname`,
    );
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  /**
   * Fonctions installées par la PLATEFORME Supabase elle-même dans `public`.
   * Elles ne nous appartiennent pas et n'existent pas sous PGlite : on les
   * exclut nommément plutôt que d'assouplir l'invariant.
   */
  const FONCTIONS_SUPABASE = ['rls_auto_enable'];

  it('le schéma public ne contient que les fonctions destinées au réseau', () => {
    const miennes = fonctions
      .map((f) => f.nom)
      .filter((nom) => !FONCTIONS_SUPABASE.includes(nom));
    expect(miennes.sort()).toEqual(Object.keys(SURFACE_ATTENDUE).sort());
  });

  it.each(Object.entries(SURFACE_ATTENDUE))(
    '%s : droits exactement conformes à ce qui est déclaré',
    (nom, attendu) => {
      const fonction = fonctions.find((f) => f.nom === nom);
      expect(fonction, `fonction ${nom} absente`).toBeDefined();
      expect({ anon: fonction!.anon, authenticated: fonction!.authenticated }).toEqual(attendu);
    },
  );

  it('aucune fonction du schéma privé n’est exécutable par un visiteur anonyme', async () => {
    const rows = await db.query<{ nom: string }>(
      OWNER,
      `select p.proname as nom
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and has_function_privilege('anon', p.oid, 'execute')
        order by p.proname`,
    );
    expect(rows.map((r) => r.nom)).toEqual([]);
  });

  it('le schéma privé n’accorde EXECUTE qu’aux fonctions appelées dans une policy', async () => {
    const rows = await db.query<{ nom: string }>(
      OWNER,
      `select p.proname as nom
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and has_function_privilege('authenticated', p.oid, 'execute')
        order by p.proname`,
    );
    // Une policy RLS est évaluée avec les droits de l'appelant : ces fonctions
    // doivent rester exécutables. Toutes les autres (write_audit, dedup_hash,
    // fonctions de trigger…) n'ont aucune raison de l'être.
    expect(rows.map((r) => r.nom)).toEqual([
      'can_use_module',
      'can_write_surveys',
      'is_active_member',
      'is_org_admin',
      'is_super_admin',
      'my_org_id',
      'org_has_module',
      'profile_org_id',
      'survey_module_key',
    ]);
  });

  it('write_audit n’est appelable par personne d’autre que le propriétaire', async () => {
    const rows = await db.query<{ anon: boolean; authenticated: boolean }>(
      OWNER,
      `select has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'write_audit'`,
    );
    expect(rows).toEqual([{ anon: false, authenticated: false }]);
  });

  it('aucune table du schéma privé (il n’en contient aucune, par construction)', async () => {
    const rows = await db.query<{ nom: string }>(
      OWNER,
      "select tablename as nom from pg_tables where schemaname = 'app'",
    );
    expect(rows).toEqual([]);
  });

  it('les vues n’exposent au visiteur anonyme que le seul accès public prévu', async () => {
    const rows = await db.query<{ vue: string; anon: boolean; authenticated: boolean }>(
      OWNER,
      `select c.relname as vue,
              has_table_privilege('anon', c.oid, 'select') as anon,
              has_table_privilege('authenticated', c.oid, 'select') as authenticated
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v'
        order by c.relname`,
    );

    // `public_surveys` est le SEUL accès anonyme aux sondages. L'annuaire des
    // organisations et les statistiques exigent une session : sur un vrai
    // Supabase, les default privileges les avaient rendus publics.
    expect(rows).toEqual([
      { vue: 'organisation_directory', anon: false, authenticated: true },
      { vue: 'public_surveys', anon: true, authenticated: true },
      { vue: 'survey_stats', anon: false, authenticated: true },
    ]);
  });

  it('les tables n’exposent au visiteur anonyme que les réglages de plateforme', async () => {
    const rows = await db.query<{ table_name: string }>(
      OWNER,
      `select c.relname as table_name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and has_table_privilege('anon', c.oid, 'select')
        order by c.relname`,
    );
    // Les pages légales doivent être consultables sans compte ; rien d'autre.
    expect(rows.map((r) => r.table_name)).toEqual(['platform_settings']);
  });

  it('aucune table n’accepte d’écriture anonyme', async () => {
    const rows = await db.query<{ table_name: string }>(
      OWNER,
      `select c.relname as table_name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and (has_table_privilege('anon', c.oid, 'insert')
            or has_table_privilege('anon', c.oid, 'update')
            or has_table_privilege('anon', c.oid, 'delete'))
        order by c.relname`,
    );
    expect(rows).toEqual([]);
  });

  it('les fonctions SECURITY DEFINER figent toutes leur search_path', async () => {
    const rows = await db.query<{ nom: string; schema: string }>(
      OWNER,
      `select p.proname as nom, n.nspname as schema
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app')
          and p.prosecdef
          and not exists (
            select 1 from unnest(coalesce(p.proconfig, '{}')) as c(setting)
            where c.setting like 'search_path=%'
          )
        order by p.proname`,
    );
    expect(rows.map((r) => `${r.schema}.${r.nom}`)).toEqual([]);
  });
});
