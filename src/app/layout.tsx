import type { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';
import { fr } from '@/lib/i18n/fr';
import './globals.css';

const montserrat = Montserrat({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-montserrat',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
});

export const metadata: Metadata = {
  title: {
    default: fr.platform.name,
    template: `%s — ${fr.platform.name}`,
  },
  description: fr.platform.tagline,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={montserrat.variable}>
      <body>
        <a className="sp-skip-link" href="#contenu">
          {fr.nav.skipToContent}
        </a>
        {children}
      </body>
    </html>
  );
}
