-- ============================================================================
-- Catalogue de modules, activation par organisation, et surcharge PAR
-- UTILISATEUR (exigence : la restriction n'est pas seulement organisationnelle).
-- ============================================================================

create table if not exists public.modules (
  key text primary key
    constraint modules_key_format check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  description text not null default '',
  -- Un module core est toujours actif et ne peut être ni retiré ni interdit.
  is_core boolean not null default false,
  sort_order integer not null default 100
);

comment on table public.modules is
  'Catalogue des modules de la plateforme. Seed applicatif, jamais de table par type de question.';

insert into public.modules (key, name, description, is_core, sort_order) values
  ('core', 'Sondages',
   'Création de sondages multi-étapes, collecte des réponses, statistiques et exports.',
   true, 10),
  ('event', 'Événements et inscriptions',
   'Inscriptions à des événements : bannière, bloc événement, carte, ajout à l''agenda et itinéraire.',
   false, 20)
on conflict (key) do nothing;

alter table public.modules enable row level security;

-- ----------------------------------------------------------------------------
-- Activation par organisation.
-- Répartition des pouvoirs : le super_admin décide quels modules une
-- organisation A LE DROIT d'utiliser (existence de la ligne) ; l'admin de
-- l'organisation décide s'il les active (colonne `enabled`).
-- ----------------------------------------------------------------------------
create table if not exists public.organisation_modules (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  module_key text not null references public.modules (key) on delete cascade,
  enabled boolean not null default true,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organisation_id, module_key)
);

alter table public.organisation_modules enable row level security;

-- ----------------------------------------------------------------------------
-- Surcharge par utilisateur.
-- Sémantique : une ligne présente FAIT AUTORITÉ (autorisation ou interdiction
-- explicite) ; en son absence, on retombe sur l'activation organisationnelle.
-- Un module core ne peut jamais être interdit.
-- ----------------------------------------------------------------------------
create table if not exists public.profile_module_overrides (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  module_key text not null references public.modules (key) on delete cascade,
  allowed boolean not null default true,
  set_by uuid references public.profiles (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (profile_id, module_key)
);

comment on table public.profile_module_overrides is
  'Restriction des modules par utilisateur. Une ligne fait autorité ; sans ligne, l''activation de l''organisation s''applique.';

alter table public.profile_module_overrides enable row level security;
