import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/Alert';
import { callbackErrorCode } from '@/lib/auth/callback';
import { authErrorMessage, fr } from '@/lib/i18n/fr';

export const metadata: Metadata = {
  title: { absolute: fr.platform.name },
};

/**
 * Accueil.
 *
 * Il lit aussi les erreurs d'authentification qui atterrissent ICI : quand
 * Supabase refuse un lien de courriel et que l'URL de retour n'est pas dans sa
 * liste d'autorisations, il retombe sur le *Site URL*, c'est-à-dire cette
 * page. Sans cette lecture, l'utilisateur voit une page d'accueil normale sur
 * une URL incompréhensible, et rien ne lui dit que son lien a expiré.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string): string | null => {
    const value = params[key];
    return typeof value === 'string' ? value : null;
  };

  const errorCode = callbackErrorCode(single('error_code'), single('error'));
  const message = errorCode === null ? null : authErrorMessage(errorCode);

  return (
    <>
      <main id="contenu" className="sp-container" style={{ paddingBlock: '4rem' }}>
        <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
          {message ? (
            <Alert tone="error" title="Ce lien n’a pas fonctionné">
              <p>{message}</p>
              <p style={{ marginTop: '0.75rem' }}>
                <Link className="sp-btn sp-btn--sm" href="/mot-de-passe-oublie">
                  Demander un nouveau lien
                </Link>
              </p>
            </Alert>
          ) : null}

          <div className="sp-card sp-stack">
            <h1>{fr.platform.name}</h1>
            <p className="sp-muted">{fr.platform.tagline}</p>
            <div className="sp-actions">
              <Link className="sp-btn sp-btn--lg" href="/connexion">
                {fr.auth.signIn.submit}
              </Link>
              <Link className="sp-btn sp-btn--outline sp-btn--lg" href="/inscription">
                {fr.auth.signUp.title}
              </Link>
            </div>
          </div>
        </div>
      </main>
      <footer className="sp-container" style={{ paddingBottom: '3rem' }}>
        <p className="sp-muted" style={{ fontSize: '0.875rem' }}>
          <Link href="/mentions-legales">{fr.nav.legalNotice}</Link>
          {' · '}
          <Link href="/confidentialite">{fr.nav.privacy}</Link>
        </p>
      </footer>
    </>
  );
}
