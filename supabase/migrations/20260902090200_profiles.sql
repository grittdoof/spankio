-- ============================================================================
-- Profils : extension applicative de auth.users.
-- Un super_admin n'appartient à aucune organisation ; les autres rôles ne
-- peuvent être actifs qu'une fois rattachés à une organisation.
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organisation_id uuid references public.organisations (id) on delete set null,
  role public.user_role not null default 'viewer',
  status public.profile_status not null default 'pending',
  full_name text
    constraint profiles_full_name_length check (full_name is null or char_length(full_name) <= 160),
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Un compte actif non super_admin est forcément rattaché à une organisation.
  constraint profiles_membership_coherent check (
    role = 'super_admin' or status <> 'active' or organisation_id is not null
  ),
  -- Un super_admin gère la plateforme, pas un tenant.
  constraint profiles_super_admin_has_no_org check (
    role <> 'super_admin' or organisation_id is null
  )
);

comment on table public.profiles is
  'Profil applicatif. Le rôle et le rattachement ne sont modifiables que par un super_admin (ou un admin dans sa propre organisation) : voir le trigger anti-escalade.';

create index if not exists profiles_organisation_id_idx
  on public.profiles (organisation_id)
  where organisation_id is not null;

alter table public.profiles enable row level security;

-- ----------------------------------------------------------------------------
-- Création automatique du profil à l'inscription.
-- SECURITY DEFINER justifié : le trigger s'exécute dans le contexte d'un
-- nouvel utilisateur qui n'a encore aucun droit sur public.profiles.
-- Le profil créé est volontairement inerte : role 'viewer', statut 'pending',
-- aucune organisation. Seul un super_admin peut l'élever.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
