-- ============================================================================
-- Sortie des fonctions internes du schéma exposé par l'API.
--
-- PROBLÈME CORRIGÉ (constaté sur un vrai projet Supabase, invisible sous
-- PGlite) : Supabase pose des `default privileges` qui accordent
-- automatiquement `EXECUTE` à `anon` et `authenticated` sur toute nouvelle
-- fonction du schéma `public`. Un `revoke ... from public` ne les retire pas,
-- car ce sont des droits accordés NOMMÉMENT à ces rôles.
--
-- Conséquence mesurée : chaque fonction interne devenait un point d'entrée
-- REST (`/rest/v1/rpc/<nom>`). En particulier `write_audit` permettait à un
-- visiteur anonyme de FORGER une entrée dans le journal d'audit, et
-- `profile_org_id`, `profile_can_use_module`, `org_has_module` ou
-- `survey_module_key` divulguaient le rattachement et les droits de comptes
-- tiers à partir de leur seul identifiant.
--
-- Pourquoi un schéma privé plutôt qu'un simple `revoke` : une policy RLS est
-- évaluée AVEC LES DROITS DE L'APPELANT — vérifié par l'expérience — donc
-- retirer `EXECUTE` sur `my_org_id()` casse la lecture des sondages. Il faut
-- que ces fonctions restent exécutables, mais cessent d'être publiées : c'est
-- exactement ce que fait un schéma hors de la liste exposée par PostgREST.
--
-- Ne restent dans `public` que les fonctions dont l'application a réellement
-- besoin d'appeler par RPC.
--
-- Trois fonctions non utilisées (`my_role`, `my_status`, `survey_org_id`) sont
-- supprimées plutôt que déplacées : du code mort exposé reste du code exposé.
-- ============================================================================

create schema if not exists app;

comment on schema app is
  'Fonctions internes de la plateforme. HORS du schéma exposé par PostgREST : rien ici n''est appelable depuis le réseau.';

revoke all on schema app from public;
-- `usage` est nécessaire pour que les policies puissent résoudre `app.*`.
grant usage on schema app to authenticated;

-- ============================================================================
-- 1. Contexte de l'appelant
-- ============================================================================

create or replace function app.my_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organisation_id from public.profiles p where p.id = auth.uid()
$$;

create or replace function app.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'super_admin' and p.status = 'active'
  )
$$;

create or replace function app.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.organisation_id is not null
  )
$$;

create or replace function app.is_org_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role = 'admin'
      and p.organisation_id is not null
  )
$$;

create or replace function app.can_write_surveys()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and p.role in ('admin', 'editor') and p.organisation_id is not null
  )
$$;

-- ============================================================================
-- 2. Lectures ponctuelles utilisées dans les policies
-- ============================================================================

