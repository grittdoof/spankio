-- ============================================================================
-- Module « Accueil », lot 2 — les faits d'arrivée.
--
-- L'arrivée est un fait NOUVEAU, jamais une réécriture. `survey_responses.data`
-- est immuable par doctrine : `consent_text` prouve ce qui a été affiché à
-- l'invité et `submitted_at` date son acte. Y ranger un pointage ferait d'un
-- geste d'hôtesse une modification de preuve, et le trigger d'immuabilité le
-- refuserait de toute façon. L'arrivée vit donc à part.
--
-- Deux tables, et c'est délibéré :
--
--  * `event_checkins` porte l'ÉTAT courant, une ligne par réponse touchée.
--    C'est ce qu'un téléphone relit pendant un afflux : un index, aucune
--    agrégation.
--  * `event_checkin_log` porte le JOURNAL, en ajout seul. C'est lui qui répond
--    à « qui a pointé Mme X, à quelle heure, et qui l'a dé-pointée ensuite ».
--
-- Les deux sont écrites par la MÊME fonction dans la MÊME transaction : elles
-- ne peuvent pas diverger. Dériver l'état du journal à chaque lecture aurait
-- été plus pur et plus lent, au pire moment.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Le couple référençable, pour la même raison qu'au lot 1
--
-- La cohérence entre une ligne de pointage et la réponse qu'elle pointe doit
-- être STRUCTURELLE, pas déclarative : une policy ne protège que le chemin
-- qu'elle garde. `id` étant déjà clé primaire, cette unicité ne contraint
-- rien — elle rend référençable un triplet qui ne l'était pas.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'survey_responses_id_survey_org_uniq') then
    alter table public.survey_responses
      add constraint survey_responses_id_survey_org_uniq unique (id, survey_id, organisation_id);
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. L'état
--
-- Une ligne n'existe QUE pour une réponse qu'on a touchée. Pas de ligne =
-- pas encore arrivé, version 0. Pré-remplir une ligne par invité obligerait à
-- la maintenir quand un invité s'inscrit en cours de soirée, pour une
-- information que l'absence dit déjà.
-- ----------------------------------------------------------------------------
create table if not exists public.event_checkins (
  response_id uuid primary key,
  survey_id uuid not null,
  organisation_id uuid not null references public.organisations (id) on delete cascade,

  -- `null` = pas arrivé. On ne stocke pas un booléen EN PLUS de l'heure :
  -- deux colonnes pour un même fait finissent toujours par se contredire.
  arrived_at timestamptz,

  -- Effectif RÉELLEMENT entré, qui n'est pas celui annoncé : « Mme X annoncée
  -- +2, arrive seule ». `null` = non précisé, ce qui n'est pas « zéro » — la
  -- plateforme n'invente pas un chiffre que personne n'a donné.
  people_in integer check (people_in is null or (people_in >= 0 and people_in <= 999)),

  by_profile uuid references public.profiles (id) on delete set null,

  -- Concurrence optimiste. Deux hôtesses sur la même rangée : la première
  -- gagne, la seconde est refusée et voit l'état réel, plutôt qu'un
  -- dernier-arrivé-gagne où un dé-pointage tardif effacerait une arrivée.
  version integer not null default 0,
  updated_at timestamptz not null default now(),

  -- Un effectif entré sans arrivée n'a pas de sens.
  constraint event_checkins_people_requires_arrival
    check (people_in is null or arrived_at is not null),

  constraint event_checkins_response_fk
    foreign key (response_id, survey_id, organisation_id)
    references public.survey_responses (id, survey_id, organisation_id) on delete cascade
);

comment on table public.event_checkins is
  'État d''arrivée d''une réponse. Fait distinct de la réponse elle-même, qui reste immuable. Absence de ligne = pas arrivé.';
comment on column public.event_checkins.people_in is
  'Personnes réellement entrées. null = non précisé, jamais zéro : un chiffre que personne n''a donné ne s''invente pas.';
