import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/Alert';
import { BrandMark } from '@/components/ui/BrandMark';
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
      <main className="sp-landing" id="contenu">
        <div className="sp-landing__inner">
          {message ? (
            <Alert tone="error" title="Ce lien n’a pas fonctionné">
              <p>{message}</p>
              <p style={{ marginTop: 'var(--sp-space-3)' }}>
                <Link className="sp-btn sp-btn--sm" href="/mot-de-passe-oublie">
                  Demander un nouveau lien
                </Link>
              </p>
            </Alert>
          ) : null}

          <div className="sp-rise">
            <p className="sp-landing__brand">
              <BrandMark className="sp-auth__mark" name={fr.platform.name} />
              {fr.platform.name}
            </p>
            <h1 className="sp-landing__title">{fr.platform.tagline}</h1>
            <p className="sp-lead sp-landing__lead">
              Composez un formulaire question par question, publiez-le à votre adresse,
              suivez les réponses et exportez-les. Chaque organisation dispose de son
              espace, de sa marque et de ses règles.
            </p>
            <div className="sp-actions sp-landing__actions">
              <Link className="sp-btn sp-btn--lg" href="/connexion">
                {fr.auth.signIn.submit}
              </Link>
              <Link className="sp-btn sp-btn--outline sp-btn--lg" href="/inscription">
                {fr.auth.signUp.title}
              </Link>
            </div>

            <ul className="sp-landing__points">
              <li>
                <strong>Une question par écran</strong>
                Les répondants avancent sans se perdre, sur mobile comme sur ordinateur.
              </li>
              <li>
                <strong>Sondages et inscriptions</strong>
                Date, lieu, carte, ajout à l’agenda et itinéraire pour vos événements.
              </li>
              <li>
                <strong>Conforme, et vérifiable</strong>
                Finalité, base légale et durée de conservation annoncées aux répondants,
                et le texte affiché est conservé avec chaque réponse.
              </li>
            </ul>
          </div>
        </div>
      </main>

      <footer className="sp-landing__footer">
        <p>
          <Link href="/mentions-legales">{fr.nav.legalNotice}</Link>
          {' · '}
          <Link href="/confidentialite">{fr.nav.privacy}</Link>
        </p>
      </footer>
    </>
  );
}
