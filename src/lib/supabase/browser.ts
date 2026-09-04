import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/config/env';

/**
 * Client Supabase du navigateur. Il n'utilise que la clé anonyme, soumise au
 * RLS : aucun secret ne traverse la frontière réseau.
 */
export function createSupabaseBrowserClient() {
  const env = publicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
