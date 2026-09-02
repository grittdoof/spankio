-- ============================================================================
-- Organisations (tenants). Aucune hypothèse de secteur : le vocabulaire et le
-- branding sont des données, pas du code.
-- ============================================================================

create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    constraint organisations_slug_format
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$'),
  name text not null
    constraint organisations_name_length check (char_length(name) between 2 and 160),
  logo_url text,
  -- Branding : couleur d'accent, mentions, coordonnées d'affichage…
  brand jsonb not null default '{}'::jsonb,
  contact_email text,
  contact_phone text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organisations is
  'Tenant. L''isolation de toutes les données métier se fait par organisation_id + RLS.';
comment on column public.organisations.brand is
  'Réglages de marque (couleur d''accent, logo, mentions). Libre, sans schéma imposé.';

alter table public.organisations enable row level security;
