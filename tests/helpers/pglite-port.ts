import {
  NOT_FOUND,
  assertColumnList,
  assertIdentifier,
  clampLimit,
  dbFail,
  dbOk,
  type DataPort,
  type DbError,
  type DbFilter,
  type DbResult,
  type SelectQuery,
} from '@/lib/data/port';
import { sqlErrorCode, type Actor, type TestDb } from './db';

/**
 * Adaptateur de test : la MÊME interface que l'adaptateur Supabase, mais
 * exécutée sur PGlite avec le rôle et les claims de l'acteur.
 *
 * C'est ce qui permet d'exécuter les vraies routes API contre les vraies
 * policies RLS. Un client Supabase simulé aurait rendu l'isolation
 * multi-tenant indémontrable : on aurait testé le simulateur.
 */

function toDbError(error: unknown): DbError {
  const code = sqlErrorCode(error) ?? 'unknown';
  const message = error instanceof Error ? error.message : String(code);
  return { code, message };
}

function renderFilters(
  where: readonly DbFilter[] | undefined,
  params: unknown[],
): string {
  if (!where || where.length === 0) return '';
  const clauses = where.map((filter) => {
    const column = assertIdentifier(filter.column, 'Colonne');
    switch (filter.op) {
      case 'is':
        return filter.value === null ? `${column} is null` : `${column} is not null`;
      case 'neq':
        if (filter.value === null) return `${column} is not null`;
        params.push(filter.value);
        return `${column} <> $${params.length}`;
      case 'in': {
        const values = filter.value as readonly unknown[];
        if (values.length === 0) return 'false';
        params.push(values);
        return `${column} = any($${params.length})`;
      }
      case 'eq':
        params.push(filter.value);
        return `${column} = $${params.length}`;
      case 'gt':
        params.push(filter.value);
        return `${column} > $${params.length}`;
      case 'gte':
        params.push(filter.value);
        return `${column} >= $${params.length}`;
      case 'lt':
        params.push(filter.value);
        return `${column} < $${params.length}`;
      case 'lte':
        params.push(filter.value);
        return `${column} <= $${params.length}`;
      case 'like':
        params.push(filter.value);
        return `${column} like $${params.length}`;
    }
  });
  return ` where ${clauses.join(' and ')}`;
}

export function createPglitePort(db: TestDb, actor: Actor): DataPort {
  async function run<T>(sql: string, params: unknown[]): Promise<DbResult<T[]>> {
    try {
      return dbOk(await db.query<T>(actor, sql, params));
    } catch (error) {
      return dbFail(toDbError(error));
    }
  }

  async function select<T>(query: SelectQuery): Promise<DbResult<T[]>> {
    const table = assertIdentifier(query.table, 'Table');
    const columns = assertColumnList(query.columns);
    const params: unknown[] = [];
    let sql = `select ${columns} from public.${table}${renderFilters(query.where, params)}`;
    if (query.order) {
      sql += ` order by ${assertIdentifier(query.order.column, 'Colonne')} ${
        query.order.ascending ?? true ? 'asc' : 'desc'
      }`;
    }
    sql += ` limit ${clampLimit(query.limit)}`;
    return run<T>(sql, params);
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
      table: string,
      values: Readonly<Record<string, unknown>>,
      returning = '*',
    ): Promise<DbResult<T>> {
      const safeTable = assertIdentifier(table, 'Table');
      const entries = Object.entries(values);
      const columns = entries.map(([column]) => assertIdentifier(column, 'Colonne'));
      const params = entries.map(([, value]) => value);
      const placeholders = params.map((_, index) => `$${index + 1}`);
      const sql =
        `insert into public.${safeTable} (${columns.join(', ')}) ` +
        `values (${placeholders.join(', ')}) returning ${assertColumnList(returning)}`;
      const result = await run<T>(sql, params);
      if (result.error) return dbFail(result.error);
      const row = result.data[0];
      return row === undefined ? dbFail(NOT_FOUND) : dbOk(row);
    },

    async upsert<T>(
      table: string,
      values: Readonly<Record<string, unknown>>,
      conflictColumns: readonly string[],
      returning = '*',
    ): Promise<DbResult<T>> {
      const safeTable = assertIdentifier(table, 'Table');
      const conflict = conflictColumns.map((column) => assertIdentifier(column, 'Colonne'));
      const entries = Object.entries(values);
      const columns = entries.map(([column]) => assertIdentifier(column, 'Colonne'));
      const params = entries.map(([, value]) => value);
      const placeholders = params.map((_, index) => `$${index + 1}`);
      const updates = columns
        .filter((column) => !conflict.includes(column))
        .map((column) => `${column} = excluded.${column}`);
      const sql =
        `insert into public.${safeTable} (${columns.join(', ')}) ` +
        `values (${placeholders.join(', ')}) ` +
        `on conflict (${conflict.join(', ')}) do ` +
        (updates.length > 0 ? `update set ${updates.join(', ')} ` : 'nothing ') +
        `returning ${assertColumnList(returning)}`;
      const result = await run<T>(sql, params);
      if (result.error) return dbFail(result.error);
      const row = result.data[0];
      return row === undefined ? dbFail(NOT_FOUND) : dbOk(row);
    },

    async update<T>(
      table: string,
      values: Readonly<Record<string, unknown>>,
      where: readonly DbFilter[],
      returning = '*',
    ): Promise<DbResult<T[]>> {
      const safeTable = assertIdentifier(table, 'Table');
      const entries = Object.entries(values);
      const params: unknown[] = entries.map(([, value]) => value);
      const assignments = entries.map(
        ([column], index) => `${assertIdentifier(column, 'Colonne')} = $${index + 1}`,
      );
      const sql =
        `update public.${safeTable} set ${assignments.join(', ')}` +
        `${renderFilters(where, params)} returning ${assertColumnList(returning)}`;
      return run<T>(sql, params);
    },

    async remove<T>(
      table: string,
      where: readonly DbFilter[],
      returning = '*',
    ): Promise<DbResult<T[]>> {
      const safeTable = assertIdentifier(table, 'Table');
      const params: unknown[] = [];
      const sql =
        `delete from public.${safeTable}${renderFilters(where, params)} ` +
        `returning ${assertColumnList(returning)}`;
      return run<T>(sql, params);
    },

    async rpc<T>(
      fn: string,
      args?: Readonly<Record<string, unknown>>,
    ): Promise<DbResult<T>> {
      const safeFn = assertIdentifier(fn, 'Fonction');
      const entries = Object.entries(args ?? {});
      const params = entries.map(([, value]) => value);
      // Appel par nom d'argument : identique à ce que fait PostgREST.
      const named = entries.map(
        ([name], index) => `${assertIdentifier(name, 'Argument')} => $${index + 1}`,
      );
      const sql = `select public.${safeFn}(${named.join(', ')}) as result`;
      const result = await run<{ result: T }>(sql, params);
      if (result.error) return dbFail(result.error);
      return dbOk(result.data[0]?.result as T);
    },
  };
}
