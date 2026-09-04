import type { Metadata } from 'next';
import Link from 'next/link';
import { fr } from '@/lib/i18n/fr';

export const metadata: Metadata = {
  title: { absolute: fr.platform.name },
};

export default function HomePage() {
  return (
    <>
      <main id="contenu" className="sp-container" style={{ paddingBlock: '4rem' }}>
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
