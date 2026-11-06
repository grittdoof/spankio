-- ============================================================================
-- Module « Accueil » — l'invité de dernière minute, et le cadeau au départ
-- ============================================================================
--
-- Deux besoins nés de la préparation d'une vraie soirée.
--
-- 1. **Quelqu'un se présente sans s'être inscrit.** Il faut pouvoir l'ajouter
--    à la porte, le compter dans la salle, et le retrouver dans le rapport.
--
-- 2. **Un cadeau est remis à la sortie, par personne.** Il faut savoir qui l'a
--    reçu — deux personnes d'une même inscription peuvent partir à une heure
--    d'écart, et un couple ne reçoit pas forcément un seul cadeau.
--
-- Décision structurante, et elle mérite d'être écrite parce que l'autre voie
-- paraissait plus « propre » : **l'invité de dernière minute est une
-- INSCRIPTION, écrite par la porte et marquée comme telle** (`origin = 'desk'`),
-- pas une table parallèle.
--
-- Une table à part aurait obligé à dédoubler TOUT ce qui compte des personnes :
-- l'état d'arrivée (dont la clé étrangère composite vise `survey_responses`),
-- le journal, le rapport, l'export, le listing, la recherche, le cadeau. Cinq
-- lectures qui auraient divergé au premier ajustement — c'est exactement le
-- défaut que la règle « une seule implémentation » existe pour empêcher.
--
-- Ce qui distingue honnêtement cette inscription des autres :
--  - `origin = 'desk'`, immuable comme le reste de la ligne, et que la
--    correction d'une réponse PRÉSERVE ;
--  - aucun consentement prétendu : `consent_given = false`, `consent_text`
--    nul. La personne n'a rien lu ni coché — l'écrire serait fabriquer une
--    preuve ;
--  - aucune réponse inventée : seules les questions qui NOMMENT et PRÉCISENT
--    une rangée sont remplies. La question de présence reste vide, donc
--    « sans réponse » — et c'est la vérité : cette personne n'a rien annoncé.
--    Le rapport la range d'ailleurs parmi les « venus sans l'avoir annoncé ».
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. L'origine d'une inscription
-- ----------------------------------------------------------------------------

alter table public.survey_responses
  add column if not exists origin text not null default 'form';

alter table public.survey_responses
  drop constraint if exists survey_responses_origin_check;
alter table public.survey_responses
  add constraint survey_responses_origin_check check (origin in ('form', 'desk'));

comment on column public.survey_responses.origin is
  'form = soumise par le formulaire public ; desk = ajoutée à l''entrée par le poste d''accueil, sans consentement prétendu.';

-- L'origine suit une correction. Sans cela, corriger l'orthographe du nom d'un
-- invité ajouté à la porte en ferait un inscrit du formulaire — et le rapport
-- le compterait parmi ceux qui avaient annoncé leur venue. Porté par le
-- TRIGGER plutôt que par `correct_survey_response` : le moteur le garantit
-- quel que soit le chemin qui insère une correction.
create or replace function app.guard_response_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_retention integer;
  v_origin text;
begin
  select s.organisation_id, s.retention_days into v_org, v_retention
  from public.surveys s where s.id = new.survey_id;

  if v_org is null then
    raise exception 'Sondage introuvable' using errcode = '23503';
  end if;

  new.organisation_id := v_org;

  if new.purge_after is null and v_retention is not null then
    new.purge_after := new.submitted_at + make_interval(days => v_retention);
  end if;

  if new.corrects_id is not null then
    select r.origin into v_origin
      from public.survey_responses r
     where r.id = new.corrects_id;
    if v_origin is not null then
      new.origin := v_origin;
    end if;
  end if;

  return new;
end;
$$;

-- L'origine est immuable comme le reste : une inscription du formulaire ne
-- peut pas être requalifiée en ajout de porte, ni l'inverse.
create or replace function app.guard_response_update()
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
     or new.origin is distinct from old.origin
  then
    raise exception 'Une réponse est immuable : seule sa suppression (deleted_at) peut évoluer'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Le cadeau, par personne