create or replace function app.profile_org_id(p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organisation_id from public.profiles p where p.id = p_profile_id
$$;

create or replace function app.survey_module_key(p_survey_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.module_key from public.surveys s where s.id = p_survey_id
$$;

create or replace function app.org_has_module(p_organisation_id uuid, p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select m.is_core from public.modules m where m.key = p_module_key), false)
  or exists (
    select 1 from public.organisation_modules om
    where om.organisation_id = p_organisation_id
      and om.module_key = p_module_key
      and om.enabled
  )
$$;

create or replace function app.profile_can_use_module(p_profile_id uuid, p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select m.key, m.is_core from public.modules m where m.key = p_module_key
  ),
  me as (
    select p.organisation_id from public.profiles p
    where p.id = p_profile_id and p.status = 'active'
  ),
  override as (
    select o.allowed from public.profile_module_overrides o
    where o.profile_id = p_profile_id and o.module_key = p_module_key
  ),
  org_grant as (
    select om.enabled from public.organisation_modules om, me
    where om.organisation_id = me.organisation_id and om.module_key = p_module_key
  )
  select case
    when not exists (select 1 from target) then false
    when (select is_core from target) then exists (select 1 from me)
    when not exists (select 1 from me) then false
    when exists (select 1 from override) then (select allowed from override)
    else coalesce((select enabled from org_grant), false)
  end
$$;

create or replace function app.can_use_module(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.profile_can_use_module(auth.uid(), p_module_key)
$$;

-- ============================================================================
-- 3. Utilitaires internes (jamais appelés depuis le réseau)
-- ============================================================================

create or replace function app.write_audit(
  p_action text,
  p_organisation_id uuid default null,
  p_target_table text default null,
  p_target_id text default null,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (organisation_id, actor_id, action, target_table, target_id, meta)
  values (p_organisation_id, auth.uid(), p_action, p_target_table, p_target_id,
          coalesce(p_meta, '{}'::jsonb));
end;
$$;

create or replace function app.dedup_hash(p_survey_id uuid, p_value text)
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

comment on function app.dedup_hash(uuid, text) is
  'Empreinte anti-doublon, salée par sondage. Interne : la valeur ne doit pas pouvoir être calculée depuis le réseau.';

create or replace function app.soft_delete_grace_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 30 $$;

-- ============================================================================
-- 4. Fonctions de trigger
-- ============================================================================

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    'viewer',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function app.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_sensitive boolean := (
    new.role is distinct from old.role
    or new.organisation_id is distinct from old.organisation_id
    or new.status is distinct from old.status
  );
begin
  if not v_sensitive then
    return new;
  end if;

  -- Contexte serveur de confiance (aucun JWT).
  if v_actor is null then
    return new;
  end if;

  if app.is_super_admin() then
    return new;
  end if;

  if app.is_org_admin()
     and old.organisation_id is not null
     and old.organisation_id = app.my_org_id()
     and new.organisation_id is not distinct from old.organisation_id
     and new.role <> 'super_admin'
     and old.role <> 'super_admin'
     and new.id <> v_actor
  then
    return new;
  end if;

  raise exception 'Modification de rôle, de rattachement ou de statut non autorisée'
    using errcode = '42501';
end;
$$;

create or replace function app.guard_survey_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organisation_id is distinct from old.organisation_id then
    raise exception 'L''organisation d''un sondage ne peut pas être modifiée'
      using errcode = '42501';
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end;
$$;

create or replace function app.guard_response_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_retention integer;
begin
  select s.organisation_id, s.retention_days into v_org, v_retention
  from public.surveys s where s.id = new.survey_id;

  if v_org is null then
    raise exception 'Sondage introuvable' using errcode = '23503';
  end if;

  new.organisation_id := v_org;

  if new.purge_after is null and v_retention is not null then
    new.purge_after := new.submitted_at + make_interval(days => v_retention);
  end if;

  return new;
end;
$$;

create or replace function app.guard_response_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.survey_id is distinct from old.survey_id
     or new.organisation_id is distinct from old.organisation_id
     or new.data is distinct from old.data
     or new.consent_given is distinct from old.consent_given
     or new.consent_text is distinct from old.consent_text
     or new.dedup_key is distinct from old.dedup_key
     or new.submitted_at is distinct from old.submitted_at
  then
    raise exception 'Une réponse est immuable : seule sa suppression (deleted_at) peut évoluer'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ============================================================================
-- 5. Droits : on part de zéro, et on n'accorde EXECUTE qu'aux fonctions
--    réellement appelées DANS une policy (donc avec les droits de l'appelant).
--    Les fonctions de trigger n'en ont pas besoin : PostgreSQL ne vérifie pas
--    EXECUTE au déclenchement. Les fonctions appelées depuis une autre
--    fonction SECURITY DEFINER non plus : elles s'exécutent alors sous
--    l'identité du propriétaire.
-- ============================================================================

revoke all on all functions in schema app from public, anon, authenticated;

grant execute on function app.my_org_id() to authenticated;
grant execute on function app.is_super_admin() to authenticated;
grant execute on function app.is_active_member() to authenticated;
grant execute on function app.is_org_admin() to authenticated;
grant execute on function app.can_write_surveys() to authenticated;
grant execute on function app.can_use_module(text) to authenticated;
grant execute on function app.profile_org_id(uuid) to authenticated;
grant execute on function app.survey_module_key(uuid) to authenticated;
grant execute on function app.org_has_module(uuid, text) to authenticated;

-- ============================================================================
-- 6. Triggers rebranchés sur app.*
-- ============================================================================

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

drop trigger if exists organisations_touch on public.organisations;
create trigger organisations_touch
  before update on public.organisations
  for each row execute function app.touch_updated_at();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function app.touch_updated_at();

drop trigger if exists surveys_touch on public.surveys;
create trigger surveys_touch
  before update on public.surveys
  for each row execute function app.touch_updated_at();

drop trigger if exists organisation_modules_touch on public.organisation_modules;
create trigger organisation_modules_touch
  before update on public.organisation_modules
  for each row execute function app.touch_updated_at();

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function app.guard_profile_privileges();

drop trigger if exists surveys_guard on public.surveys;
create trigger surveys_guard
  before insert or update on public.surveys
  for each row execute function app.guard_survey_row();

drop trigger if exists survey_responses_guard_insert on public.survey_responses;
create trigger survey_responses_guard_insert
  before insert on public.survey_responses
  for each row execute function app.guard_response_insert();

drop trigger if exists survey_responses_guard_update on public.survey_responses;
create trigger survey_responses_guard_update
  before update on public.survey_responses
  for each row execute function app.guard_response_update();

-- ============================================================================
-- 7. Policies rebranchées sur app.*
--    Recréées AVANT la suppression des anciennes fonctions publiques, sinon
--    celles-ci ne pourraient être supprimées qu'en `cascade` — ce qui
--    emporterait les policies elles-mêmes.
-- ============================================================================

-- organisations
drop policy if exists organisations_select on public.organisations;
create policy organisations_select on public.organisations
  for select to authenticated
  using (app.is_super_admin() or id = app.my_org_id());

drop policy if exists organisations_insert on public.organisations;
create policy organisations_insert on public.organisations
  for insert to authenticated
  with check (app.is_super_admin());

drop policy if exists organisations_update on public.organisations;
create policy organisations_update on public.organisations
  for update to authenticated
  using (app.is_super_admin() or (app.is_org_admin() and id = app.my_org_id()))
  with check (app.is_super_admin() or (app.is_org_admin() and id = app.my_org_id()));

drop policy if exists organisations_delete on public.organisations;
create policy organisations_delete on public.organisations
  for delete to authenticated
  using (app.is_super_admin());

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or app.is_super_admin()
    or (app.is_org_admin() and organisation_id = app.my_org_id())
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    id = auth.uid()
    or app.is_super_admin()
    or (app.is_org_admin() and organisation_id = app.my_org_id())
  )
  with check (
    id = auth.uid()
    or app.is_super_admin()
    or (app.is_org_admin() and organisation_id = app.my_org_id())
  );

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (app.is_super_admin());

-- platform_settings
drop policy if exists platform_settings_update on public.platform_settings;
create policy platform_settings_update on public.platform_settings
  for update to authenticated
  using (app.is_super_admin())
  with check (app.is_super_admin());

-- modules
drop policy if exists modules_write on public.modules;
create policy modules_write on public.modules
  for all to authenticated
  using (app.is_super_admin())
  with check (app.is_super_admin());

-- organisation_modules
drop policy if exists organisation_modules_select on public.organisation_modules;
create policy organisation_modules_select on public.organisation_modules
  for select to authenticated
  using (app.is_super_admin() or organisation_id = app.my_org_id());

drop policy if exists organisation_modules_insert on public.organisation_modules;
create policy organisation_modules_insert on public.organisation_modules
  for insert to authenticated
  with check (app.is_super_admin());

drop policy if exists organisation_modules_update on public.organisation_modules;
create policy organisation_modules_update on public.organisation_modules
  for update to authenticated
  using (
    app.is_super_admin()
    or (app.is_org_admin() and organisation_id = app.my_org_id())
  )
  with check (
    app.is_super_admin()
    or (app.is_org_admin() and organisation_id = app.my_org_id())
  );

drop policy if exists organisation_modules_delete on public.organisation_modules;
create policy organisation_modules_delete on public.organisation_modules
  for delete to authenticated
  using (app.is_super_admin());

-- profile_module_overrides
drop policy if exists profile_module_overrides_select on public.profile_module_overrides;
create policy profile_module_overrides_select on public.profile_module_overrides
  for select to authenticated
  using (
    profile_id = auth.uid()
    or app.is_super_admin()
    or (app.is_org_admin() and app.profile_org_id(profile_id) = app.my_org_id())
  );

drop policy if exists profile_module_overrides_write on public.profile_module_overrides;
create policy profile_module_overrides_write on public.profile_module_overrides
  for all to authenticated
  using (
    app.is_super_admin()
    or (app.is_org_admin() and app.profile_org_id(profile_id) = app.my_org_id())
  )
  with check (
    app.is_super_admin()
    or (
      app.is_org_admin()
      and app.profile_org_id(profile_id) = app.my_org_id()
      and (allowed = false or app.org_has_module(app.my_org_id(), module_key))
    )
  );

-- membership_requests
drop policy if exists membership_requests_select on public.membership_requests;
create policy membership_requests_select on public.membership_requests
  for select to authenticated
  using (user_id = auth.uid() or app.is_super_admin());

drop policy if exists membership_requests_update on public.membership_requests;
create policy membership_requests_update on public.membership_requests
  for update to authenticated
  using (app.is_super_admin())
  with check (app.is_super_admin());

drop policy if exists membership_requests_delete on public.membership_requests;
create policy membership_requests_delete on public.membership_requests
  for delete to authenticated
  using (
    app.is_super_admin()
    or (user_id = auth.uid() and status = 'pending')
  );

-- surveys
drop policy if exists surveys_select on public.surveys;
create policy surveys_select on public.surveys
  for select to authenticated
  using (
    app.is_super_admin()
    or (app.is_active_member() and organisation_id = app.my_org_id())
  );

drop policy if exists surveys_insert on public.surveys;
create policy surveys_insert on public.surveys
  for insert to authenticated
  with check (
    app.can_write_surveys()
    and organisation_id = app.my_org_id()
    and app.can_use_module(module_key)
  );

drop policy if exists surveys_update on public.surveys;
create policy surveys_update on public.surveys
  for update to authenticated
  using (
    app.is_super_admin()
    or (
      app.can_write_surveys()
      and organisation_id = app.my_org_id()
      and app.can_use_module(module_key)
    )
  )
  with check (
    app.is_super_admin()
    or (
      app.can_write_surveys()
      and organisation_id = app.my_org_id()
      and app.can_use_module(module_key)
    )
  );

drop policy if exists surveys_delete on public.surveys;
create policy surveys_delete on public.surveys
  for delete to authenticated
  using (
    app.is_super_admin()
    or (
      app.can_write_surveys()
      and organisation_id = app.my_org_id()
      and app.can_use_module(module_key)
    )
  );

-- survey_responses
drop policy if exists survey_responses_select on public.survey_responses;
create policy survey_responses_select on public.survey_responses
  for select to authenticated
  using (
    app.is_super_admin()
    or (
      app.is_active_member()
      and organisation_id = app.my_org_id()
      and app.can_use_module(app.survey_module_key(survey_id))
    )
  );

drop policy if exists survey_responses_update on public.survey_responses;
create policy survey_responses_update on public.survey_responses
  for update to authenticated
  using (
    app.is_super_admin()
    or (
      app.can_write_surveys()
      and organisation_id = app.my_org_id()
      and app.can_use_module(app.survey_module_key(survey_id))
    )
  )
  with check (
    app.is_super_admin()
    or (
      app.can_write_surveys()
      and organisation_id = app.my_org_id()
      and app.can_use_module(app.survey_module_key(survey_id))
    )
  );

drop policy if exists survey_responses_delete on public.survey_responses;
create policy survey_responses_delete on public.survey_responses
  for delete to authenticated
  using (app.is_super_admin());

-- audit_log
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    app.is_super_admin()
    or (app.is_org_admin() and organisation_id = app.my_org_id())
  );

-- erasure_requests
drop policy if exists erasure_requests_select on public.erasure_requests;
create policy erasure_requests_select on public.erasure_requests
  for select to authenticated
  using (
    app.is_super_admin()
    or (app.can_write_surveys() and organisation_id = app.my_org_id())
  );

drop policy if exists erasure_requests_update on public.erasure_requests;
create policy erasure_requests_update on public.erasure_requests
  for update to authenticated
  using (
    app.is_super_admin()
    or (app.is_org_admin() and organisation_id = app.my_org_id())
  )
  with check (
    app.is_super_admin()
    or (app.is_org_admin() and organisation_id = app.my_org_id())
  );

drop policy if exists erasure_requests_delete on public.erasure_requests;
create policy erasure_requests_delete on public.erasure_requests
  for delete to authenticated
  using (app.is_super_admin());

-- Storage : mêmes fonctions, même déplacement.
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  drop policy if exists survey_banners_write on storage.objects;
  create policy survey_banners_write on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'survey-banners'
      and app.can_write_surveys()
      and app.can_use_module('event')
      and (storage.foldername(name))[1] = app.my_org_id()::text
    );

  drop policy if exists survey_banners_update on storage.objects;
  create policy survey_banners_update on storage.objects
    for update to authenticated
    using (
      bucket_id = 'survey-banners'
      and app.can_write_surveys()
      and (storage.foldername(name))[1] = app.my_org_id()::text
    )
    with check (
      bucket_id = 'survey-banners'
      and (storage.foldername(name))[1] = app.my_org_id()::text
    );

  drop policy if exists survey_banners_delete on storage.objects;
  create policy survey_banners_delete on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'survey-banners'
      and app.can_write_surveys()
      and (storage.foldername(name))[1] = app.my_org_id()::text
    );
