-- ============================================================================
-- Bucket des logos d'organisation.
--
-- Séparé de `survey-banners` : un logo n'appartient pas à un formulaire mais à
-- l'organisation, et son chemin le dit — `{organisation_id}/{fichier}`. Les
-- ranger dans le même bucket obligerait à inventer un identifiant de
-- formulaire fictif, et le RLS ne saurait plus distinguer les deux droits.
--
-- Droits d'écriture : l'ADMINISTRATEUR de l'organisation, pas l'éditeur. Le
-- logo est un réglage d'organisation, au même titre que son adresse — c'est
-- exactement la règle de `organisations_update`, reprise ici à l'identique.
--
-- Contraintes du bucket, seules à protéger réellement puisque le téléversement
-- part du navigateur :
--   * 1 Mio  : un logo au-delà est une image mal préparée, pas un besoin ;
--   * types  : images matricielles usuelles UNIQUEMENT. Pas de SVG — un SVG
--              est un document XML pouvant porter du script, et il serait
--              servi depuis une origine publique.
--
-- Migration tolérante : sous PGlite (tests), le schéma `storage` n'existe pas.
-- ============================================================================

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Schéma storage absent : bucket des logos non créé (environnement de test).';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'organisation-logos',
    'organisation-logos',
    true,
    1048576,
    array['image/png', 'image/jpeg', 'image/webp', 'image/avif']
  )
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Lecture publique : un logo s'affiche sur une page publique.
  drop policy if exists organisation_logos_public_read on storage.objects;
  create policy organisation_logos_public_read on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'organisation-logos');

  drop policy if exists organisation_logos_write on storage.objects;
  create policy organisation_logos_write on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'organisation-logos'
      and (
        app.is_super_admin()
        or (
          app.is_org_admin()
          and (storage.foldername(name))[1] = app.my_org_id()::text
        )
      )
    );

  drop policy if exists organisation_logos_update on storage.objects;
  create policy organisation_logos_update on storage.objects
    for update to authenticated
    using (
      bucket_id = 'organisation-logos'
      and (
        app.is_super_admin()
        or (
          app.is_org_admin()
          and (storage.foldername(name))[1] = app.my_org_id()::text
        )
      )
    )
    with check (
      bucket_id = 'organisation-logos'
      and (
        app.is_super_admin()
        or (storage.foldername(name))[1] = app.my_org_id()::text
      )
    );

  drop policy if exists organisation_logos_delete on storage.objects;
  create policy organisation_logos_delete on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'organisation-logos'
      and (
        app.is_super_admin()
        or (
          app.is_org_admin()
          and (storage.foldername(name))[1] = app.my_org_id()::text
        )
      )
    );
end
$$;
