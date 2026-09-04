import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Harnais de base de données pour les tests.
 *
 * Les migrations RÉELLES de `supabase/migrations` sont rejouées dans une
 * instance PostgreSQL en processus (PGlite) : les policies, contraintes,
 * triggers et fonctions testés sont exactement ceux de la production.
 *
 * Ce que le harnais émule, faute de Supabase : le schéma `auth`, la table
 * `auth.users`, la fonction `auth.uid()` et les rôles `anon`, `authenticated`,
 * `service_role`. C'est un écart assumé et documenté (CLAUDE.md, risque R9).
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));

/**
 * Reproduction du contexte Supabase.
 *
 * `auth.uid()` lit `request.jwt.claims`, exactement comme sur Supabase, où
 * PostgREST pose ce réglage à partir du JWT. Les tests peuvent donc changer
 * d'identité sans jamais toucher aux migrations.
 */
const PRELUDE = `
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', ''),
    current_setting('role', true)
  )
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
`;

export type ActorRole = 'anon' | 'authenticated' | 'service_role' | 'postgres';

export interface Actor {
  readonly role: ActorRole;
  readonly userId?: string;
}

/** Visiteur non authentifié (clé anonyme Supabase). */
export const ANON: Actor = { role: 'anon' };

/** Contexte serveur de confiance : contourne le RLS (bypassrls). */
export const SERVICE: Actor = { role: 'service_role' };

/** Contexte de migration / propriétaire du schéma. */
export const OWNER: Actor = { role: 'postgres' };

/** Utilisateur authentifié porteur d'un JWT dont `sub` vaut `id`. */
export function asUser(id: string): Actor {
  return { role: 'authenticated', userId: id };
}

const ALLOWED_ROLES: readonly ActorRole[] = ['anon', 'authenticated', 'service_role', 'postgres'];

export interface TestDb {
  readonly pg: PGlite;
  /** Exécute une requête dans le contexte d'un acteur donné. */
  query<R>(actor: Actor, sql: string, params?: readonly unknown[]): Promise<R[]>;
  /** Comme `query`, mais renvoie la première ligne (ou undefined). */
  queryOne<R>(actor: Actor, sql: string, params?: readonly unknown[]): Promise<R | undefined>;
  close(): Promise<void>;
}

async function migrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

/** Applique le prélude puis toutes les migrations, dans l'ordre des noms. */
export async function applyMigrations(pg: PGlite): Promise<string[]> {
  await pg.exec(PRELUDE);
  const files = await migrationFiles();
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await pg.exec(sql);
    } catch (error) {
      throw new Error(
        `Échec de la migration ${file} : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return files;
}

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.waitReady;
  await applyMigrations(pg);

  async function query<R>(
    actor: Actor,
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<R[]> {
    if (!ALLOWED_ROLES.includes(actor.role)) {
      throw new Error(`Rôle de test inconnu : ${actor.role}`);
    }

    return pg.transaction(async (tx) => {
      // `set local` : le rôle et les claims retombent à la fin de la transaction.
      await tx.exec(`set local role ${actor.role}`);
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        actor.userId ? JSON.stringify({ sub: actor.userId, role: actor.role }) : '',
      ]);
      const result = await tx.query<R>(sql, params as unknown[]);
      return result.rows;
    });
  }

  return {
    pg,
    query,
    async queryOne<R>(
      actor: Actor,
      sql: string,
      params?: readonly unknown[],
    ): Promise<R | undefined> {
      const rows = await query<R>(actor, sql, params);
      return rows[0];
    },
    async close() {
      await pg.close();
    },
  };
}

/**
 * Erreur SQL telle que remontée par PGlite, avec son SQLSTATE : les tests
 * vérifient les codes applicatifs (PT404, PT409…) et non des messages.
 */
export function sqlErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Capture l'erreur d'une promesse (ou échoue si elle réussit). */
export async function expectError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('La requête a réussi alors qu’un refus était attendu');
}
