-- ============================================================================
-- Types énumérés de la plateforme.
-- Idempotent : chaque type est créé seulement s'il n'existe pas déjà.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('super_admin', 'admin', 'editor', 'viewer');
  end if;

  if not exists (select 1 from pg_type where typname = 'profile_status') then
    create type public.profile_status as enum ('pending', 'active', 'suspended');
  end if;

  if not exists (select 1 from pg_type where typname = 'request_status') then
    create type public.request_status as enum ('pending', 'approved', 'rejected');
  end if;

  if not exists (select 1 from pg_type where typname = 'survey_kind') then
    create type public.survey_kind as enum ('survey', 'event');
  end if;

  if not exists (select 1 from pg_type where typname = 'survey_status') then
    create type public.survey_status as enum ('draft', 'published', 'closed');
  end if;

  -- Les six bases légales de l'article 6 du RGPD. Aucune n'est imposée par la
  -- plateforme : c'est l'organisation qui choisit celle qui la concerne.
  if not exists (select 1 from pg_type where typname = 'legal_basis') then
    create type public.legal_basis as enum (
      'consent',
      'contract',
      'legal_obligation',
      'vital_interests',
      'public_task',
      'legitimate_interests'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'erasure_status') then
    create type public.erasure_status as enum ('pending', 'done', 'rejected');
  end if;
end
$$;
