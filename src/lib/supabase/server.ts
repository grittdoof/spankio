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
  const env = publicEnv();
  const cookieStore = await cookies();

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