end
$$;

-- ============================================================================
-- 8. Fonctions publiques (RPC) : elles restent dans `public` parce que
--    l'application les appelle par le réseau, mais elles délèguent désormais
--    à `app.*` et leurs droits sont accordés NOMMÉMENT — jamais hérités des
--    default privileges de Supabase.
-- ============================================================================

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
    raise exception 'Payload invalide' using errcode = 'PT400';
  end if;

  if pg_column_size(p_data) > 65536 then
    raise exception 'Payload trop volumineux' using errcode = 'PT413';
  end if;

  select s.id, s.status, s.deleted_at, s.opens_at, s.closes_at, s.response_limit,
         s.require_consent, s.dedup_field, s.organisation_id
    into v_survey
  from public.surveys s
  join public.organisations o on o.id = s.organisation_id
  where s.id = p_survey_id and s.deleted_at is null and o.is_active;

  if v_survey.id is null then
    raise exception 'Sondage introuvable' using errcode = 'PT404';
  end if;

  if v_survey.status <> 'published'
     or (v_survey.opens_at is not null and v_survey.opens_at > now())
     or (v_survey.closes_at is not null and v_survey.closes_at <= now())
  then
    raise exception 'Sondage fermé' using errcode = 'PT423';
  end if;

  if v_survey.require_consent
     and (p_consent_given is not true or btrim(coalesce(p_consent_text, '')) = '')
  then
    raise exception 'Consentement requis' using errcode = 'PT412';
  end if;

  if v_survey.response_limit is not null then
    select count(*) into v_live_count
    from public.survey_responses r
    where r.survey_id = p_survey_id and r.deleted_at is null;

    if v_live_count >= v_survey.response_limit then
      raise exception 'Nombre maximal de réponses atteint' using errcode = 'PT429';
    end if;
  end if;

  if v_survey.dedup_field is not null then
    v_dedup_key := app.dedup_hash(p_survey_id, p_dedup_value);
    if v_dedup_key is null then
      raise exception 'Valeur de dédoublonnage manquante' using errcode = 'PT400';
    end if;
  end if;

  begin
    insert into public.survey_responses (
      survey_id, organisation_id, data, consent_given, consent_text, dedup_key
    )
    values (
      p_survey_id, v_survey.organisation_id, p_data,
      coalesce(p_consent_given, false), p_consent_text, v_dedup_key
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'Réponse déjà enregistrée' using errcode = 'PT409';
  end;

  return v_id;
end;
$$;

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
  if not app.is_super_admin() then
    raise exception 'Réservé au super administrateur' using errcode = 'PT403';
  end if;

  if p_role = 'super_admin' then
    raise exception 'Un rattachement ne peut pas accorder le rôle super_admin'
      using errcode = 'PT400';
  end if;

  select * into v_request from public.membership_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'Demande introuvable' using errcode = 'PT404';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Demande déjà traitée' using errcode = 'PT409';
  end if;

  if v_request.organisation_id is not null then
    v_org_id := v_request.organisation_id;
  else
    if p_organisation_slug is null then
      raise exception 'Un identifiant d''organisation est requis pour créer l''organisation'
        using errcode = 'PT400';
    end if;

    insert into public.organisations (slug, name)
    values (p_organisation_slug, btrim(v_request.requested_organisation_name))
    returning id into v_org_id;
  end if;

  foreach v_module in array coalesce(p_module_keys, '{}'::text[])
  loop
    if not exists (select 1 from public.modules m where m.key = v_module) then
      raise exception 'Module inconnu : %', v_module using errcode = 'PT400';
    end if;

    insert into public.organisation_modules (organisation_id, module_key, granted_by)
    values (v_org_id, v_module, v_actor)
    on conflict (organisation_id, module_key) do nothing;
  end loop;

  update public.profiles
     set organisation_id = v_org_id, role = p_role, status = 'active'
   where id = v_request.user_id;

  delete from public.profile_module_overrides where profile_id = v_request.user_id;

  insert into public.profile_module_overrides (profile_id, module_key, allowed, set_by)
  select v_request.user_id, m.key, m.key = any (coalesce(p_module_keys, '{}'::text[])), v_actor
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

  perform app.write_audit(
    'membership.approved', v_org_id, 'membership_requests', p_request_id::text,
    jsonb_build_object('role', p_role, 'modules', coalesce(p_module_keys, '{}'::text[]))
  );

  return v_org_id;
end;
$$;

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
  if not app.is_super_admin() then
    raise exception 'Réservé au super administrateur' using errcode = 'PT403';
  end if;

  select * into v_request from public.membership_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'Demande introuvable' using errcode = 'PT404';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Demande déjà traitée' using errcode = 'PT409';
  end if;

  update public.membership_requests
     set status = 'rejected', decision_note = p_note,
         decided_by = auth.uid(), decided_at = now()
   where id = p_request_id;

  perform app.write_audit(
    'membership.rejected', v_request.organisation_id,
    'membership_requests', p_request_id::text, '{}'::jsonb
  );
end;
$$;

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
    raise exception 'Identifiant requis' using errcode = 'PT400';
  end if;

  select s.organisation_id into v_org
  from public.surveys s
  where s.id = p_survey_id and s.deleted_at is null;

  if v_org is null then
    raise exception 'Sondage introuvable' using errcode = 'PT404';
  end if;

  insert into public.erasure_requests (organisation_id, survey_id, identifier, claim)
  values (v_org, p_survey_id, btrim(p_identifier), nullif(btrim(coalesce(p_claim, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

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
  select * into v_request from public.erasure_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'Demande introuvable' using errcode = 'PT404';
  end if;

  if not (
    app.is_super_admin()
    or (app.is_org_admin() and v_request.organisation_id = app.my_org_id())
  ) then
    raise exception 'Droits insuffisants' using errcode = 'PT403';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Demande déjà traitée' using errcode = 'PT409';
  end if;

  v_key := app.dedup_hash(v_request.survey_id, v_request.identifier);

  if v_key is not null then
    if p_hard then
      delete from public.survey_responses
      where survey_id = v_request.survey_id and dedup_key = v_key;
      get diagnostics v_count = row_count;
    else
      update public.survey_responses
         set deleted_at = now()
       where survey_id = v_request.survey_id and dedup_key = v_key and deleted_at is null;
      get diagnostics v_count = row_count;
    end if;
  end if;

  update public.erasure_requests
     set status = 'done', handled_by = auth.uid(), handled_at = now(),
         handled_note = p_note, affected_rows = v_count
   where id = p_request_id;

  perform app.write_audit(
    'erasure.applied', v_request.organisation_id, 'erasure_requests', p_request_id::text,
    jsonb_build_object('hard', p_hard, 'affected_rows', v_count)
  );

  return v_count;
end;
$$;

create or replace function public.purge_expired_responses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer := 0;
  v_soft integer := 0;
begin
  if auth.uid() is not null and not app.is_super_admin() then
    raise exception 'Réservé au super administrateur' using errcode = 'PT403';
  end if;

  delete from public.survey_responses
  where purge_after is not null and purge_after <= now();
  get diagnostics v_expired = row_count;

  delete from public.survey_responses
  where deleted_at is not null
    and deleted_at <= now() - make_interval(days => app.soft_delete_grace_days());
  get diagnostics v_soft = row_count;

  if v_expired + v_soft > 0 then
    perform app.write_audit(
      'retention.purged_responses', null, 'survey_responses', null,
      jsonb_build_object('expired', v_expired, 'soft_deleted', v_soft)
    );
  end if;

  return v_expired + v_soft;
end;
$$;

create or replace function public.purge_deleted_surveys()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is not null and not app.is_super_admin() then
    raise exception 'Réservé au super administrateur' using errcode = 'PT403';
  end if;

  delete from public.surveys
  where deleted_at is not null
    and deleted_at <= now() - make_interval(days => app.soft_delete_grace_days());
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform app.write_audit(
      'retention.purged_surveys', null, 'surveys', null,
      jsonb_build_object('count', v_count)
    );
  end if;

  return v_count;
end;
$$;

create or replace function public.my_modules()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', m.key,
        'name', m.name,
        'description', m.description,
        'isCore', m.is_core,
        'allowed', app.can_use_module(m.key),
        'enabledForOrganisation', app.org_has_module(app.my_org_id(), m.key)
      )
      order by m.sort_order
    ),
    '[]'::jsonb
  )
  from public.modules m
$$;

-- ============================================================================
-- 9. Suppression des fonctions internes restées dans le schéma exposé.
--    Sans `cascade` : si une dépendance subsistait, la migration échouerait
--    au lieu de supprimer silencieusement une policy.
-- ============================================================================

drop function if exists public.my_org_id();
drop function if exists public.my_role();
drop function if exists public.my_status();
drop function if exists public.is_super_admin();
drop function if exists public.is_active_member();
drop function if exists public.is_org_admin();
drop function if exists public.can_write_surveys();
drop function if exists public.can_use_module(text);
drop function if exists public.profile_can_use_module(uuid, text);
drop function if exists public.profile_org_id(uuid);
drop function if exists public.survey_module_key(uuid);
drop function if exists public.survey_org_id(uuid);
drop function if exists public.org_has_module(uuid, text);
drop function if exists public.write_audit(text, uuid, text, text, jsonb);
drop function if exists public.dedup_hash(uuid, text);
drop function if exists public.soft_delete_grace_days();
drop function if exists public.touch_updated_at();
drop function if exists public.handle_new_user();
drop function if exists public.guard_profile_privileges();
drop function if exists public.guard_survey_row();
drop function if exists public.guard_response_insert();
drop function if exists public.guard_response_update();

-- ============================================================================
-- 10. Droits des fonctions publiques : accordés nommément, rôle par rôle.
--     Ce qu'un visiteur anonyme n'a pas à pouvoir appeler lui est retiré,
--     même si la fonction refuserait de toute façon son appel : réduire la
--     surface vaut mieux que compter sur une vérification interne.
-- ============================================================================

revoke all on function public.submit_survey_response(uuid, jsonb, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_survey_response(uuid, jsonb, boolean, text, text)
  to anon, authenticated;

revoke all on function public.request_erasure(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.request_erasure(uuid, text, text) to anon, authenticated;

revoke all on function public.approve_membership_request(uuid, public.user_role, text[], text, text)
  from public, anon, authenticated;
grant execute on function public.approve_membership_request(uuid, public.user_role, text[], text, text)
  to authenticated;

revoke all on function public.reject_membership_request(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reject_membership_request(uuid, text) to authenticated;

revoke all on function public.apply_erasure(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.apply_erasure(uuid, boolean, text) to authenticated;

revoke all on function public.purge_expired_responses() from public, anon, authenticated;
grant execute on function public.purge_expired_responses() to authenticated;

revoke all on function public.purge_deleted_surveys() from public, anon, authenticated;
grant execute on function public.purge_deleted_surveys() to authenticated;

revoke all on function public.my_modules() from public, anon, authenticated;
grant execute on function public.my_modules() to authenticated;

-- ============================================================================
-- 11. Privilèges des VUES, et suppression de la cause première.
--
-- Deuxième manifestation du même piège, également constatée en déploiement :
-- les `default privileges` de Supabase accordent aussi `SELECT` à `anon` et
-- `authenticated` sur toute nouvelle VUE (une vue est une « table » au sens
-- des privilèges). La migration qui révoquait les tables a tourné AVANT la
-- création des vues, qui ont donc reçu ces droits automatiques :
-- `organisation_directory` — la liste des organisations clientes — était
-- lisible sans compte.
--
-- On corrige les trois vues, PUIS on retire les default privileges eux-mêmes :
-- à partir d'ici, tout nouvel objet du schéma `public` naît sans aucun droit,
-- et il faut l'accorder explicitement. C'est plus verbeux, et c'est le but :
-- un oubli devient une absence d'accès, pas une fuite.
-- ============================================================================

revoke all on public.public_surveys from public, anon, authenticated;
-- Seul accès public aux sondages : volontairement ouvert.
grant select on public.public_surveys to anon, authenticated;

revoke all on public.organisation_directory from public, anon, authenticated;
-- Choix de l'organisation à rejoindre : session obligatoire.
grant select on public.organisation_directory to authenticated;

revoke all on public.survey_stats from public, anon, authenticated;
-- Statistiques : soumises au RLS de l'appelant, donc jamais anonymes.
grant select on public.survey_stats to authenticated;

-- Cause première : plus aucun droit automatique sur les objets à venir.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
