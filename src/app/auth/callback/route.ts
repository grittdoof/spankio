import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * Retour des liens envoyés par courriel (confirmation d'adresse,
 * réinitialisation de mot de passe) : échange le code contre une session.
 *
 * Le paramètre `suite` ne peut désigner qu'un chemin interne : accepter une URL
 * absolue ferait de cette route un tremplin de redirection ouverte, utilisable
 * pour de l'hameçonnage depuis un domaine de confiance.
 */
function safeNextPath(value: string | null): string {
  if (!value) return '/admin';
  if (!value.startsWith('/') || value.startsWith('//')) return '/admin';
  return value;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('suite'));

  if (!code) {
    return NextResponse.redirect(new URL('/connexion?erreur=sessionExpired', url.origin));
  }

  const client = await createSupabaseServerClient();
  const { error } = await client.auth.exchangeCodeForSession(code);

  if (error) {
    logger.warn('auth.callback_failed', "Échange du code d'authentification refusé.", {
      reason: error.message,
    });
    return NextResponse.redirect(new URL('/connexion?erreur=sessionExpired', url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
