/**
 * Port d'accès aux données.
 *
 * Les routes API et les services ne connaissent que cette interface, jamais le
 * client Supabase. Raison : pouvoir exécuter le MÊME code de route contre un
 * vrai PostgreSQL en test (PGlite, avec les vraies policies) au lieu de le
 * tester contre un client simulé qui rendrait l'isolation multi-tenant
 * déclarative. L'implémentation de production est un adaptateur mince sur
 * `@supabase/ssr` (donc soumis au RLS via la session de l'appelant).
 *
 * Le port est délibérément étroit : pas de constructeur de requêtes chaînable,
 * juste ce que l'application utilise. Chaque lecture passe par une structure
 * inspectable, ce qui permet d'imposer des garde-fous (plafond de lignes).
 */

/** Plafond appliqué à toute lecture qui n'en précise pas : anti-export massif. */
export const DEFAULT_ROW_LIMIT = 200;
export const MAX_ROW_LIMIT = 5000;

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'is'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like';

export interface DbFilter {
  readonly column: string;
  readonly op: FilterOperator;
  readonly value: unknown;
}

export const eq = (column: string, value: unknown): DbFilter => ({ column, op: 'eq', value });
export const neq = (column: string, value: unknown): DbFilter => ({ column, op: 'neq', value });
export const isNull = (column: string): DbFilter => ({ column, op: 'is', value: null });
export const isNotNull = (column: string): DbFilter => ({
  column,
  op: 'neq',
  value: null,
});
export const inList = (column: string, values: readonly unknown[]): DbFilter => ({
  column,
  op: 'in',
  value: values,
});
export const gte = (column: string, value: unknown): DbFilter => ({ column, op: 'gte', value });
export const lte = (column: string, value: unknown): DbFilter => ({ column, op: 'lte', value });

export interface SelectQuery {
  readonly table: string;
  /** Colonnes à lire. `*` est autorisé mais découragé hors administration. */
  readonly columns: string;
  readonly where?: readonly DbFilter[];
  readonly order?: { readonly column: string; readonly ascending?: boolean };
  readonly limit?: number;
}

export interface DbError {
  /** SQLSTATE (`42501`, `PT409`…) ou code du transport. */
  readonly code: string;
  readonly message: string;
  readonly details?: string;
}

/**
 * Résultat d'un accès aux données, en union discriminée : si `error` est nul,
 * `data` est garanti présent. Le typage force donc l'appelant à traiter
 * l'erreur avant de lire la donnée, au lieu de le laisser déréférencer un
 * `data` optionnel.
 */
export type DbResult<T> = { readonly data: T; readonly error: null } | {
  readonly data: null;
  readonly error: DbError;
};

export function dbOk<T>(data: T): DbResult<T> {
  return { data, error: null };
}

export function dbFail<T>(error: DbError): DbResult<T> {
  return { data: null, error };
}

/**
 * Convention : toute fonction appelée via `rpc` renvoie une valeur scalaire ou
 * du `jsonb`. Une fonction renvoyant un ensemble de lignes se comporterait
 * différemment selon l'adaptateur (tableau côté PostgREST, lignes multiples en
 * SQL direct), ce qui ferait diverger production et tests.
 */
export interface DataPort {
  select<T>(query: SelectQuery): Promise<DbResult<T[]>>;
  /** Renvoie la ligne unique attendue, ou une erreur `PT404` si absente. */
  selectOne<T>(query: Omit<SelectQuery, 'limit'>): Promise<DbResult<T>>;
  insert<T>(
    table: string,
    values: Readonly<Record<string, unknown>>,
    returning?: string,
  ): Promise<DbResult<T>>;
  /** Insertion ou mise à jour sur conflit de clé (surcharges de modules…). */
  upsert<T>(
    table: string,
    values: Readonly<Record<string, unknown>>,
    conflictColumns: readonly string[],
    returning?: string,
  ): Promise<DbResult<T>>;
  update<T>(
    table: string,
    values: Readonly<Record<string, unknown>>,
    where: readonly DbFilter[],
    returning?: string,
  ): Promise<DbResult<T[]>>;
  remove<T>(
    table: string,
    where: readonly DbFilter[],
    returning?: string,
  ): Promise<DbResult<T[]>>;
  rpc<T>(fn: string, args?: Readonly<Record<string, unknown>>): Promise<DbResult<T>>;
}

/** Code renvoyé quand `selectOne` ne trouve rien. */
export const NOT_FOUND: DbError = {
  code: 'PT404',
  message: 'Ressource introuvable',
};

/** Code renvoyé quand une écriture est refusée par le RLS. */
export function isPermissionDenied(error: DbError | null): boolean {
  return error?.code === '42501' || error?.code === 'PT403';
}

/** Une contrainte d'unicité a sauté (anti-doublon, slug déjà pris…). */
export function isUniqueViolation(error: DbError | null): boolean {
  return error?.code === '23505' || error?.code === 'PT409';
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_ROW_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_ROW_LIMIT;
  return Math.min(Math.floor(limit), MAX_ROW_LIMIT);
}

/**
 * Les noms de table et de colonne ne viennent jamais d'une entrée utilisateur,
 * mais l'adaptateur PGlite les interpole dans du SQL : on refuse tout
 * identifiant qui n'est pas un nom simple, pour que ce soit vrai par
 * construction et non par convention.
 */
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

export function assertIdentifier(name: string, kind: string): string {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(`${kind} invalide : « ${name} »`);
  }
  return name;
}

/** Valide une liste de colonnes de projection (`a, b, c` ou `*`). */
export function assertColumnList(columns: string): string {
  const trimmed = columns.trim();
  if (trimmed === '*') return trimmed;
  const parts = trimmed.split(',').map((part) => part.trim());
  for (const part of parts) {
    assertIdentifier(part, 'Colonne');
  }
  return parts.join(', ');
}
