import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/config/env';

/**
 * Client Supabase pour le rendu serveur et les routes API.
 *
 * Il porte la session de l'utilisateur et est donc SOUMIS AU RLS : c'est le
 * chemin par défaut de toute l'application. Aucune clé de service ici.
 */
export async function createSupabaseServerClient() {
  // `cookies()` d'abord : la lecture des cookies marque la route comme
  // dynamique. Lire l'environnement avant reviendrait à exiger les variables
  // Supabase au moment du build, pour une page qui ne peut de toute façon pas
  // être prérendue.
  const cookieStore = await cookies();
  const env = publicEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Appelé depuis un composant serveur : les cookies sont en lecture
          // seule. Le rafraîchissement de session est fait par le middleware,
          // qui a le droit d'écrire — ce silence est donc correct.
        }
      },
    },
  });
}
