-- ============================================================================
-- Fonctions applicatives (RPC).
--
-- Elles existent pour garder le `service role` HORS du chemin par défaut :
-- une soumission publique, une décision de rattachement ou une demande
-- d'effacement s'exécutent avec la clé anonyme ou la session de l'utilisateur,
-- et c'est la fonction — pas un secret qui contourne tout le RLS — qui vérifie
-- les conditions.
--
-- Chaque fonction SECURITY DEFINER ci-dessous :
--   * pose `search_path = ''` et qualifie tous les objets ;
--   * revérifie elle-même les droits de l'appelant ;
--   * lève une erreur avec un SQLSTATE dédié, que l'API traduit en statut HTTP.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Clé anti-doublon : empreinte SHA-256 de la valeur normalisée, salée par
-- l'identifiant du sondage.
--
-- Pourquoi une empreinte et pas la valeur : l'unicité et le rattachement d'une
-- demande d'effacement fonctionnent aussi bien, sans stocker une seconde copie
-- en clair de la donnée (email, référence) hors du champ `data`. Le sel par
-- sondage empêche tout recoupement entre deux sondages.
-- ----------------------------------------------------------------------------
create or replace function public.dedup_hash(p_survey_id uuid, p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or btrim(p_value) = '' then null
    else encode(
      sha256(convert_to(p_survey_id::text || ':' || lower(btrim(p_value)), 'UTF8')),
      'hex'
    )
  end
$$;

comment on function public.dedup_hash(uuid, text) is
  'Empreinte anti-doublon, salée par sondage. Permet aussi de retrouver les réponses visées par une demande d''effacement.';

-- ----------------------------------------------------------------------------
-- Soumission publique.
--
-- La validation métier complète (champs requis, types, options autorisées,
-- conditions) est faite côté serveur TypeScript contre `surveys.schema` AVANT
-- l'appel. Cette fonction est la seconde barrière : elle revérifie ce que le
-- SQL peut prouver — sondage réellement publié et ouvert, quota, consentement
-- exigé, taille du payload — et rien de ce qu'elle ne peut pas prouver.
-- ----------------------------------------------------------------------------
create or replace function public.submit_survey_response(
  p_survey_id uuid,
  p_data jsonb,
  p_consent_given boolean default false,
  p_consent_text text default null,
  p_dedup_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_survey record;
  v_live_count integer;
  v_dedup_key text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_data, 'null'::jsonb)) <> 'object' then
    raise exception 'Payload invalide' using errcode = 'SV400';
  end if;

  -- Plafond de taille : garde-fou anti-DoS, doublon volontaire de la
  -- vérification faite dans la route API.
  if pg_column_size(p_data) > 65536 then
    raise exception 'Payload trop volumineux' using errcode = 'SV413';
  end if;

  select s.id, s.status, s.deleted_at, s.opens_at, s.closes_at, s.response_limit,
         s.require_consent, s.dedup_field, s.organisation_id
    into v_survey
  from public.surveys s
  join public.organisations o on o.id = s.organisation_id
  where s.id = p_survey_id
    and s.deleted_at is null
    and o.is_active;

  if v_survey.id is null then
    raise exception 'Sondage introuvable' using errcode = 'SV404';
  end if;

  if v_survey.status <> 'published'
     or (v_survey.opens_at is not null and v_survey.opens_at > now())
     or (v_survey.closes_at is not null and v_survey.closes_at <= now())
  then
    raise exception 'Sondage fermé' using errcode = 'SV423';
  end if;

  if v_survey.require_consent
     and (p_consent_given is not true or btrim(coalesce(p_consent_text, '')) = '')
  then
    raise exception 'Consentement requis' using errcode = 'SV412';
  end if;

  if v_survey.response_limit is not null then
    select count(*) into v_live_count
    from public.survey_responses r
    where r.survey_id = p_survey_id
      and r.deleted_at is null;

    if v_live_count >= v_survey.response_limit then
      raise exception 'Nombre maximal de réponses atteint' using errcode = 'SV429';
    end if;
  end if;

  -- Anti-doublon : si le sondage désigne un champ de dédoublonnage, la valeur
  -- est obligatoire, et l'unicité est garantie par un index (pas par ce test).
  if v_survey.dedup_field is not null then
    v_dedup_key := public.dedup_hash(p_survey_id, p_dedup_value);
    if v_dedup_key is null then
      raise exception 'Valeur de dédoublonnage manquante' using errcode = 'SV400';
    end if;
  end if;

  begin
    insert into public.survey_responses (
      survey_id, organisation_id, data, consent_given, consent_text, dedup_key
    )
    values (
      p_survey_id,
      v_survey.organisation_id,
      p_data,
      coalesce(p_consent_given, false),
      p_consent_text,
      v_dedup_key
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'Réponse déjà enregistrée' using errcode = 'SV409';
  end;

  return v_id;
end;
$$;

revoke all on function public.submit_survey_response(uuid, jsonb, boolean, text, text) from public;
grant execute on function public.submit_survey_response(uuid, jsonb, boolean, text, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Validation d'une demande de rattachement par le super_admin.
-- Le rôle ET les modules autorisés sont choisis à ce moment précis.
-- ----------------------------------------------------------------------------
create or replace function public.approve_membership_request(
  p_request_id uuid,
  p_role public.user_role,
  p_module_keys text[] default '{}',
  p_organisation_slug text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
  v_org_id uuid;
  v_actor uuid := auth.uid();
  v_module text;
begin
  if not public.is_super_admin() then
    raise exception 'Réservé au super administrateur' using errcode = 'SV403';
  end if;

  if p_role = 'super_admin' then
    raise exception 'Un rattachement ne peut pas accorder le rôle super_admin'
      using errcode = 'SV400';
  end if;

  select * into v_request
  from public.membership_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Demande introuvable' using errcode = 'SV404';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Demande déjà traitée' using errcode = 'SV409';
  end if;

  -- Organisation existante, ou création à la volée depuis le nom demandé.
  if v_request.organisation_id is not null then
    v_org_id := v_request.organisation_id;
  else
    if p_organisation_slug is null then
      raise exception 'Un identifiant d''organisation est requis pour créer l''organisation'
        using errcode = 'SV400';
    end if;

    insert into public.organisations (slug, name)
    values (p_organisation_slug, btrim(v_request.requested_organisation_name))
    returning id into v_org_id;
  end if;

  -- Concession des modules choisis à l'organisation (le core est implicite).
  foreach v_module in array coalesce(p_module_keys, '{}'::text[])
  loop
    if not exists (select 1 from public.modules m where m.key = v_module) then
      raise exception 'Module inconnu : %', v_module using errcode = 'SV400';
    end if;

    insert into public.organisation_modules (organisation_id, module_key, granted_by)
    values (v_org_id, v_module, v_actor)
    on conflict (organisation_id, module_key) do nothing;
  end loop;

  -- Rattachement effectif du compte.
  update public.profiles
     set organisation_id = v_org_id,
         role = p_role,
         status = 'active'
   where id = v_request.user_id;

  -- Surcharges PAR UTILISATEUR : autorisation explicite des modules choisis,
  -- interdiction explicite de tous les autres modules non-core.
  delete from public.profile_module_overrides where profile_id = v_request.user_id;

  insert into public.profile_module_overrides (profile_id, module_key, allowed, set_by)
  select
    v_request.user_id,
    m.key,
    m.key = any (coalesce(p_module_keys, '{}'::text[])),
    v_actor
  from public.modules m
  where not m.is_core;

  update public.membership_requests
     set status = 'approved',
         decided_role = p_role,
         decided_modules = coalesce(p_module_keys, '{}'::text[]),
         decision_note = p_note,
         decided_by = v_actor,
         decided_at = now()
   where id = p_request_id;

  perform public.write_audit(
    'membership.approved',
    v_org_id,
    'membership_requests',
    p_request_id::text,
    jsonb_build_object('role', p_role, 'modules', coalesce(p_module_keys, '{}'::text[]))
  );

  return v_org_id;
end;
$$;

revoke all on function public.approve_membership_request(uuid, public.user_role, text[], text, text) from public;
grant execute on function public.approve_membership_request(uuid, public.user_role, text[], text, text)
  to authenticated;

-- ----------------------------------------------------------------------------
create or replace function public.reject_membership_request(
  p_request_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
begin
  if not public.is_super_admin() then
    raise exception 'Réservé au super administrateur' using errcode = 'SV403';
  end if;

  select * into v_request
  from public.membership_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Demande introuvable' using errcode = 'SV404';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Demande déjà traitée' using errcode = 'SV409';
  end if;

  update public.membership_requests
     set status = 'rejected',
         decision_note = p_note,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_request_id;

  perform public.write_audit(
    'membership.rejected',
    v_request.organisation_id,
    'membership_requests',
    p_request_id::text,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.reject_membership_request(uuid, text) from public;
grant execute on function public.reject_membership_request(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Droit à l'effacement : dépôt d'une demande par une personne concernée,
-- sans compte. Le débit est limité au niveau de la route API.
-- ----------------------------------------------------------------------------
create or replace function public.request_erasure(
  p_survey_id uuid,
  p_identifier text,
  p_claim text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  if btrim(coalesce(p_identifier, '')) = '' then
    raise exception 'Identifiant requis' using errcode = 'SV400';
  end if;

  select s.organisation_id into v_org
  from public.surveys s
  where s.id = p_survey_id
    and s.deleted_at is null;

  if v_org is null then
    raise exception 'Sondage introuvable' using errcode = 'SV404';
  end if;

  insert into public.erasure_requests (organisation_id, survey_id, identifier, claim)
  values (v_org, p_survey_id, btrim(p_identifier), nullif(btrim(coalesce(p_claim, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.request_erasure(uuid, text, text) from public;
grant execute on function public.request_erasure(uuid, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Exécution de l'effacement. Réservé au super_admin ou à un admin de
-- l'organisation concernée. Retourne le nombre de réponses effacées.
--
-- `p_hard = false` place un deleted_at (les agrégats l'excluent déjà) ;
-- `p_hard = true` supprime définitivement les lignes.
-- ----------------------------------------------------------------------------
create or replace function public.apply_erasure(
  p_request_id uuid,
  p_hard boolean default false,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
  v_key text;
  v_count integer := 0;
begin
  select * into v_request
  from public.erasure_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Demande introuvable' using errcode = 'SV404';
  end if;

  if not (
    public.is_super_admin()
    or (public.is_org_admin() and v_request.organisation_id = public.my_org_id())
  ) then
    raise exception 'Droits insuffisants' using errcode = 'SV403';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Demande déjà traitée' using errcode = 'SV409';
  end if;

  v_key := public.dedup_hash(v_request.survey_id, v_request.identifier);

  if v_key is not null then
    if p_hard then
      delete from public.survey_responses
      where survey_id = v_request.survey_id
        and dedup_key = v_key;
      get diagnostics v_count = row_count;
    else
      update public.survey_responses
         set deleted_at = now()
       where survey_id = v_request.survey_id
         and dedup_key = v_key
         and deleted_at is null;
      get diagnostics v_count = row_count;
    end if;
  end if;

  update public.erasure_requests
     set status = 'done',
         handled_by = auth.uid(),
         handled_at = now(),
         handled_note = p_note,
         affected_rows = v_count
   where id = p_request_id;

  perform public.write_audit(
    'erasure.applied',
    v_request.organisation_id,
    'erasure_requests',
    p_request_id::text,
    jsonb_build_object('hard', p_hard, 'affected_rows', v_count)
  );

  return v_count;
end;
$$;

revoke all on function public.apply_erasure(uuid, boolean, text) from public;
grant execute on function public.apply_erasure(uuid, boolean, text) to authenticated;
