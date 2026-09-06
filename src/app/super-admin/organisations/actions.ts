'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq } from '@/lib/data/port';
import { resolveRequestContext } from '@/lib/data/context';
import { textFieldOrEmpty } from '@/lib/api/form';
import { logger } from '@/lib/logger';

/**
 * Concession et retrait d'un module à une organisation.
 *
 * Répartition des pouvoirs, déjà inscrite dans le RLS : le super administrateur
 * décide de ce qu'une organisation A LE DROIT d'utiliser — l'existence de la
 * ligne — tandis que l'administrateur de l'organisation décide s'il l'active.
 * Cette action ne touche donc que la ligne, jamais la colonne `enabled`.
 *
 * Aucun contrôle de rôle ici : les policies `organisation_modules_insert` et
 * `_delete` exigent `is_super_admin()`. Un second contrôle donnerait deux
 * vérités à maintenir.
 */

const idSchema = z.string().uuid();
const moduleSchema = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);

export async function grantModule(formData: FormData): Promise<void> {
  const organisationId = idSchema.safeParse(formData.get('organisationId'));
  const moduleKey = moduleSchema.safeParse(textFieldOrEmpty(formData, 'moduleKey'));
  if (!organisationId.success || !moduleKey.success) {
    redirect('/super-admin/organisations?erreur=identifiant');
  }

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const inserted = await context.port.upsert(
    'organisation_modules',
    {
      organisation_id: organisationId.data,
      module_key: moduleKey.data,
      enabled: true,
      granted_by: context.userId,
    },
    ['organisation_id', 'module_key'],
  );

  if (inserted.error) {
    logger.warn('modules.grant_refused', 'Concession de module refusée.', {
      code: inserted.error.code,
    });
    redirect('/super-admin/organisations?erreur=concession');
  }

  revalidatePath('/super-admin/organisations');
  redirect('/super-admin/organisations?ok=accorde');
}

export async function revokeModule(formData: FormData): Promise<void> {
  const organisationId = idSchema.safeParse(formData.get('organisationId'));
  const moduleKey = moduleSchema.safeParse(textFieldOrEmpty(formData, 'moduleKey'));
  if (!organisationId.success || !moduleKey.success) {
    redirect('/super-admin/organisations?erreur=identifiant');
  }

  const context = await resolveRequestContext();
  const removed = await context.port.remove('organisation_modules', [
    eq('organisation_id', organisationId.data),
    eq('module_key', moduleKey.data),
  ]);

  if (removed.error) {
    logger.warn('modules.revoke_refused', 'Retrait de module refusé.', {
      code: removed.error.code,
    });
    redirect('/super-admin/organisations?erreur=retrait');
  }

  revalidatePath('/super-admin/organisations');
  redirect('/super-admin/organisations?ok=retire');
}
