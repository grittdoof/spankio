-- ============================================================================
-- Triggers d'intégrité.
--
-- Le RLS décide QUELLES LIGNES sont accessibles ; il ne sait pas restreindre
-- QUELLES COLONNES peuvent changer. Ces triggers couvrent ce manque : ils
-- empêchent l'escalade de privilèges et rendent les réponses immuables.
-- ============================================================================

-- --- updated_at -------------------------------------------------------------
drop trigger if exists organisations_touch on public.organisations;
create trigger organisations_touch
  before update on public.organisations
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists surveys_touch on public.surveys;
create trigger surveys_touch
  before update on public.surveys
  for each row execute function public.touch_updated_at();

drop trigger if exists organisation_modules_touch on public.organisation_modules;
create trigger organisation_modules_touch
  before update on public.organisation_modules
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Anti-escalade de privilèges sur les profils.
--
-- `auth.uid()` nul signifie qu'aucun JWT n'est présent : on est dans un
-- contexte serveur de confiance (service role, migration, tâche planifiée).
-- Ce contexte est explicitement autorisé — c'est la seule façon d'amorcer le
-- premier super_admin — et il est journalisé côté application.
-- ----------------------------------------------------------------------------
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_sensitive boolean := (
    new.role is distinct from old.role
    or new.organisation_id is distinct from old.organisation_id
    or new.status is distinct from old.status
  );
begin
  if not v_sensitive then
    return new;
  end if;

  -- Contexte serveur de confiance (aucun JWT).
  if v_actor is null then
    return new;
  end if;

  if public.is_super_admin() then
    return new;
  end if;

  -- Un admin d'organisation peut gérer ses propres membres, mais :
  --   * jamais promouvoir qui que ce soit super_admin ;
  --   * jamais déplacer un membre vers une autre organisation ;
  --   * jamais se modifier lui-même (pas d'auto-promotion).
  if public.is_org_admin()
     and old.organisation_id is not null
     and old.organisation_id = public.my_org_id()
     and new.organisation_id is not distinct from old.organisation_id
     and new.role <> 'super_admin'
     and old.role <> 'super_admin'
     and new.id <> v_actor
  then
    return new;
  end if;

  raise exception 'Modification de rôle, de rattachement ou de statut non autorisée'
    using errcode = '42501';
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ----------------------------------------------------------------------------
-- Sondages : l'organisation d'un sondage est immuable (sinon on pourrait
-- transférer une donnée d'un tenant à un autre), et `published_at` reflète
-- réellement la première publication.
-- ----------------------------------------------------------------------------
create or replace function public.guard_survey_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organisation_id is distinct from old.organisation_id then
    raise exception 'L''organisation d''un sondage ne peut pas être modifiée'
      using errcode = '42501';
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists surveys_guard on public.surveys;
create trigger surveys_guard
  before insert or update on public.surveys
  for each row execute function public.guard_survey_row();

-- ----------------------------------------------------------------------------
-- Réponses : l'organisation est déduite du sondage (jamais fournie par le
-- client), la date de purge est calculée depuis la durée de conservation, et
-- une réponse enregistrée est immuable — seul `deleted_at` peut évoluer.
-- ----------------------------------------------------------------------------
create or replace function public.guard_response_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_retention integer;
begin
  select s.organisation_id, s.retention_days
    into v_org, v_retention
  from public.surveys s
  where s.id = new.survey_id;

  if v_org is null then
    raise exception 'Sondage introuvable' using errcode = '23503';
  end if;

  new.organisation_id := v_org;

  if new.purge_after is null and v_retention is not null then
    new.purge_after := new.submitted_at + make_interval(days => v_retention);
  end if;

  return new;
end;
$$;

drop trigger if exists survey_responses_guard_insert on public.survey_responses;
create trigger survey_responses_guard_insert
  before insert on public.survey_responses
  for each row execute function public.guard_response_insert();

create or replace function public.guard_response_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.survey_id is distinct from old.survey_id
     or new.organisation_id is distinct from old.organisation_id
     or new.data is distinct from old.data
     or new.consent_given is distinct from old.consent_given
     or new.consent_text is distinct from old.consent_text
     or new.dedup_key is distinct from old.dedup_key
     or new.submitted_at is distinct from old.submitted_at
  then
    raise exception 'Une réponse est immuable : seule sa suppression (deleted_at) peut évoluer'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists survey_responses_guard_update on public.survey_responses;
create trigger survey_responses_guard_update
  before update on public.survey_responses
  for each row execute function public.guard_response_update();
