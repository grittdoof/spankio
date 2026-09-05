-- ============================================================================
-- Un super administrateur peut aussi appartenir à une organisation.
--
-- Le modèle initial l'interdisait (`profiles_super_admin_has_no_org`), au motif
-- que le super administrateur gère la plateforme et non un tenant. C'est une
-- séparation défendable, mais elle interdit un cas parfaitement légitime et
-- fréquent : l'éditeur de la plateforme est aussi l'administrateur de la
-- première organisation cliente.
--
-- Deux conséquences à traiter, sinon le rattachement serait cosmétique :
--
--  1. `app.can_write_surveys()` n'acceptait que les rôles `admin` et `editor`.
--     Un super administrateur rattaché n'aurait donc pas pu créer un sondage
--     dans SA PROPRE organisation, alors qu'il peut modifier ceux de toutes
--     les autres. Incohérence corrigée.
--
--  2. `approve_membership_request` écrase le rôle du profil. Valider la
--     demande d'un super administrateur le PRIVAIT de son rôle plateforme —
--     et pouvait laisser la plateforme sans personne pour valider les demandes
--     suivantes. Le rôle est désormais PRÉSERVÉ : le compte est rattaché, il
--     reste super administrateur, et l'audit en garde la trace.
--
-- Toutes les autres policies fonctionnaient déjà : l'autorité plateforme
-- (`app.is_super_admin()`) englobe partout les droits d'un administrateur
-- d'organisation.
-- ============================================================================

alter table public.profiles
  drop constraint if exists profiles_super_admin_has_no_org;

comment on column public.profiles.organisation_id is
  'Organisation de rattachement. Un super administrateur peut en avoir une : son autorité plateforme s''y ajoute, elle ne s''y substitue pas.';

-- ----------------------------------------------------------------------------
-- Droit d'écrire des sondages : admin, editor, ou super administrateur
-- rattaché à une organisation.
-- ----------------------------------------------------------------------------
create or replace function app.can_write_surveys()
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
      and (p.role in ('admin', 'editor') or p.role = 'super_admin')
  )
$$;

-- ----------------------------------------------------------------------------
-- Validation d'une demande : le rôle plateforme survit au rattachement.
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
  v_current_role public.user_role;
  v_granted_role public.user_role;
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

  select p.role into v_current_role from public.profiles p where p.id = v_request.user_id;

  -- Le rattachement AJOUTE une organisation ; il ne retire jamais l'autorité
  -- plateforme. Sans cela, valider la demande d'un super administrateur
  -- l'aurait rétrogradé, éventuellement jusqu'à n'en laisser aucun.
  v_granted_role := case when v_current_role = 'super_admin' then 'super_admin' else p_role end;

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
     set organisation_id = v_org_id, role = v_granted_role, status = 'active'
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
    jsonb_build_object(
      'role', p_role,
      'effective_role', v_granted_role,
      'platform_role_preserved', v_granted_role <> p_role,
      'modules', coalesce(p_module_keys, '{}'::text[])
    )
  );

  return v_org_id;
end;
$$;

revoke all on function public.approve_membership_request(uuid, public.user_role, text[], text, text)
  from public, anon, authenticated;
grant execute on function public.approve_membership_request(uuid, public.user_role, text[], text, text)
  to authenticated;
