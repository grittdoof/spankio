-- ============================================================================
-- Réglages de plateforme (singleton). Alimente les pages légales : aucune
-- valeur juridique n'est codée en dur dans l'application.
-- L'autorité de contrôle est un champ libre : la plateforme est vendable hors
-- de France, où la CNIL n'est pas l'autorité compétente.
-- ============================================================================

create table if not exists public.platform_settings (
  id smallint primary key default 1 constraint platform_settings_singleton check (id = 1),

  -- Éditeur du service
  publisher_name text,
  publisher_legal_form text,
  publisher_address text,
  publisher_email text,
  publisher_phone text,
  publisher_director text,
  publisher_registration text,

  -- Hébergeur
  host_name text,
  host_address text,
  host_url text,

  -- Délégué à la protection des données
  dpo_name text,
  dpo_email text,

  -- Autorité de contrôle compétente (champ libre, ex. « CNIL » en France)
  authority_name text,
  authority_address text,
  authority_url text,

  -- Adresse d'exercice des droits RGPD
  privacy_email text,

  -- Durée de conservation par défaut proposée aux organisations
  default_retention_days integer not null default 365
    constraint platform_settings_retention_range
    check (default_retention_days between 1 and 3650),

  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.platform_settings is
  'Singleton lu par /mentions-legales et /confidentialite. Édité par le super_admin uniquement.';

-- Seed idempotent de la ligne unique, sans aucune valeur inventée : les pages
-- légales doivent signaler explicitement ce qui n'est pas encore renseigné.
insert into public.platform_settings (id) values (1)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
