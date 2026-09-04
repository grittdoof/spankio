/**
 * Journalisation structurée.
 *
 * Une erreur ne part JAMAIS dans un `console.error` nu : elle sort en JSON sur
 * une ligne, avec un événement nommé et un contexte exploitable par un
 * collecteur. Le puits est remplaçable (`setLogSink`) pour brancher Sentry à
 * l'étape de durcissement sans toucher aux appelants.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  /** Nom d'événement stable, en pointillé : `email.send_failed`. */
  event: string;
  message?: string;
  /** Contexte structuré. Ne doit contenir aucune donnée personnelle. */
  context?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
  timestamp: string;
}

export type LogSink = (record: LogRecord) => void;

function defaultSink(record: LogRecord): void {
  const line = JSON.stringify(record);
  if (record.level === 'error') {
    console.error(line);
  } else if (record.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

let sink: LogSink = defaultSink;

export function setLogSink(next: LogSink): void {
  sink = next;
}

export function resetLogSink(): void {
  sink = defaultSink;
}

/**
 * Décrit une valeur non typée sans jamais produire « [object Object] », qui
 * rendrait le journal inutile au moment où on en a le plus besoin.
 */
function describeUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null) return 'null';
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[function ${value.name || 'anonyme'}]`;
  try {
    return JSON.stringify(value) ?? 'valeur non sérialisable';
  } catch {
    return 'valeur non sérialisable';
  }
}

function normaliseError(error: unknown): LogRecord['error'] {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
  }
  if (error === undefined) return undefined;
  return { name: 'NonError', message: describeUnknown(error) };
}

function emit(
  level: LogLevel,
  event: string,
  message?: string,
  context?: Record<string, unknown>,
  error?: unknown,
): void {
  const normalised = normaliseError(error);
  sink({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...(message ? { message } : {}),
    ...(context ? { context } : {}),
    ...(normalised ? { error: normalised } : {}),
  });
}

export const logger = {
  debug: (event: string, message?: string, context?: Record<string, unknown>) =>
    emit('debug', event, message, context),
  info: (event: string, message?: string, context?: Record<string, unknown>) =>
    emit('info', event, message, context),
  warn: (event: string, message?: string, context?: Record<string, unknown>) =>
    emit('warn', event, message, context),
  error: (
    event: string,
    message?: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ) => emit('error', event, message, context, error),
};
