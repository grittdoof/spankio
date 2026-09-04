import { NextResponse, type NextRequest } from 'next/server';
import { EnvError } from '@/lib/config/env';
import { logger } from '@/lib/logger';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Middleware : rafraîchissement de la session et barrière d'accès.
 *
 * Le contrôle fin des droits reste au RLS ; ici on évite seulement d'afficher
 * une coquille d'administration à un visiteur non authentifié.
 */

const PROTECTED_PREFIXES = ['/admin', '/super-admin', '/demande-de-rattachement'] as const;

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  let userId: string | null = null;
  let response: NextResponse;

  try {
    const session = await updateSession(request);
    response = session.response;
    userId = session.userId;
  } catch (error) {
    // Configuration incomplète : on ne casse pas les pages publiques, mais
    // `userId` reste nul, donc les espaces protégés se referment. Le défaut de
    // configuration est bruyant dans les journaux, jamais silencieux.
    if (error instanceof EnvError) {
      logger.error(
        'middleware.env_missing',
        "Variables Supabase absentes : sessions désactivées, espaces protégés fermés.",
        { missing: error.missing },
      );
    } else {
      logger.error('middleware.session_failed', 'Rafraîchissement de session impossible.', {}, error);
    }
    response = NextResponse.next({ request });
  }

  if (!userId && isProtected(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/connexion';
    // Aucun paramètre propagé : une URL de retour serait un vecteur de
    // redirection ouverte, et pourrait contenir des données personnelles.
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Tout sauf les ressources statiques : la session doit être rafraîchie
    // aussi sur les routes API, sinon elle expire pendant une navigation.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
