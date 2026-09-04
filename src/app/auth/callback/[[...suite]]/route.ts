import { NextResponse } from 'next/server';
import { callbackDestination, callbackErrorCode } from '@/lib/auth/callback';
import { logger } from '@/lib/logger';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Retour des liens envoyés par courriel : confirmation d'adresse et
 * réinitialisation de mot de passe.
 *
 * La destination est un SEGMENT DE CHEMIN (`/auth/callback/nouveau-mot-de-passe`)
 * plutôt qu'un paramètre d'URL, et elle est résolue dans une liste fermée.
 * Deux bénéfices : aucune redirection arbitraire n'est possible, et l'URL à
 * autoriser dans Supabase est fixe et sans chaîne de requête.
 *
 * Les erreurs renvoyées par Supabase sont traduites et affichées. Les ignorer
 * afficherait une page normale sur une URL incompréhensible.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ suite?: string[] }> },
): Promise<Response> {
  const url = new URL(request.url);
  const { suite } = await params;
  const destination = callbackDestination(suite);

  // 1. Supabase a refusé le lien : on le dit, sur l'écran qui permet d'en
  //    redemander un.
  const errorCode = callbackErrorCode(
    url.searchParams.get('error_code'),
    url.searchParams.get('error'),
  );
  if (errorCode !== null) {
    logger.warn('auth.callback_refused', 'Lien de courriel refusé par le service.', {
      errorCode: url.searchParams.get('error_code'),
      error: url.searchParams.get('error'),
      destination,
    });
    return NextResponse.redirect(
      new URL(`${retryPathFor(destination)}?erreur=${errorCode}`, url.origin),
    );
  }

  // 2. Aucun code : le lien est incomplet, ou déjà consommé par un service
  //    d'analyse de courriels.
  const code = url.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(
      new URL(`${retryPathFor(destination)}?erreur=linkInvalid`, url.origin),
    );
  }

  const client = await createSupabaseServerClient();
  const { error } = await client.auth.exchangeCodeForSession(code);

  if (error) {
    logger.warn('auth.callback_failed', "Échange du code d'authentification refusé.", {
      reason: error.message,
      destination,
    });
    return NextResponse.redirect(
      new URL(`${retryPathFor(destination)}?erreur=linkInvalid`, url.origin),
    );
  }

  return NextResponse.redirect(new URL(destination, url.origin));
}

/**
 * Écran où renvoyer en cas d'échec : celui qui permet de redemander un lien du
 * même type. Renvoyer vers la connexion après un lien de réinitialisation
 * périmé obligerait l'utilisateur à retrouver seul le bon parcours.
 */
function retryPathFor(destination: string): string {
  return destination === '/nouveau-mot-de-passe' ? '/mot-de-passe-oublie' : '/connexion';
}
