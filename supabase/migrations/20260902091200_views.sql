-- ============================================================================
-- Vues.
--
-- `public_surveys` est volontairement en droits du propriétaire
-- (`security_invoker = false`) : c'est le seul point d'accès du public aux
-- sondages, et il n'expose qu'un sous-ensemble de colonnes de sondages
-- réellement publiés et ouverts. Le rôle `anon` n'a AUCUNE policy sur la table
-- `surveys` elle-même.
--
-- `survey_stats` est au contraire en droits de l'appelant
-- (`security_invoker = true`) : les statistiques restent soumises au RLS.
-- Tous les comptages excluent les lignes soft-deleted.
-- ============================================================================

drop view if exists public.public_surveys;
create view public.public_surveys
with (security_invoker = false) as
select
  s.id,
  s.slug,
  o.slug                as organisation_slug,
  o.name                as organisation_name,
  o.logo_url            as organisation_logo_url,
  o.brand               as organisation_brand,
  o.contact_email       as organisation_contact_email,
  o.contact_phone       as organisation_contact_phone,
  o.address             as organisation_address,
  s.module_key,
  s.title,
  s.description,
  s.kind,
  s.schema,
  s.settings,
  s.banner_path,
  s.event_starts_at,
  s.event_ends_at,
  s.event_all_day,
  s.event_timezone,
  s.event_location_label,
  s.event_address,
  s.event_lat,
  s.event_lng,
  s.event_organiser,
  s.event_details,
  s.purpose,
  s.legal_basis,
  s.retention_days,
  s.recipients,
  s.require_consent,
  s.dedup_field,
  s.opens_at,
  s.closes_at,
  s.published_at,
  coalesce(rc.live_count, 0) as response_count,
  (s.response_limit is not null and coalesce(rc.live_count, 0) >= s.response_limit) as is_full
from public.surveys s
join public.organisations o on o.id = s.organisation_id
left join (
  select r.survey_id, count(*) as live_count
  from public.survey_responses r
  where r.deleted_at is null
  group by r.survey_id
) rc on rc.survey_id = s.id
where s.deleted_at is null
  and s.status = 'published'
  and o.is_active
  and (s.opens_at is null or s.opens_at <= now())
  and (s.closes_at is null or s.closes_at > now());

comment on view public.public_surveys is
  'Seul accès public aux sondages : colonnes publiques uniquement, sondages publiés, organisation active, fenêtre ouverte. Compteurs hors réponses supprimées.';

grant select on public.public_surveys to anon, authenticated;

-- ----------------------------------------------------------------------------
drop view if exists public.survey_stats;
create view public.survey_stats
with (security_invoker = true) as
select
  s.id                as survey_id,
  s.organisation_id,
  count(r.id) filter (where r.deleted_at is null)                          as response_count,
  count(r.id) filter (where r.deleted_at is null and r.consent_given)      as consented_count,
  count(r.id) filter (where r.deleted_at is not null)                      as deleted_count,
  max(r.submitted_at) filter (where r.deleted_at is null)                   as last_response_at,
  min(r.submitted_at) filter (where r.deleted_at is null)                   as first_response_at,
  count(r.id) filter (
    where r.deleted_at is null and r.submitted_at >= now() - interval '7 days'
  )                                                                        as responses_last_7_days
from public.surveys s
left join public.survey_responses r on r.survey_id = s.id
where s.deleted_at is null
group by s.id, s.organisation_id;

comment on view public.survey_stats is
  'Statistiques par sondage, soumises au RLS de l''appelant. Tous les agrégats excluent les réponses soft-deleted.';

grant select on public.survey_stats to authenticated;
