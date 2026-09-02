-- ============================================================================
-- Traçabilité et droit à l'effacement.
-- ============================================================================

create table if not exists public.audit_log (
  id bigserial primary key,
  organisation_id uuid references public.organisations (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null
    constraint audit_log_action_format check (action ~ '^[a-z][a-z0-9_.]{2,60}$'),
  target_table text,
  target_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is
  'Journal des décisions sensibles : validations de rattachement, activation de modules, effacements. Écrit uniquement par des fonctions SECURITY DEFINER.';

create index if not exists audit_log_org_idx
  on public.audit_log (organisation_id, created_at desc);

create index if not exists audit_log_action_idx
  on public.audit_log (action, created_at desc);

alter table public.audit_log enable row level security;

-- ----------------------------------------------------------------------------
-- Demandes d'effacement : mécanisme OPÉRATIONNEL du droit à l'effacement,
-- pas seulement une adresse email dans une politique de confidentialité.
-- ----------------------------------------------------------------------------
create table if not exists public.erasure_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id) on delete cascade,
  survey_id uuid references public.surveys (id) on delete cascade,
  -- Valeur permettant de retrouver les réponses concernées (email, référence…).
  identifier text not null
    constraint erasure_requests_identifier_length
    check (char_length(identifier) between 1 and 320),
  claim text
    constraint erasure_requests_claim_length check (claim is null or char_length(claim) <= 2000),
  status public.erasure_status not null default 'pending',
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  handled_note text,
  affected_rows integer,
  created_at timestamptz not null default now(),

  constraint erasure_requests_handled_coherent check (
    (status = 'pending' and handled_at is null)
    or (status <> 'pending' and handled_at is not null)
  )
);

create index if not exists erasure_requests_status_idx
  on public.erasure_requests (status, created_at desc);

alter table public.erasure_requests enable row level security;
