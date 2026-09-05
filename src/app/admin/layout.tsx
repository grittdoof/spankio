import { redirect } from 'next/navigation';
import { resolveRequestContext } from '@/lib/data/context';

/**
 * Racine de l'espace d'administration : la seule barrière d'accès.
 *
 * Elle ne dessine rien. Deux mises en page cohabitent en dessous, dans des
 * groupes de routes :
 *
 *  * `(espace)` — barre latérale et contenu, pour travailler ;
 *  * `(parcours)` — plein écran, sans navigation, pour les parcours guidés.
 *
 * Ce découpage n'est pas cosmétique : un parcours « une question par écran »
 * entouré d'une barre de navigation n'est plus un parcours guidé, c'est un
 * formulaire de plus. Et un `<main>` imbriqué dans un autre `<main>` — ce
 * qu'imposerait une mise en page unique — donnerait deux régions principales
 * et deux fois l'ancre `#contenu`.
 */

export const dynamic = 'force-dynamic';

export default async function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');
  return children;
}