-- ----------------------------------------------------------------------------

alter table public.event_checkins
  add column if not exists gift_at timestamptz;

comment on column public.event_checkins.gift_at is
  'Remise du cadeau au départ, par personne. Indépendante de l''arrivée : quelqu''un qu''on a oublié de pointer à l''entrée peut repartir avec son cadeau.';

alter table public.event_checkin_log
  add column if not exists action text not null default 'arrival';

alter table public.event_checkin_log
  drop constraint if exists event_checkin_log_action_check;
alter table public.event_checkin_log
  add constraint event_checkin_log_action_check
  check (action in ('arrival', 'gift', 'walkin'));

comment on column public.event_checkin_log.action is
  'arrival = arrivée, gift = cadeau, walkin = personne ajoutée à l''entrée (et pointée du même geste). La colonne arrived porte la VALEUR du geste.';

-- ----------------------------------------------------------------------------
-- 3. `set_checkin` sait aussi remettre un cadeau
--
-- Un paramètre de plus, AVEC une valeur par défaut. La signature à cinq
-- arguments disparaît — on remplace, on ne surcharge pas, pour ne pas laisser
-- deux portes ouvertes — mais un appel nommé à cinq arguments continue de
-- résoudre vers la nouvelle fonction. Le code déjà en production pointe donc
-- sans interruption entre l'application de cette migration et le déploiement
-- qui l'exploite.
--
-- `p_arrived` garde son nom pour la même raison : il porte désormais la
-- VALEUR du geste — arrivé, ou cadeau remis.
-- ----------------------------------------------------------------------------

drop function if exists public.set_checkin(uuid, integer, boolean, uuid, integer);

