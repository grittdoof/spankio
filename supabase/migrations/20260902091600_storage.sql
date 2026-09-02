-- ============================================================================
-- Stockage des bannières d'événements.
--
-- Seul le binaire passe par un bucket ; tout le reste vit dans `surveys`.
-- Convention de chemin : {organisation_id}/{survey_id}/{fichier}, ce qui permet
-- au RLS de Storage de vérifier l'appartenance au tenant depuis le nom.
--
-- Migration tolérante : sous PGlite (tests), le schéma `storage` n'existe pas.
-- ============================================================================

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Schéma storage absent : bucket des bannières non créé (environnement de test).';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('survey-banners', 'survey-banners', true)
  on conflict (id) do nothing;

  -- Lecture publique : une bannière est affichée sur une page publique.
  drop policy if exists survey_banners_public_read on storage.objects;
  create policy survey_banners_public_read on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'survey-banners');

  -- Écriture réservée aux comptes autorisés, dans le dossier de LEUR
  -- organisation, et seulement s'ils peuvent utiliser le module événement.
  drop policy if exists survey_banners_write on storage.objects;
  create policy survey_banners_write on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'survey-banners'
      and public.can_write_surveys()
      and public.can_use_module('event')
      and (storage.foldername(name))[1] = public.my_org_id()::text
    );

  drop policy if exists survey_banners_update on storage.objects;
  create policy survey_banners_update on storage.objects
    for update to authenticated
    using (
      bucket_id = 'survey-banners'
      and public.can_write_surveys()
      and (storage.foldername(name))[1] = public.my_org_id()::text
    )
    with check (
      bucket_id = 'survey-banners'
      and (storage.foldername(name))[1] = public.my_org_id()::text
    );

  drop policy if exists survey_banners_delete on storage.objects;
  create policy survey_banners_delete on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'survey-banners'
      and public.can_write_surveys()
      and (storage.foldername(name))[1] = public.my_org_id()::text
    );
end
$$;
