-- ============================================================================
-- Un rattachement ne peut pas rétrograder un super administrateur.
--
-- Situation rencontrée en exploitation : le premier super administrateur avait
-- aussi déposé une demande de rattachement pour créer son organisation, avec
-- le rôle `admin`. Valider cette demande aurait écrasé son rôle — la fonction
-- fait `update profiles set role = p_role` — et la plateforme se serait
-- retrouvée SANS AUCUN super administrateur, donc sans personne pour valider
-- les demandes suivantes ni rétablir la situation depuis l'application.
--
-- Le refus est explicite plutôt que silencieux : rien n'empêche de retirer
-- délibérément le rôle depuis la base, mais cela ne doit pas arriver comme
-- effet de bord d'une validation de routine.
-- ============================================================================

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

  -- Garde-fou : ne jamais rétrograder un super administrateur par ce chemin.
  if exists (
    select 1 from public.profiles p
    where p.id = v_request.user_id and p.role = 'super_admin'
  ) then
    raise exception
      'Ce compte est super administrateur : le rattacher à une organisation lui retirerait ce rôle'
      using errcode = 'PT409';
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

revoke all on function public.approve_membership_request(uuid, public.user_role, text[], text, text)
  from public, anon, authenticated;
grant execute on function public.approve_membership_request(uuid, public.user_role, text[], text, text)
  to authenticated;
