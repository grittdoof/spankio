-- ============================================================================
-- Sondages. Le schéma des questions vit dans `schema` (jsonb) : créer un
-- nouveau type de sondage ne demande AUCUNE migration.
-- Les colonnes dédiées ne servent qu'à ce qui doit être requêtable, contraint
-- ou lisible par le RLS : appartenance, publication, RGPD, bloc événement.
-- ============================================================================

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  module_key text not null default 'core' references public.modules (key),

  slug text not null
    constraint surveys_slug_format
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?$'),
  title text not null
    constraint surveys_title_length check (char_length(title) between 2 and 200),
  description text
    constraint surveys_description_length
    check (description is null or char_length(description) <= 4000),

  kind public.survey_kind not null default 'survey',
  status public.survey_status not null default 'draft',

  -- Étapes, champs, options, conditions : tout le formulaire.
  schema jsonb not null default '{"steps": []}'::jsonb
    constraint surveys_schema_is_object check (jsonb_typeof(schema) = 'object'),
  -- Textes d'accueil, CTA, masquage des intros d'étapes, écran de remerciement…
  settings jsonb not null default '{}'::jsonb
    constraint surveys_settings_is_object check (jsonb_typeof(settings) = 'object'),

  -- Chemin dans le bucket public des bannières (jamais une URL externe).
  banner_path text,

  -- --- Bloc événement (module « event ») ------------------------------------
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  event_all_day boolean not null default false,
  event_timezone text not null default 'Europe/Paris',
  event_location_label text,
  event_address text,
  event_lat double precision
    constraint surveys_event_lat_range check (event_lat is null or event_lat between -90 and 90),
  event_lng double precision
    constraint surveys_event_lng_range check (event_lng is null or event_lng between -180 and 180),
  event_organiser text,
  event_details text,

  -- --- RGPD : décidé par l'organisation, jamais par la plateforme -----------
  purpose text
    constraint surveys_purpose_length check (purpose is null or char_length(purpose) <= 2000),
  legal_basis public.legal_basis,
  retention_days integer
    constraint surveys_retention_range
    check (retention_days is null or retention_days between 1 and 3650),
  recipients text
    constraint surveys_recipients_length check (recipients is null or char_length(recipients) <= 2000),
  require_consent boolean not null default true,

  -- --- Anti-doublon : identifiant du champ servant de clé d'unicité ---------
  -- Non nul ⇒ l'unicité est réellement imposée par un index (voir responses).
  dedup_field text,

  -- --- Fenêtre d'ouverture et plafond --------------------------------------
  opens_at timestamptz,
  closes_at timestamptz,
  response_limit integer
    constraint surveys_response_limit_positive
    check (response_limit is null or response_limit > 0),

  published_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint surveys_event_dates_ordered check (
    event_ends_at is null or event_starts_at is null or event_ends_at >= event_starts_at
  ),
  constraint surveys_window_ordered check (
    closes_at is null or opens_at is null or closes_at > opens_at
  ),
  -- Impossible de publier sans avoir renseigné l'information RGPD obligatoire.
  constraint surveys_published_requires_rgpd check (
    status <> 'published'
    or (purpose is not null and legal_basis is not null and retention_days is not null)
  ),
  -- Un événement publié a forcément une date de début (agenda, ICS, itinéraire).
  constraint surveys_published_event_has_date check (
    status <> 'published' or kind <> 'event' or event_starts_at is not null
  ),
  -- Coordonnées : les deux ou aucune.
  constraint surveys_event_coordinates_paired check (
    (event_lat is null) = (event_lng is null)
  )
);

comment on column public.surveys.schema is
  'Schéma du formulaire (étapes, champs, options, conditions). Validé côté serveur à chaque soumission.';
comment on column public.surveys.dedup_field is
  'Identifiant du champ utilisé comme clé anti-doublon. L''unicité est imposée par survey_responses_dedup_uniq.';

-- Unicité du slug par organisation, en ignorant les sondages supprimés.
create unique index if not exists surveys_org_slug_uniq
  on public.surveys (organisation_id, slug)
  where deleted_at is null;

create index if not exists surveys_org_idx
  on public.surveys (organisation_id, updated_at desc)
  where deleted_at is null;

create index if not exists surveys_published_idx
  on public.surveys (status, published_at desc)
  where deleted_at is null and status = 'published';

alter table public.surveys enable row level security;
