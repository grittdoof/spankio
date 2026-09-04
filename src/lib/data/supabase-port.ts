import type { PostgrestError } from '@supabase/supabase-js';
import {
  NOT_FOUND,
  assertColumnList,
  assertIdentifier,
  clampLimit,
  dbFail,
  dbOk,
  type DataPort,
  type DbFilter,
  type DbResult,
  type SelectQuery,
} from './port';

/**
 * Adaptateur de production : traduit le port en appels `@supabase/supabase-js`.
 *
 * Le client passé ici est TOUJOURS un client authentifié, donc soumis au RLS :
 * c'est le chemin par défaut de l'application. Le `service role` n'entre jamais
 * par cette porte ; les rares tâches qui en ont besoin construisent leur propre
 * client avec une justification à l'endroit de l'appel.
 *
 * On ne dépend pas du type `SupabaseClient` complet : il est paramétré par le
 * schéma généré, ce qui casserait dès qu'un client est construit avec des
 * génériques légèrement différents. À la place, `from()` et `rpc()` renvoient
 * `unknown` et sont convertis UNE FOIS vers les interfaces ci-dessous, qui
 * décrivent exactement le sous-ensemble utilisé. Après cette conversion, tout
 * le code de l'adaptateur est typé.
 */

export interface SupabaseLike {
  from(table: string): unknown;
  rpc(fn: string, args?: Readonly<Record<string, unknown>>): unknown;
}

interface PostgrestResponse<T> {
  data: T | null;
  error: PostgrestError | null;
}

/** Sous-ensemble du constructeur de requêtes PostgREST réellement utilisé. */
interface QueryBuilder<T> extends PromiseLike<PostgrestResponse<T[]>> {
  select(columns: string): QueryBuilder<T>;
  single(): PromiseLike<PostgrestResponse<T>>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  neq(column: string, value: unknown): QueryBuilder<T>;
  not(column: string, operator: string, value: unknown): QueryBuilder<T>;
  in(column: string, values: unknown): QueryBuilder<T>;
  is(column: string, value: unknown): QueryBuilder<T>;
  gt(column: string, value: unknown): QueryBuilder<T>;
  gte(column: string, value: unknown): QueryBuilder<T>;
  lt(column: string, value: unknown): QueryBuilder<T>;
  lte(column: string, value: unknown): QueryBuilder<T>;
  like(column: string, value: unknown): QueryBuilder<T>;
  order(column: string, options: { ascending: boolean }): QueryBuilder<T>;
  limit(count: number): QueryBuilder<T>;
}

interface TableBuilder<T> {
  select(columns: string): QueryBuilder<T>;
  insert(values: Readonly<Record<string, unknown>>): QueryBuilder<T>;
  upsert(
    values: Readonly<Record<string, unknown>>,
    options: { onConflict: string },
  ): QueryBuilder<T>;
  update(values: Readonly<Record<string, unknown>>): QueryBuilder<T>;
  delete(): QueryBuilder<T>;
}

function toDbError(error: PostgrestError) {
  return {
    code: error.code || 'unknown',
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  };
}

function applyFilters<T>(
  builder: QueryBuilder<T>,
  where: readonly DbFilter[] | undefined,
): QueryBuilder<T> {
  let current = builder;
  for (const filter of where ?? []) {
    const column = assertIdentifier(filter.column, 'Colonne');
    switch (filter.op) {
      case 'eq':
        current = current.eq(column, filter.value);
        break;
      case 'neq':
        current =
          filter.value === null
            ? current.not(column, 'is', null)
            : current.neq(column, filter.value);
        break;
      case 'in':
        current = current.in(column, filter.value);
        break;
      case 'is':
        current = current.is(column, filter.value);
        break;
      case 'gt':
        current = current.gt(column, filter.value);
        break;
      case 'gte':
        current = current.gte(column, filter.value);
        break;
      case 'lt':
        current = current.lt(column, filter.value);
        break;
      case 'lte':
        current = current.lte(column, filter.value);
        break;
      case 'like':
        current = current.like(column, filter.value);
        break;
    }
  }
  return current;
}

export function createSupabasePort(client: SupabaseLike): DataPort {
  /** Unique point de conversion depuis les types génériques de Supabase. */
  function table<T>(name: string): TableBuilder<T> {
    return client.from(assertIdentifier(name, 'Table')) as TableBuilder<T>;
  }

  async function select<T>(query: SelectQuery): Promise<DbResult<T[]>> {
    let builder = table<T>(query.table).select(assertColumnList(query.columns));
    builder = applyFilters(builder, query.where);
    if (query.order) {
      builder = builder.order(assertIdentifier(query.order.column, 'Colonne'), {
        ascending: query.order.ascending ?? true,
      });
    }
    const { data, error } = await builder.limit(clampLimit(query.limit));
    if (error) return dbFail(toDbError(error));
    return dbOk(data ?? []);
  }

  return {
    select,

    async selectOne<T>(query: Omit<SelectQuery, 'limit'>): Promise<DbResult<T>> {
      const result = await select<T>({ ...query, limit: 1 });
      if (result.error) return dbFail(result.error);
      const row = result.data[0];
      return row === undefined ? dbFail(NOT_FOUND) : dbOk(row);
    },

    async insert<T>(
      name: string,
      values: Readonly<Record<string, unknown>>,
      returning = '*',
    ): Promise<DbResult<T>> {
      const { data, error } = await table<T>(name)
        .insert(values)
        .select(assertColumnList(returning))
        .single();
      if (error) return dbFail(toDbError(error));
      return data === null ? dbFail(NOT_FOUND) : dbOk(data);
    },

    async upsert<T>(
      name: string,
      values: Readonly<Record<string, unknown>>,
      conflictColumns: readonly string[],
      returning = '*',
    ): Promise<DbResult<T>> {
      const conflict = conflictColumns.map((column) => assertIdentifier(column, 'Colonne'));
      const { data, error } = await table<T>(name)
        .upsert(values, { onConflict: conflict.join(',') })
        .select(assertColumnList(returning))
        .single();
      if (error) return dbFail(toDbError(error));
      return data === null ? dbFail(NOT_FOUND) : dbOk(data);
    },

    async update<T>(
      name: string,
      values: Readonly<Record<string, unknown>>,
      where: readonly DbFilter[],
      returning = '*',
    ): Promise<DbResult<T[]>> {
      const builder = applyFilters(table<T>(name).update(values), where);
      const { data, error } = await builder.select(assertColumnList(returning));
      if (error) return dbFail(toDbError(error));
      return dbOk(data ?? []);
    },

    async remove<T>(
      name: string,
      where: readonly DbFilter[],
      returning = '*',
    ): Promise<DbResult<T[]>> {
      const builder = applyFilters(table<T>(name).delete(), where);
      const { data, error } = await builder.select(assertColumnList(returning));
      if (error) return dbFail(toDbError(error));
      return dbOk(data ?? []);
    },

    async rpc<T>(
      fn: string,
      args?: Readonly<Record<string, unknown>>,
    ): Promise<DbResult<T>> {
      const { data, error } = (await client.rpc(
        assertIdentifier(fn, 'Fonction'),
        args ?? {},
      )) as PostgrestResponse<T>;
      if (error) return dbFail(toDbError(error));
      return dbOk(data as T);
    },
  };
}