comment on column public.event_checkins.version is
  'Concurrence optimiste. Incrémentée à chaque transition ; une écriture qui annonce une version périmée est refusée.';

-- La lecture de la liste : tout l'état d'un événement, d'un coup.
create index if not exists event_checkins_survey_idx
  on public.event_checkins (survey_id);

-- Le rafraîchissement par delta : « ce qui a changé depuis mon curseur ».
create index if not exists event_checkins_survey_updated_idx
  on public.event_checkins (survey_id, updated_at desc);

alter table public.event_checkins enable row level security;

-- ----------------------------------------------------------------------------
-- 3. Le journal
--
-- En ajout seul : aucune policy d'UPDATE ni de DELETE, pour personne.
--
-- `op_id` est l'identifiant de l'opération, généré par le CLIENT, et son index
-- unique est le cœur de l'idempotence. Le cas qu'il traite n'est pas
-- théorique : le téléphone envoie, perd le réseau avant la réponse, et
-- réessaie. Sans lui, le second envoi re-bascule l'invité et l'efface.
-- ----------------------------------------------------------------------------
create table if not exists public.event_checkin_log (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null,
  response_id uuid not null,
  survey_id uuid not null,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  at timestamptz not null default now(),
  by_profile uuid references public.profiles (id) on delete set null,
  arrived boolean not null,
  people_in integer,
  -- Déduit des droits de l'appelant, jamais transmis : un poste d'accueil ne
  -- peut pas se déclarer « admin », ni l'inverse.
  source text not null check (source in ('desk', 'admin'))
);

comment on table public.event_checkin_log is
  'Journal des transitions d''arrivée, en ajout seul. Répond à « qui a pointé qui, quand », et porte l''idempotence par op_id.';

create unique index if not exists event_checkin_log_op_uniq
  on public.event_checkin_log (op_id);

create index if not exists event_checkin_log_survey_idx
  on public.event_checkin_log (survey_id, at);

alter table public.event_checkin_log enable row level security;

-- ----------------------------------------------------------------------------
-- 4. Lecture
--
-- Mêmes autorités que pour les réponses : l'organisation de plein exercice, et
-- le compte d'accueil pour le seul événement qu'il tient.
-- ----------------------------------------------------------------------------
grant select on public.event_checkins to authenticated;
grant select on public.event_checkin_log to authenticated;

drop policy if exists event_checkins_select on public.event_checkins;
create policy event_checkins_select on public.event_checkins
  for select to authenticated
  using (
    app.is_super_admin()
    or (
      app.is_active_member()
      and organisation_id = app.my_org_id()
      and app.can_use_module('checkin')
    )
    or (app.can_use_module('checkin') and app.can_staff_survey(survey_id))
  );

drop policy if exists event_checkin_log_select on public.event_checkin_log;
create policy event_checkin_log_select on public.event_checkin_log
  for select to authenticated
  using (
    app.is_super_admin()
    or (
      app.is_active_member()
      and organisation_id = app.my_org_id()
      and app.can_use_module('checkin')
    )
    or (app.can_use_module('checkin') and app.can_staff_survey(survey_id))
  );

-- AUCUNE policy d'écriture, pour personne, sur ni l'une ni l'autre : tout
-- passe par `public.set_checkin`. Une policy d'UPDATE sur `event_checkins`
-- ouvrirait le chemin à tout appel direct — y compris à un défaut futur — et
-- rendrait l'idempotence contournable, puisqu'un UPDATE direct n'écrit pas le
-- journal. C'est le raisonnement déjà posé en R11.

