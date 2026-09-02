import type { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';
import './globals.css';

const montserrat = Montserrat({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-montserrat',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
});

export const metadata: Metadata = {
  title: {
    default: 'Plateforme de sondages et d’inscriptions',
    template: '%s — Plateforme de sondages et d’inscriptions',
  },
  description:
    'Recensez des besoins, sondez un public, gérez des inscriptions à des événements.',
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
          Aller au contenu principal
        </a>
        {children}
      </body>
    </html>
  );
}
