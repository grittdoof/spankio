-- ============================================================================
-- Fonctions d'accès au contexte de l'appelant.
--
-- Ces fonctions sont SECURITY DEFINER pour une raison précise : les policies
-- RLS de `public.profiles` ne doivent JAMAIS interroger `public.profiles`,
-- sinon la policy se rappelle elle-même (récursion infinie). En contournant le
-- RLS sur profiles, ces fonctions cassent le cycle.
--
-- Toutes sont `stable` (résultat constant dans une requête) et posent
-- `search_path = ''` : aucun objet n'est résolu implicitement, donc aucun
-- détournement possible par un search_path hostile.
-- ============================================================================

create or replace function public.my_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organisation_id
  from public.profiles p
  where p.id = auth.uid()
$$;

create or replace function public.my_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
$$;

create or replace function public.my_status()
returns public.profile_status
language sql
stable
security definer
set search_path = ''
as $$
  select p.status
  from public.profiles p
  where p.id = auth.uid()
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
      and p.status = 'active'
  )
$$;

-- Membre actif d'une organisation (quel que soit son rôle).
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.organisation_id is not null
  )
$$;

-- Administrateur actif de sa propre organisation.
create or replace function public.is_org_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.role = 'admin'
      and p.organisation_id is not null
  )
$$;

-- Droit d'écrire des sondages : admin ou editor actif.
create or replace function public.can_write_surveys()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.role in ('admin', 'editor')
      and p.organisation_id is not null
  )
$$;

-- ----------------------------------------------------------------------------
-- Autorisation d'un module pour un profil donné.
--   1. un module core est toujours autorisé ;
--   2. une surcharge par utilisateur, si elle existe, fait autorité ;
--   3. sinon on retombe sur l'activation au niveau de l'organisation.
-- ----------------------------------------------------------------------------
create or replace function public.profile_can_use_module(
  p_profile_id uuid,
  p_module_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select m.key, m.is_core
    from public.modules m
    where m.key = p_module_key
  ),
  me as (
    select p.organisation_id
    from public.profiles p
    where p.id = p_profile_id
      and p.status = 'active'
  ),
  override as (
    select o.allowed
    from public.profile_module_overrides o
    where o.profile_id = p_profile_id
      and o.module_key = p_module_key
  ),
  org_grant as (
    select om.enabled
    from public.organisation_modules om, me
    where om.organisation_id = me.organisation_id
      and om.module_key = p_module_key
  )
  select case
    when not exists (select 1 from target) then false
    when (select is_core from target) then exists (select 1 from me)
    when not exists (select 1 from me) then false
    when exists (select 1 from override) then (select allowed from override)
    else coalesce((select enabled from org_grant), false)
  end
$$;

comment on function public.profile_can_use_module(uuid, text) is
  'Autorisation effective d''un module : core toujours autorisé, surcharge utilisateur prioritaire, sinon activation de l''organisation.';

create or replace function public.can_use_module(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.profile_can_use_module(auth.uid(), p_module_key)
$$;

-- ----------------------------------------------------------------------------
-- Écriture du journal d'audit. SECURITY DEFINER justifié : audit_log n'accepte
-- aucune écriture directe (aucune policy d'insertion), afin qu'un utilisateur
-- ne puisse pas fabriquer de fausses entrées.
-- ----------------------------------------------------------------------------
create or replace function public.write_audit(
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
  values (p_organisation_id, auth.uid(), p_action, p_target_table, p_target_id, coalesce(p_meta, '{}'::jsonb));
end;
$$;

-- Fonction d'horodatage générique pour les colonnes updated_at.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.write_audit(text, uuid, text, text, jsonb) from public;

-- ----------------------------------------------------------------------------
-- Fonctions de lecture ponctuelle utilisées DANS les policies.
--
-- Elles sont SECURITY DEFINER pour une raison précise : une sous-requête écrite
-- directement dans une policy reste soumise au RLS de la table interrogée, ce
-- qui produit des refus silencieux difficiles à diagnostiquer. En passant par
-- ces fonctions, la policy lit une valeur déterministe.
-- ----------------------------------------------------------------------------

create or replace function public.profile_org_id(p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organisation_id from public.profiles p where p.id = p_profile_id
$$;

create or replace function public.survey_module_key(p_survey_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.module_key from public.surveys s where s.id = p_survey_id
$$;

create or replace function public.survey_org_id(p_survey_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.organisation_id from public.surveys s where s.id = p_survey_id
$$;

-- Le module est-il concédé (et activé) à cette organisation ?
create or replace function public.org_has_module(
  p_organisation_id uuid,
  p_module_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.is_core from public.modules m where m.key = p_module_key),
    false
  )
  or exists (
    select 1
    from public.organisation_modules om
    where om.organisation_id = p_organisation_id
      and om.module_key = p_module_key
      and om.enabled
  )
$$;
