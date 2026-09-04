import { eq } from '@/lib/data/port';
import type { RequestContext } from '@/lib/data/context';

/**
 * Réglages de plateforme lus par les pages légales.
 *
 * Aucune valeur par défaut inventée : un champ non renseigné reste `null` et la
 * page l'affiche comme non renseigné. Écrire « CNIL » ou une adresse
 * plausible à la place ferait dire au site quelque chose de faux — exactement
 * ce que la règle d'or interdit.
 */

export interface PlatformSettings {
  publisher_name: string | null;
  publisher_legal_form: string | null;
  publisher_address: string | null;
  publisher_email: string | null;
  publisher_phone: string | null;
  publisher_director: string | null;
  publisher_registration: string | null;
  host_name: string | null;
  host_address: string | null;
  host_url: string | null;
  dpo_name: string | null;
  dpo_email: string | null;
  authority_name: string | null;
  authority_address: string | null;
  authority_url: string | null;
  privacy_email: string | null;
  default_retention_days: number;
}

export const PLATFORM_SETTINGS_COLUMNS =
  'publisher_name, publisher_legal_form, publisher_address, publisher_email, ' +
  'publisher_phone, publisher_director, publisher_registration, host_name, ' +
  'host_address, host_url, dpo_name, dpo_email, authority_name, ' +
  'authority_address, authority_url, privacy_email, default_retention_days';

export async function readPlatformSettings(
  context: RequestContext,
): Promise<PlatformSettings | null> {
  const result = await context.port.selectOne<PlatformSettings>({
    table: 'platform_settings',
    columns: PLATFORM_SETTINGS_COLUMNS,
    where: [eq('id', 1)],
  });
  return result.data;
}
