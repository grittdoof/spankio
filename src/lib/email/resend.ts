import { logger } from '@/lib/logger';

/**
 * Envoi d'emails transactionnels via l'API REST Resend, en `fetch` direct
 * (aucun SDK, conformément à la stack imposée).
 *
 * RÈGLE ABSOLUE : un envoi d'email ne fait JAMAIS échouer une action métier.
 * Cette fonction ne lève jamais. Clé absente, domaine non vérifié, panne de
 * Resend : on journalise et on renvoie `{ sent: false, reason }`. L'appelant
 * décide s'il le signale à l'utilisateur, mais l'inscription, la validation ou
 * la soumission qui vient d'aboutir reste aboutie.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface EmailMessage {
  to: string | readonly string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export type EmailFailureReason =
  | 'not_configured'
  | 'invalid_recipient'
  | 'http_error'
  | 'network_error';

export interface EmailResult {
  sent: boolean;
  id?: string;
  reason?: EmailFailureReason;
  /** Code HTTP si Resend a répondu en erreur. */
  status?: number;
}

export interface EmailDeps {
  fetch?: typeof globalThis.fetch;
  apiKey?: string | undefined;
  from?: string | undefined;
  timeoutMs?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function isPlausibleEmail(value: unknown): boolean {
  return typeof value === 'string' && value.length <= 320 && EMAIL_RE.test(value.trim());
}

export async function sendEmail(
  message: EmailMessage,
  deps: EmailDeps = {},
): Promise<EmailResult> {
  const apiKey = deps.apiKey ?? process.env.RESEND_API_KEY;
  const from = deps.from ?? process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    // Dégradation silencieuse : attendue en développement et en CI.
    logger.warn(
      'email.not_configured',
      'RESEND_API_KEY ou EMAIL_FROM absent : aucun email envoyé.',
      { subject: message.subject },
    );
    return { sent: false, reason: 'not_configured' };
  }

  const recipients = (Array.isArray(message.to) ? message.to : [message.to]).filter(
    isPlausibleEmail,
  );
  if (recipients.length === 0) {
    logger.warn('email.invalid_recipient', 'Aucun destinataire valide.', {
      subject: message.subject,
    });
    return { sent: false, reason: 'invalid_recipient' };
  }

  try {
    const response = await (deps.fetch ?? globalThis.fetch)(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5000),
      cache: 'no-store',
    });

    if (!response.ok) {
      logger.error('email.send_failed', "Resend a refusé l'envoi.", {
        status: response.status,
        subject: message.subject,
      });
      return { sent: false, reason: 'http_error', status: response.status };
    }

    const payload = (await response.json().catch(() => null)) as { id?: string } | null;
    logger.info('email.sent', 'Email transactionnel envoyé.', {
      subject: message.subject,
      recipients: recipients.length,
    });
    return { sent: true, ...(payload?.id ? { id: payload.id } : {}) };
  } catch (error) {
    logger.error(
      'email.network_error',
      'Resend injoignable : action métier conservée, email perdu.',
      { subject: message.subject },
      error,
    );
    return { sent: false, reason: 'network_error' };
  }
}
