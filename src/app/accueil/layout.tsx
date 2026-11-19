import type { Metadata, Viewport } from 'next';
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
 * événements où il est affecté.
 *
 * **Ce layout ne garde plus la porte, et c'est un correctif.** Il redirigeait
 * vers `/connexion` dès qu'il n'y avait pas de session — sans rien savoir de
 * la page demandée. Or layout et page sont rendus de FRONT : sa redirection
 * aveugle écrasait, au hasard des latences, celle que la page compose avec sa
 * destination. Un lien d'invitation y perdait son jeton ; et dans l'autre
 * sens, le `notFound()` du poste pouvait devancer ce départ et afficher
 * « 404 » à quelqu'un qui n'avait qu'à se connecter — défaut réel, signalé au
 * premier usage. La fermeture est donc remontée au middleware, qui connaît le
 * chemin, et chaque page garde son propre seuil.
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

/**
 * Barre système à la couleur de la charte, une fois installée.
 *
 * `resizes-content` : sur Android, le clavier RÉTRÉCIT la page au lieu de se
 * poser dessus, et la barre du bas remonte d'elle-même au-dessus de lui.
 * Safari l'ignore — d'où `viewportMetrics`, qui couvre l'iPhone.
 */
export const viewport: Viewport = {
  themeColor: '#042F64',
  interactiveWidget: 'resizes-content',
};

export default function CheckinLayout({ children }: { children: React.ReactNode }) {
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
