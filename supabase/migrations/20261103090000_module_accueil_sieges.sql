-- ============================================================================
-- Module « Accueil » — une arrivée par PERSONNE, plus par inscription
-- ============================================================================
--
-- Le lot 2 attachait l'arrivée à la réponse, avec un effectif à côté. Une
-- inscription « Jean Martin, accompagné » était donc UNE ligne valant deux
-- personnes, et Jacqueline Martin n'existait nulle part — alors qu'elle
-- franchit la porte, mange, et compte pour la sécurité.
--
-- Le siège entre donc dans l'IDENTITÉ d'une arrivée. Ce n'est pas un détail
-- d'affichage qu'on aurait pu garder côté écran : deux personnes d'une même
-- inscription arrivent souvent à vingt minutes d'écart, et l'une peut venir
-- sans l'autre. Un compteur « 2 sur 3 arrivés » n'aurait pas su dire lesquels,
-- ni résister à deux postes qui pointent en même temps.
--
-- `people_in` DISPARAÎT, des deux tables. Il existait parce qu'une ligne
-- pouvait valoir plusieurs personnes et qu'il fallait pouvoir corriger ce
-- nombre à l'entrée. Avec une ligne par personne, l'effectif entré EST le
-- nombre de sièges pointés : garder la colonne laisserait un chiffre que
-- quelqu'un finirait par additionner au compte réel. Toute la mécanique
-- d'« effectif non précisé » tombe avec elle.
--
-- Migration sans risque de données : la table ne contenait qu'une arrivée
-- d'essai au moment de l'écrire, et le défaut n'est apparu qu'en répétition.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. L'état : clé (réponse, siège)
-- ----------------------------------------------------------------------------

alter table public.event_checkins
  add column if not exists seat smallint not null default 0;

alter table public.event_checkins
  drop constraint if exists event_checkins_seat_range;
alter table public.event_checkins
  add constraint event_checkins_seat_range check (seat >= 0 and seat <= 998);

-- Le siège 0 est TOUJOURS la personne qui s'est inscrite. Numéroter autrement
-- ferait dépendre l'identité d'une arrivée de l'ordre d'affichage, lequel
-- change avec le tri et la recherche.
comment on column public.event_checkins.seat is
  'Rang de la personne dans son inscription. 0 = la personne inscrite, 1..n = ses accompagnants.';

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.event_checkins'::regclass
       and contype = 'p'
       and conname = 'event_checkins_pkey'
       and pg_get_constraintdef(oid) = 'PRIMARY KEY (response_id)'
  ) then
    alter table public.event_checkins drop constraint event_checkins_pkey;
    alter table public.event_checkins
      add constraint event_checkins_pkey primary key (response_id, seat);
  end if;
end $$;

alter table public.event_checkins drop column if exists people_in;

alter table public.event_checkins
  drop constraint if exists event_checkins_people_requires_arrival;

-- ----------------------------------------------------------------------------
-- 2. Le journal suit, en ajout seul
-- ----------------------------------------------------------------------------

alter table public.event_checkin_log
  add column if not exists seat smallint not null default 0;

alter table public.event_checkin_log drop column if exists people_in;

comment on column public.event_checkin_log.seat is
  'Siège pointé. Le journal dit qui a pointé QUELLE personne, pas seulement quelle inscription.';

-- ----------------------------------------------------------------------------
-- 3. `set_checkin` prend le siège
--
-- La signature CHANGE : on remplace, on ne surcharge pas. Une surcharge ferait
-- treize fonctions exposées là où le test d'exposition en fige douze, et
-- laisserait surtout l'ancienne porte ouverte — celle qui écrit sans siège,
-- donc toujours sur le siège 0.
-- ----------------------------------------------------------------------------

drop function if exists public.set_checkin(uuid, boolean, uuid, integer, integer);

create or replace function public.set_checkin(
  p_response_id uuid,
  p_seat integer,
  p_arrived boolean,
  p_op_id uuid,
  p_expected_version integer
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
  v_row public.event_checkins;
  v_seat smallint;
begin
  if p_op_id is null then
    raise exception 'Identifiant d''opération requis' using errcode = '22023';
  end if;
  if p_arrived is null then
    raise exception 'État d''arrivée requis' using errcode = '22023';
  end if;
  if p_seat is null or p_seat < 0 or p_seat > 998 then
    raise exception 'Siège invalide' using errcode = '22023';
  end if;
  v_seat := p_seat::smallint;

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
    select * into v_row
      from public.event_checkins
     where response_id = p_response_id and seat = v_seat;
    return jsonb_build_object(
      'response_id', p_response_id,
      'seat', v_seat,
      'arrived_at', v_row.arrived_at,
      'version', coalesce(v_row.version, 0),
      'by_profile', v_row.by_profile,
      'replayed', true
    );
  end if;

  select * into v_current
    from public.event_checkins
   where response_id = p_response_id and seat = v_seat;

  -- Pas de ligne = version 0. Une première arrivée s'annonce donc avec 0, ce
  -- qui dit bien ce qu'elle croit : « personne n'y a touché ». La version est
  -- par SIÈGE : pointer l'accompagnant ne doit pas périmer la ligne de l'hôte.
  if p_expected_version is not null
     and p_expected_version is distinct from coalesce(v_current.version, 0)
  then
    raise exception 'Cette ligne a changé entre-temps' using errcode = 'PT409';
  end if;

  if p_arrived then
    -- Une arrivée déjà enregistrée garde son heure : repointer quelqu'un ne
    -- doit pas le faire arriver une seconde fois, plus tard.
    v_arrived_at := coalesce(v_current.arrived_at, now());
  else
    v_arrived_at := null;
  end if;

  insert into public.event_checkins as c (
    response_id, seat, survey_id, organisation_id,
    arrived_at, by_profile, version, updated_at
  )
  values (
    p_response_id, v_seat, v_response.survey_id, v_response.organisation_id,
    v_arrived_at, auth.uid(), 1, now()
  )
  on conflict (response_id, seat) do update
     set arrived_at = excluded.arrived_at,
         by_profile = excluded.by_profile,
         version    = c.version + 1,
         updated_at = now()
  returning * into v_row;

  insert into public.event_checkin_log (
    op_id, response_id, seat, survey_id, organisation_id,
    by_profile, arrived, source
  )
  values (
    p_op_id, p_response_id, v_seat, v_response.survey_id, v_response.organisation_id,
    auth.uid(), p_arrived, case when v_desk then 'desk' else 'admin' end
  );

  return jsonb_build_object(
    'response_id', v_row.response_id,
    'seat', v_row.seat,
    'arrived_at', v_row.arrived_at,
    'version', v_row.version,
    'by_profile', v_row.by_profile,
    'replayed', false
  );
end;
$$;

comment on function public.set_checkin(uuid, integer, boolean, uuid, integer) is
  'Pointe ou dé-pointe UNE personne. Idempotente sur op_id, refuse une version périmée, écrit l''état ET le journal dans la même transaction.';

revoke all on function public.set_checkin(uuid, integer, boolean, uuid, integer)
  from public, anon;
grant execute on function public.set_checkin(uuid, integer, boolean, uuid, integer)
  to authenticated;
