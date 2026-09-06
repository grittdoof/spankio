import { z } from 'zod';
import { eq, type DbError } from '@/lib/data/port';
import type { RequestContext } from '@/lib/data/context';

/**
 * Profil d'une organisation : ce qu'elle affiche à ses répondants.
 *
 * Aucun contrôle de rôle ici : le RLS autorise la mise à jour au super
 * administrateur et à l'administrateur de CETTE organisation, personne
 * d'autre. Un second contrôle donnerait deux vérités à maintenir.
 */

export interface OrganisationRow {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  is_active: boolean;
}

export const ORGANISATION_COLUMNS =
  'id, slug, name, logo_url, contact_email, contact_phone, address, is_active';

export const organisationProfileSchema = z.object({
  name: z.string().trim().min(2).max(160),
  logoUrl: z.string().trim().url().max(500).nullable(),
  contactEmail: z.string().trim().email().max(200).nullable(),
  contactPhone: z.string().trim().max(40).nullable(),
  address: z.string().trim().max(300).nullable(),
});

export type OrganisationProfileInput = z.infer<typeof organisationProfileSchema>;

// ---------------------------------------------------------------------------
// Complétude
// ---------------------------------------------------------------------------

export interface ProfileGap {
  readonly key: 'logo' | 'contactEmail' | 'address';
  readonly label: string;
  /** Ce que son absence coûte, concrètement. */
  readonly consequence: string;
}

/**
 * Ce qui manque au profil, et POURQUOI cela compte.
 *
 * Une liste de champs vides ne motive personne à les remplir. Dire ce que
 * l'absence produit — un formulaire sans logo, un répondant sans recours —
 * transforme une corvée administrative en décision.
 *
 * Fonction pure : elle sert à l'écran d'accueil (le rappel) comme à la page de
 * profil (l'avancement). Deux listes auraient divergé.
 */
export function organisationGaps(
  organisation: Pick<OrganisationRow, 'logo_url' | 'contact_email' | 'address'>,
): readonly ProfileGap[] {
  const gaps: ProfileGap[] = [];

  if (!organisation.logo_url?.trim()) {
    gaps.push({
      key: 'logo',
      label: 'Le logo',
      consequence:
        'Vos formulaires affichent le nom de l’organisation en texte, là où un logo serait reconnu d’un coup d’œil.',
    });
  }

  if (!organisation.contact_email?.trim()) {
    gaps.push({
      key: 'contactEmail',
      label: 'L’adresse de contact',
      consequence:
        'Un répondant qui a une question, ou qui demande l’effacement de ses données, n’a personne à qui écrire.',
    });
  }

  if (!organisation.address?.trim()) {
    gaps.push({
      key: 'address',
      label: 'L’adresse postale',
      consequence:
        'Elle identifie le responsable de traitement dans les mentions affichées aux répondants.',
    });
  }

  return gaps;
}

/** Part du profil renseignée, en pourcentage entier. */
export function organisationProgress(gaps: readonly ProfileGap[], total = 3): number {
  const done = Math.max(0, total - gaps.length);
  return Math.round((done / total) * 100);
}

// ---------------------------------------------------------------------------
// Accès aux données
// ---------------------------------------------------------------------------

export type OrganisationOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DbError };

export async function getOrganisation(
  context: RequestContext,
  organisationId: string,
): Promise<OrganisationOutcome<OrganisationRow>> {
  const result = await context.port.selectOne<OrganisationRow>({
    table: 'organisations',
    columns: ORGANISATION_COLUMNS,
    where: [eq('id', organisationId)],
  });
  if (result.error) return { ok: false, error: result.error };
  return { ok: true, value: result.data };
}

export async function updateOrganisationProfile(
  context: RequestContext,
  organisationId: string,
  input: OrganisationProfileInput,
): Promise<OrganisationOutcome<OrganisationRow>> {
  const updated = await context.port.update<OrganisationRow>(
    'organisations',
    {
      name: input.name,
      logo_url: input.logoUrl,
      contact_email: input.contactEmail,
      contact_phone: input.contactPhone,
      address: input.address,
    },
    [eq('id', organisationId)],
    ORGANISATION_COLUMNS,
  );
  if (updated.error) return { ok: false, error: updated.error };

  const row = updated.data[0];
  // Aucune ligne renvoyée : le RLS a masqué la mise à jour. On ne prétend pas
  // qu'elle a eu lieu.
  if (!row) return { ok: false, error: { code: 'PT403', message: 'Modification refusée' } };
  return { ok: true, value: row };
}