create or replace function public.set_checkin(
  p_response_id uuid,
  p_seat integer,
  p_arrived boolean,
  p_op_id uuid,
  p_expected_version integer,
  p_kind text default 'arrival'
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
  v_gift_at timestamptz;
  v_row public.event_checkins;
  v_seat smallint;
begin
  if p_op_id is null then
    raise exception 'Identifiant d''opération requis' using errcode = '22023';
  end if;
  if p_arrived is null then
    raise exception 'Valeur du geste requise' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('arrival', 'gift') then
    raise exception 'Geste inconnu' using errcode = '22023';
  end if;
  if p_seat is null or p_seat < 0 or p_seat > 998 then
    raise exception 'Siège invalide' using errcode = '22023';
  end if;
  v_seat := p_seat::smallint;

  select * into v_response
    from public.survey_responses
   where id = p_response_id and deleted_at is null;

  if v_response.id is null then
    raise exception 'Réponse introuvable' using errcode = 'PT404';
  end if;

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

  -- IDEMPOTENCE : un réessai rend l'état courant, sans erreur.
  if exists (select 1 from public.event_checkin_log where op_id = p_op_id) then
    select * into v_row
      from public.event_checkins
     where response_id = p_response_id and seat = v_seat;
    return jsonb_build_object(
      'response_id', p_response_id,
      'seat', v_seat,
      'arrived_at', v_row.arrived_at,
      'gift_at', v_row.gift_at,
      'version', coalesce(v_row.version, 0),
      'by_profile', v_row.by_profile,
      'replayed', true
    );
  end if;

  select * into v_current
    from public.event_checkins
   where response_id = p_response_id and seat = v_seat;

  -- Une seule version par personne, pour les DEUX gestes : une hôtesse qui
  -- remet un cadeau pendant qu'une autre dé-pointe la même personne doit
  -- l'apprendre, comme pour deux arrivées concurrentes.
  if p_expected_version is not null
     and p_expected_version is distinct from coalesce(v_current.version, 0)
  then
    raise exception 'Cette ligne a changé entre-temps' using errcode = 'PT409';
  end if;

  -- Chaque geste ne touche QUE sa colonne. Un horodatage déjà posé est gardé :
  -- repointer quelqu'un ne le fait pas arriver une seconde fois, plus tard.
  if p_kind = 'arrival' then
    v_arrived_at := case when p_arrived then coalesce(v_current.arrived_at, now()) end;
    v_gift_at := v_current.gift_at;
  else
    v_arrived_at := v_current.arrived_at;
    v_gift_at := case when p_arrived then coalesce(v_current.gift_at, now()) end;
  end if;

  insert into public.event_checkins as c (
    response_id, seat, survey_id, organisation_id,
    arrived_at, gift_at, by_profile, version, updated_at
  )
  values (
    p_response_id, v_seat, v_response.survey_id, v_response.organisation_id,
    v_arrived_at, v_gift_at, auth.uid(), 1, now()
  )
  on conflict (response_id, seat) do update
     set arrived_at = excluded.arrived_at,
         gift_at    = excluded.gift_at,
         by_profile = excluded.by_profile,
         version    = c.version + 1,
         updated_at = now()
  returning * into v_row;

  insert into public.event_checkin_log (
    op_id, response_id, seat, survey_id, organisation_id,
    by_profile, arrived, action, source
  )
  values (
    p_op_id, p_response_id, v_seat, v_response.survey_id, v_response.organisation_id,
    auth.uid(), p_arrived, p_kind, case when v_desk then 'desk' else 'admin' end
  );

  return jsonb_build_object(
    'response_id', v_row.response_id,
    'seat', v_row.seat,
    'arrived_at', v_row.arrived_at,
    'gift_at', v_row.gift_at,
    'version', v_row.version,
    'by_profile', v_row.by_profile,
    'replayed', false
  );
end;
$$;

comment on function public.set_checkin(uuid, integer, boolean, uuid, integer, text) is
  'Pointe l''arrivée d''UNE personne, ou la remise de son cadeau. Idempotente sur op_id, refuse une version périmée, écrit l''état ET le journal dans la même transaction.';

revoke all on function public.set_checkin(uuid, integer, boolean, uuid, integer, text)
  from public, anon;
grant execute on function public.set_checkin(uuid, integer, boolean, uuid, integer, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 4. `add_walkin` : ajouter quelqu'un à la porte, et le pointer du même geste
--
-- Treizième fonction exposée. Elle remplace une insertion directe dans
-- `survey_responses`, qu'aucune policy n'autorise et ne doit autoriser : la
-- soumission publique passe déjà par sa propre porte, et ouvrir l'insertion
-- aux comptes d'accueil leur permettrait d'écrire n'importe quoi dans `data`.
--
-- Trois bornes :
--  - les MÊMES autorités que `set_checkin` — qui peut pointer peut ajouter ;
--  - le contenu est borné ici AUSSI, pas seulement en TypeScript : clés
--    existant au schéma, valeurs textuelles courtes, au plus six — ce chemin
--    ne doit pas devenir une manière de ranger un document dans `data` ;
--  - IDEMPOTENTE sur `op_id`, comme le pointage. Le téléphone envoie, perd le
--    réseau, réessaie : sans cela, chaque réessai ajouterait un homonyme.
-- ----------------------------------------------------------------------------

create or replace function public.add_walkin(
  p_survey_id uuid,
  p_data jsonb,
  p_op_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_survey public.surveys;
  v_desk boolean;
  v_admin boolean;
  v_key text;
  v_value jsonb;
  v_filled integer := 0;
  v_response public.survey_responses;
  v_row public.event_checkins;
  v_known uuid;
begin
  if p_op_id is null then
    raise exception 'Identifiant d''opération requis' using errcode = '22023';
  end if;

  select * into v_survey
    from public.surveys
   where id = p_survey_id and deleted_at is null;

  if v_survey.id is null then
    raise exception 'Événement introuvable' using errcode = 'PT404';
  end if;

  v_desk := app.can_use_module('checkin') and app.can_staff_survey(v_survey.id);
  v_admin := app.is_super_admin()
             or (
               app.can_write_surveys()
               and v_survey.organisation_id = app.my_org_id()
               and app.can_use_module('checkin')
             );

  if not (v_desk or v_admin) then
    -- Même refus qu'un événement masqué : confirmer son existence à qui n'y
    -- a pas droit en dirait déjà trop.
    raise exception 'Événement introuvable' using errcode = 'PT404';
  end if;

  -- IDEMPOTENCE, avant tout contrôle de contenu : un réessai rend la personne
  -- déjà ajoutée, sans erreur et sans doublon.
  select l.response_id into v_known
    from public.event_checkin_log l
   where l.op_id = p_op_id;

  if v_known is not null then
    select * into v_response from public.survey_responses where id = v_known;
    select * into v_row
      from public.event_checkins
     where response_id = v_known and seat = 0;
    return jsonb_build_object(
      'response_id', v_known,
      'submitted_at', v_response.submitted_at,
      'data', v_response.data,
      'seat', 0,
      'arrived_at', v_row.arrived_at,
      'gift_at', v_row.gift_at,
      'version', coalesce(v_row.version, 0),
      'replayed', true
    );
  end if;

  if p_data is null or jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'Données invalides' using errcode = '22023';
  end if;

  if (select count(*) from jsonb_object_keys(p_data)) > 6 then
    raise exception 'Trop de champs' using errcode = '22023';
  end if;

  for v_key, v_value in select key, value from jsonb_each(p_data) loop
    if jsonb_typeof(v_value) is distinct from 'string'
       or length(v_value #>> '{}') > 200
    then
      raise exception 'Valeur invalide' using errcode = '22023';
    end if;

    if not exists (
      select 1
        from jsonb_array_elements(coalesce(v_survey.schema -> 'steps', '[]'::jsonb)) as step,
             jsonb_array_elements(coalesce(step -> 'fields', '[]'::jsonb)) as field
       where field ->> 'id' = v_key
    ) then
      raise exception 'Question inconnue' using errcode = '22023';
    end if;

    if btrim(v_value #>> '{}') <> '' then
      v_filled := v_filled + 1;
    end if;
  end loop;

  -- Une rangée sans aucun nom ne se retrouverait pas dans la liste : on
  -- exige au moins une valeur, sans dire laquelle — la plateforme ne sait pas
  -- quelle question nomme l'invité, c'est le réglage de l'organisation.
  if v_filled = 0 then
    raise exception 'Au moins un champ doit être rempli' using errcode = '22023';
  end if;

  insert into public.survey_responses (
    survey_id, organisation_id, data, consent_given, consent_text,
    dedup_key, origin
  )
  values (
    v_survey.id, v_survey.organisation_id, p_data, false, null, null, 'desk'
  )
  returning * into v_response;

  insert into public.event_checkins (
    response_id, seat, survey_id, organisation_id,
    arrived_at, gift_at, by_profile, version, updated_at
  )
  values (
    v_response.id, 0, v_response.survey_id, v_response.organisation_id,
    now(), null, auth.uid(), 1, now()
  )
  returning * into v_row;

  insert into public.event_checkin_log (
    op_id, response_id, seat, survey_id, organisation_id,
    by_profile, arrived, action, source
  )
  values (
    p_op_id, v_response.id, 0, v_response.survey_id, v_response.organisation_id,
    auth.uid(), true, 'walkin', case when v_desk then 'desk' else 'admin' end
  );

  return jsonb_build_object(
    'response_id', v_response.id,
    'submitted_at', v_response.submitted_at,
    'data', v_response.data,
    'seat', 0,
    'arrived_at', v_row.arrived_at,
    'gift_at', v_row.gift_at,
    'version', v_row.version,
    'replayed', false
  );
end;
$$;

comment on function public.add_walkin(uuid, jsonb, uuid) is
  'Ajoute à l''entrée une personne non inscrite (origin = desk, sans consentement prétendu) et la pointe arrivée. Idempotente sur op_id.';

revoke all on function public.add_walkin(uuid, jsonb, uuid) from public, anon;
grant execute on function public.add_walkin(uuid, jsonb, uuid) to authenticated;
