import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/config/env';

/**
 * Client à clé de service : IL CONTOURNE TOTALEMENT LE RLS.
 *
 * C'est l'EXCEPTION, jamais le chemin par défaut. Chaque appel doit être
 * commenté et justifié à l'endroit de l'appel. Usages légitimes prévus :
 *   * routes `/api/cron/*` (aucune session utilisateur, secret partagé) ;
 *   * amorçage du premier super administrateur.
 *
 * Tout le reste — y compris les écrans d'administration et les soumissions
 * publiques — passe par le client authentifié et par des fonctions
 * `SECURITY DEFINER` qui revérifient les droits.
 */
export function createSupabaseServiceClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
