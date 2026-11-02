import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/config/env';

/**
 * Client à clé de service : IL CONTOURNE TOTALEMENT LE RLS.
 *
 * C'est l'EXCEPTION, jamais le chemin par défaut. Chaque appel doit être
 * commenté et justifié à l'endroit de l'appel. Usages légitimes prévus :
 *   * routes `/api/cron/*` (aucune session utilisateur, secret partagé) ;
 *   * amorçage du premier super administrateur ;
 *   * création des comptes de pointage (`src/lib/services/checkin-accounts.ts`).
 *
 * Ce troisième usage est le seul déclenché par un administrateur de TENANT, et
 * le seul qui ne découle pas de l'architecture : il est documenté en R16, et
 * ses bornes — rôle `host` imposé, organisation lue du profil de l'appelant,
 * reprise en main refusée hors des comptes fabriqués — sont écrites en
 * TypeScript dans ce module, puisque le moteur ne les applique pas ici.
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
