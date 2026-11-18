import { NextResponse, type NextRequest } from 'next/server';
import { safeAfterSignIn } from '@/lib/auth/after-sign-in';
import { EnvError } from '@/lib/config/env';
import { logger } from '@/lib/logger';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Middleware : rafraîchissement de la session et barrière d'accès.
 *
 * Le contrôle fin des droits reste au RLS ; ici on évite seulement d'afficher
 * une coquille d'administration à un visiteur non authentifié.
 *
 * **Ce fichier vivait à la racine du dépôt, et Next ne l'exécutait donc
 * JAMAIS.** Avec un répertoire `src/`, c'est `src/middleware.ts` qui est lu —
 * un `middleware.ts` à côté de lui est un fichier ordinaire, que rien ne
 * signale. Ni la compilation, ni le typage, ni un test : les espaces protégés
 * paraissaient gardés parce que chaque `layout` redirige de son côté, et le
 * rafraîchissement de session, lui, n'avait tout simplement pas lieu. C'est
 * ce qui le rendait invisible — et c'est la quatrième fois dans ce projet
 * qu'un correctif présent dans le dépôt n'existait pas dans ce qui tourne.
 */

const PROTECTED_PREFIXES = [
  '/admin',
  '/super-admin',
  '/demande-de-rattachement',
  // Le poste d'accueil est protégé ICI et plus seulement par son `layout` :
  // layout et page sont rendus de front, si bien qu'un `notFound()` de la page
  // pouvait devancer la redirection du parent et montrer « 404 » à quelqu'un
  // qui n'avait qu'à se connecter. Fermer en amont ne laisse plus de course.
  '/accueil',
] as const;

/**
 * `/accueil/invitation` se garde SEULE : elle accueille quelqu'un qui n'a pas
 * encore de compte, et son propre écran explique la marche à suivre. La fermer
 * ici l'enverrait à la connexion sans rien dire du lien qu'elle vient de
 * suivre.
 */
const OPEN_PATHS = ['/accueil/invitation'] as const;

function isProtected(pathname: string): boolean {
  if (OPEN_PATHS.some((open) => pathname === open || pathname.startsWith(`${open}/`))) {
    return false;
  }
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
    url.search = '';

    /*
     * La destination n'est propagée que si elle appartient à la LISTE FERMÉE
     * de `safeAfterSignIn` — aujourd'hui le poste d'un événement, demain ce
     * qu'elle y ajoutera. Ce n'est pas « vérifier qu'une URL a l'air interne »,
     * c'est reconstruire la seule forme attendue : le reste part sans
     * paramètre, comme avant, et aucune requête ni donnée personnelle ne
     * traverse l'écran de connexion.
     *
     * Sans cela, une hôtesse qui suit le lien de SA soirée se connecte et
     * atterrit sur le poste de sa première affectation, qui n'est pas
     * forcément celui du lien.
     */
    const suite = safeAfterSignIn(pathname);
    if (suite !== '/admin') url.searchParams.set('suite', suite);

    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  /*
   * Les chemins où une session EXISTE, nommés un par un, et non « tout sauf
   * les ressources statiques ».
   *
   * Le matcher large était écrit pour un middleware qui ne s'exécutait pas :
   * le rebrancher tel quel aurait ajouté, d'un coup, un appel au serveur
   * d'authentification sur CHAQUE page publique — une invitation lue par
   * plusieurs centaines de personnes qui n'ont aucun cookie à rafraîchir.
   * Les routes API restent couvertes : une session doit se rafraîchir pendant
   * qu'un poste pointe, pas seulement quand il change de page.
   */
  matcher: [
    '/admin/:path*',
    '/super-admin/:path*',
    '/demande-de-rattachement/:path*',
    '/accueil/:path*',
    '/api/:path*',
  ],
};
