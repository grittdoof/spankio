-- ============================================================================
-- Réponses aux sondages.
--
-- MINIMISATION ASSUMÉE : cette table ne stocke NI adresse IP (même hachée), NI
-- user-agent, NI identifiant de session. C'est ce qui permet à l'interface et à
-- la politique de confidentialité d'affirmer que les réponses sont anonymes
-- sans mentir. La limitation de débit s'appuie sur un store externe (KV) où
-- l'IP est hachée et expire ; elle n'atterrit jamais ici.
--
-- Suppression : `deleted_at` (soft-delete). TOUT agrégat, compteur ou vue doit
-- exclure les lignes supprimées.
-- ============================================================================

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  -- Dénormalisé volontairement : le RLS filtre sur l'organisation sans jointure.
  organisation_id uuid not null references public.organisations (id) on delete cascade,

  data jsonb not null default '{}'::jsonb
    constraint survey_responses_data_is_object check (jsonb_typeof(data) = 'object'),

  -- Preuve de consentement : la valeur ET le texte exact affiché au répondant.
  consent_given boolean not null default false,
  consent_text text,

  -- Clé anti-doublon dérivée du champ désigné par surveys.dedup_field.
  dedup_key text,

  submitted_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Date d'expiration calculée à l'insertion depuis surveys.retention_days.
  purge_after timestamptz,

  constraint survey_responses_consent_snapshot check (
    consent_given = false or consent_text is not null
  )
);

comment on table public.survey_responses is
  'Réponses. Aucune IP ni user-agent : la minimisation annoncée est réelle. Soft-delete via deleted_at.';
comment on column public.survey_responses.consent_text is
  'Snapshot du texte de consentement affiché : preuve auditable, indépendante des modifications ultérieures du sondage.';

-- Anti-doublon RÉEL : contrainte d'unicité, pas une colonne décorative.
create unique index if not exists survey_responses_dedup_uniq
  on public.survey_responses (survey_id, dedup_key)
  where dedup_key is not null and deleted_at is null;

create index if not exists survey_responses_survey_live_idx
  on public.survey_responses (survey_id, submitted_at desc)
  where deleted_at is null;

create index if not exists survey_responses_org_live_idx
  on public.survey_responses (organisation_id, submitted_at desc)
  where deleted_at is null;

create index if not exists survey_responses_purge_idx
  on public.survey_responses (purge_after)
  where deleted_at is null and purge_after is not null;

alter table public.survey_responses enable row level security;
