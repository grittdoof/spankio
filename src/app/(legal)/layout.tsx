import Link from 'next/link';
import { fr } from '@/lib/i18n/fr';

/** Mise en page des pages légales, consultables sans compte. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="sp-container" id="contenu" style={{ paddingBlock: '3rem' }}>
        <article className="sp-card sp-legal">{children}</article>
      </main>
      <footer className="sp-container" style={{ paddingBottom: '3rem' }}>
        <p className="sp-muted" style={{ fontSize: '0.875rem' }}>
          <Link href="/mentions-legales">{fr.nav.legalNotice}</Link>
          {' · '}
          <Link href="/confidentialite">{fr.nav.privacy}</Link>
          {' · '}
          <Link href="/">{fr.platform.name}</Link>
        </p>
      </footer>
    </>
  );
}
