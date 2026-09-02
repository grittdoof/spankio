-- ============================================================================
-- Demandes de rattachement : SEULE voie pour devenir admin ou editor.
-- Le super_admin valide, et choisit à ce moment le rôle ET les modules
-- autorisés pour ce compte précis.
-- ============================================================================

create table if not exists public.membership_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  requester_email text not null,
  requester_name text,

  -- Rattachement à une organisation existante…
  organisation_id uuid references public.organisations (id) on delete cascade,
  -- …ou demande de création d'une nouvelle organisation.
  requested_organisation_name text,

  requested_role public.user_role not null default 'editor'
    constraint membership_requests_role_not_super
    check (requested_role <> 'super_admin'),
  message text
    constraint membership_requests_message_length
    check (message is null or char_length(message) <= 2000),

  status public.request_status not null default 'pending',
  decided_role public.user_role
    constraint membership_requests_decided_role_not_super
    check (decided_role is null or decided_role <> 'super_admin'),
  decided_modules text[] not null default '{}',
  decision_note text,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,

  created_at timestamptz not null default now(),

  constraint membership_requests_target check (
    organisation_id is not null
    or nullif(trim(coalesce(requested_organisation_name, '')), '') is not null
  ),
  constraint membership_requests_decision_coherent check (
    (status = 'pending' and decided_at is null and decided_by is null)
    or (status <> 'pending' and decided_at is not null)
  ),
  constraint membership_requests_approval_has_role check (
    status <> 'approved' or decided_role is not null
  )
);

-- Une seule demande en attente par compte.
create unique index if not exists membership_requests_one_pending_per_user
  on public.membership_requests (user_id)
  where status = 'pending';

create index if not exists membership_requests_status_idx
  on public.membership_requests (status, created_at desc);

alter table public.membership_requests enable row level security;