-- ----------------------------------------------------------------------------
-- 5. La porte
--
-- Dixième fonction exposée par PostgREST, et l'ajout est assumé : elle
-- remplace une écriture directe, elle revérifie elle-même les droits de
-- l'appelant, et elle est la seule à pouvoir tenir ensemble l'état, le journal
-- et l'idempotence.
--
-- Elle renvoie l'état ÉCRIT, pas un booléen : l'écran affiche ce que la base
-- contient, jamais ce qu'il espérait y mettre.
-- ----------------------------------------------------------------------------
create or replace function public.set_checkin(
  p_response_id uuid,
  p_arrived boolean,
  p_op_id uuid,
  p_expected_version integer,
  p_people_in integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response public.survey_responses;
  v_current public.event_checkins;
  v_desk boolean;
  v_admin boolean;
  v_arrived_at timestamptz;
  v_people integer;
  v_row public.event_checkins;
begin
  if p_op_id is null then
    raise exception 'Identifiant d''opération requis' using errcode = '22023';
  end if;
  if p_arrived is null then
    raise exception 'État d''arrivée requis' using errcode = '22023';
  end if;

  -- Une réponse supprimée logiquement n'existe plus pour l'appelant : `404`
  -- côté route, jamais un message qui confirmerait son existence.
  select * into v_response
    from public.survey_responses
   where id = p_response_id and deleted_at is null;

  if v_response.id is null then
    raise exception 'Réponse introuvable' using errcode = 'PT404';
  end if;

  -- Deux autorités, et l'ordre compte pour la SOURCE journalisée : quelqu'un
  -- qui tient la porte pointe depuis la porte, même s'il est aussi
  -- administrateur.
  v_desk := app.can_use_module('checkin') and app.can_staff_survey(v_response.survey_id);
  v_admin := app.is_super_admin()
             or (
               app.can_write_surveys()
               and v_response.organisation_id = app.my_org_id()
               and app.can_use_module('checkin')
             );

  if not (v_desk or v_admin) then
    raise exception 'Pointage refusé' using errcode = '42501';
  end if;

  -- IDEMPOTENCE. Une opération déjà journalisée ne rejoue pas : on rend
  -- l'état courant, sans erreur. C'est un réessai après un réseau coupé, pas
  -- une faute — le traiter comme une faute ferait clignoter un message rouge
  -- sur un pointage parfaitement réussi.
  if exists (select 1 from public.event_checkin_log where op_id = p_op_id) then
    select * into v_row from public.event_checkins where response_id = p_response_id;
    return jsonb_build_object(
      'response_id', p_response_id,
      'arrived_at', v_row.arrived_at,
      'people_in', v_row.people_in,
      'version', coalesce(v_row.version, 0),
      'by_profile', v_row.by_profile,
      'replayed', true
    );
  end if;

  select * into v_current from public.event_checkins where response_id = p_response_id;

  -- Pas de ligne = version 0. Une première arrivée s'annonce donc avec 0, ce
  -- qui dit bien ce qu'elle croit : « personne n'y a touché ».
  if p_expected_version is not null
     and p_expected_version is distinct from coalesce(v_current.version, 0)
  then
    raise exception 'Cette ligne a changé entre-temps' using errcode = 'PT409';
  end if;

  if p_arrived then
    -- Une arrivée déjà enregistrée garde son heure : repointer quelqu'un ne
    -- doit pas le faire arriver une seconde fois, plus tard.
    v_arrived_at := coalesce(v_current.arrived_at, now());
    v_people := p_people_in;
  else
    -- Un dé-pointage efface l'effectif avec l'arrivée : un nombre d'entrants
    -- sans entrée ne veut rien dire, et la contrainte le refuserait.
    v_arrived_at := null;
    v_people := null;
  end if;

  insert into public.event_checkins as c (
    response_id, survey_id, organisation_id,
    arrived_at, people_in, by_profile, version, updated_at
  )
  values (
    p_response_id, v_response.survey_id, v_response.organisation_id,
    v_arrived_at, v_people, auth.uid(), 1, now()
  )
  on conflict (response_id) do update
     set arrived_at = excluded.arrived_at,
         people_in  = excluded.people_in,
         by_profile = excluded.by_profile,
         version    = c.version + 1,
         updated_at = now()
  returning * into v_row;

  insert into public.event_checkin_log (
    op_id, response_id, survey_id, organisation_id,
    by_profile, arrived, people_in, source
  )
  values (
    p_op_id, p_response_id, v_response.survey_id, v_response.organisation_id,
    auth.uid(), p_arrived, v_people, case when v_desk then 'desk' else 'admin' end
  );

  return jsonb_build_object(
    'response_id', v_row.response_id,
    'arrived_at', v_row.arrived_at,
    'people_in', v_row.people_in,
    'version', v_row.version,
    'by_profile', v_row.by_profile,
    'replayed', false
  );
end;
$$;

comment on function public.set_checkin(uuid, boolean, uuid, integer, integer) is
  'Pointe ou dé-pointe une arrivée. Idempotente sur op_id, refuse une version périmée, écrit l''état ET le journal dans la même transaction.';

revoke all on function public.set_checkin(uuid, boolean, uuid, integer, integer)
  from public, anon;
grant execute on function public.set_checkin(uuid, boolean, uuid, integer, integer)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Une correction de réponse NE PERD PAS son arrivée
--
-- Défaut qui serait apparu au premier essai réel, et à l'endroit le plus
-- gênant. Corriger une réponse n'est pas une modification : c'est l'originale
-- passée en suppression logique PLUS une copie portant un nouvel identifiant.
-- L'arrivée, elle, est accrochée à l'identifiant. Un organisateur qui corrige
-- une faute dans un nom ferait donc réapparaître à l'accueil, comme absent,
-- quelqu'un qui est dans la salle depuis une heure.
--
-- Le pointage SUIT donc la copie. On ne réécrit rien : la ligne d'état change
-- de réponse, le journal garde l'ancien identifiant pour les transitions déjà
-- enregistrées — c'est bien sous l'ancienne réponse qu'elles ont eu lieu.
--
-- La fonction est réécrite à l'identique pour le reste. Seul le bloc final est
-- nouveau, et il est placé APRÈS l'insertion de la copie : la cible de la clé
-- étrangère doit exister.
-- ----------------------------------------------------------------------------
create or replace function public.correct_survey_response(
  p_response_id uuid,
  p_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.survey_responses;
  v_new_id uuid;
begin
  if p_data is null or jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'Données de correction invalides' using errcode = '22023';
  end if;

  select * into v_old
    from public.survey_responses
   where id = p_response_id
     and deleted_at is null;

  if v_old.id is null then
    raise exception 'Réponse introuvable' using errcode = 'PT404';
  end if;

  if not (
    app.is_super_admin()
    or (
      app.can_write_surveys()
      and v_old.organisation_id = app.my_org_id()
      and app.can_use_module(app.survey_module_key(v_old.survey_id))
    )
  ) then
    raise exception 'Correction refusée' using errcode = '42501';
  end if;

  update public.survey_responses
     set deleted_at = now()
   where id = v_old.id;

  insert into public.survey_responses (
    survey_id, organisation_id, data, consent_given, consent_text,
    dedup_key, submitted_at, corrects_id
  )
  values (
    v_old.survey_id, v_old.organisation_id, p_data, v_old.consent_given,
    v_old.consent_text, v_old.dedup_key, v_old.submitted_at, v_old.id
  )
  returning id into v_new_id;

  -- L'arrivée suit la correction. Sans ce report, une personne déjà dans la
  -- salle redeviendrait « absente » à l'écran d'accueil parce qu'on a corrigé
  -- l'orthographe de son nom.
  update public.event_checkins
     set response_id = v_new_id,
         updated_at = now()
   where response_id = v_old.id;

  perform app.write_audit(
    'survey_response_corrected',
    v_old.organisation_id,
    'survey_response',
    v_new_id::text,
    jsonb_build_object(
      'survey_id', v_old.survey_id,
      'corrects_id', v_old.id,
      'fields', (select count(*) from jsonb_object_keys(p_data))
    )
  );

  return v_new_id;
end;
$$;
