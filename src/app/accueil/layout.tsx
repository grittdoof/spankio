import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { resolveRequestContext } from '@/lib/data/context';
import { signOut } from '@/app/(auth)/actions';
import { fr } from '@/lib/i18n/fr';

/**
 * Le poste d'accueil a sa PROPRE mise en page, hors de `/admin`.
 *
 * Ce n'est pas un écran d'administration réduit : c'est un outil tenu d'une
 * main, debout, à l'entrée d'une salle, par quelqu'un qui n'a aucun autre
 * accès au produit. La barre latérale de l'espace de travail n'y aurait
 * proposé que des liens fermés — et la place qu'elle prend est précisément
 * celle qui manque à la liste.
 *
 * La barrière reste le RLS : un compte d'accueil ne voit les invités que des
 * événements où il est affecté. La redirection n'évite qu'un écran vide.
 */

export const dynamic = 'force-dynamic';

/**
 * Le manifeste n'est déclaré QUE sur cette branche de l'application.
 *
 * Installer « Spankio » depuis une page d'invitation publique n'aurait aucun
 * sens : la PWA est l'outil de l'accueil, pas le produit entier. Le `scope` du
 * manifeste le redit côté navigateur.
 *
 * Ce qu'elle apporte : l'icône sur l'écran d'accueil — une hôtesse n'a pas à
 * retrouver une URL à 19 h 50 — et le plein écran, qui rend à la liste la
 * hauteur que prend la barre d'adresse et qui évite de naviguer ailleurs d'un
 * geste malheureux.
 */
export const metadata: Metadata = {
  title: 'Accueil',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Accueil', statusBarStyle: 'black-translucent' },
};

/** Barre système à la couleur de la charte, une fois installée. */
export const viewport: Viewport = { themeColor: '#042F64' };

export default async function CheckinLayout({ children }: { children: React.ReactNode }) {
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  return (
    <div className="sp-deskshell">
      <header className="sp-deskshell__bar">
        <span className="sp-deskshell__brand">{fr.platform.name}</span>
        <form action={signOut}>
          <button className="sp-btn sp-btn--ghost" type="submit">
            Se déconnecter
          </button>
        </form>
      </header>
      <main className="sp-deskshell__main">{children}</main>
    </div>
  );
}
