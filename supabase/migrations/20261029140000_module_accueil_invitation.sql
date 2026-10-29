-- ============================================================================
-- Module « Accueil », lot 4b — l'invitation à usage unique.
--
-- Le besoin : une personne engagée pour une soirée doit pouvoir tenir la porte
-- sans qu'un administrateur de la PLATEFORME intervienne, et sans
-- réinitialiser un mot de passe sur un parvis, sous la pluie, en 4G.
--
-- Ce que ce chemin ne fait PAS, et c'est délibéré : il ne crée aucun compte.
-- Créer un utilisateur exige le `service role`, dont les trois usages admis
-- sont le setup initial, le cron et les tâches de super-administration. L'y
-- ajouter pour un écran d'organisation aurait déplacé le `service role` dans
-- un chemin déclenché par un administrateur de tenant — exactement ce que
-- l'architecture RLS-first existe pour éviter.
--
-- La personne crée donc son compte elle-même, par le parcours d'inscription
-- ordinaire. L'invitation remplace la SUITE : le rattachement à
-- l'organisation, le rôle `host` et l'affectation à l'événement, qui
-- demandaient jusqu'ici une demande de rattachement validée par le
-- super-administrateur.
-- ============================================================================

create table if not exists public.checkin_invitations (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null,
  organisation_id uuid not null references public.organisations (id) on delete cascade,

  -- L'adresse À LAQUELLE l'invitation est destinée. Elle est comparée au
  -- courriel du JETON d'authentification, pas à `profiles.email` : la policy
  -- `profiles_update` autorise chacun à modifier sa propre ligne, et rien n'y
  -- interdit de changer son adresse. Comparer à `profiles.email` aurait donc
  -- laissé n'importe qui se faire passer pour l'invité.
  email text not null,

  -- Empreinte du jeton, jamais le jeton. Même raisonnement que `dedup_hash` :
  -- ce qui est en base ne doit pas suffire à exercer le droit qu'il protège.
  token_hash text not null,

  -- Une invitation est périssable PAR CONSTRUCTION. Un lien de rattachement
  -- qui vaudrait indéfiniment est un passe-partout vers une liste nominative.
  expires_at timestamptz not null,

  -- Date de fin à poser sur l'affectation créée. Distincte de l'expiration du
  -- lien : le lien se consomme la veille, l'accès s'arrête après la soirée.
  staff_expires_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid references public.profiles (id) on delete set null,

  constraint checkin_invitations_survey_fk
    foreign key (survey_id, organisation_id)
    references public.surveys (id, organisation_id) on delete cascade
);

comment on table public.checkin_invitations is
  'Invitation à usage unique vers un poste d''accueil. Remplace la demande de rattachement, jamais la création de compte.';
comment on column public.checkin_invitations.email is
  'Adresse destinataire. Comparée au courriel du JETON, jamais à profiles.email, que son propriétaire peut modifier.';
comment on column public.checkin_invitations.token_hash is
  'Empreinte SHA-256 du jeton. Le jeton en clair n''existe qu''une fois, à la création.';

create unique index if not exists checkin_invitations_token_uniq
  on public.checkin_invitations (token_hash);

create index if not exists checkin_invitations_survey_idx
  on public.checkin_invitations (survey_id, created_at desc);

alter table public.checkin_invitations enable row level security;

-- ----------------------------------------------------------------------------
-- Lecture et gestion : l'administrateur de l'organisation, et lui seul
--
-- Pas d'UPDATE, pour personne : consommer une invitation est le travail de la
-- porte ci-dessous, et une policy d'UPDATE permettrait de la marquer consommée
-- sans l'avoir été — ou l'inverse, de la rouvrir. Même raisonnement que pour
-- `event_checkins`.
--
-- L'éditeur est exclu, comme pour les affectations : inviter quelqu'un dans
-- l'organisation est un acte sur un COMPTE, c'est la frontière de
-- `profiles_update`.
-- ----------------------------------------------------------------------------
grant select, insert, delete on public.checkin_invitations to authenticated;

drop policy if exists checkin_invitations_select on public.checkin_invitations;
create policy checkin_invitations_select on public.checkin_invitations
  for select to authenticated
  using (
    app.is_super_admin()
    or (
      app.is_org_admin()
      and organisation_id = app.my_org_id()
      and app.can_use_module('checkin')
    )
  );

drop policy if exists checkin_invitations_insert on public.checkin_invitations;
create policy checkin_invitations_insert on public.checkin_invitations
  for insert to authenticated
  with check (
    app.is_super_admin()
    or (
      app.is_org_admin()
      and organisation_id = app.my_org_id()
      and app.can_use_module('checkin')
    )
  );

drop policy if exists checkin_invitations_delete on public.checkin_invitations;
create policy checkin_invitations_delete on public.checkin_invitations
  for delete to authenticated
  using (
    app.is_super_admin()
    or (
      app.is_org_admin()
      and organisation_id = app.my_org_id()
      and app.can_use_module('checkin')
    )
  );

-- ----------------------------------------------------------------------------
-- La porte — douzième fonction exposée
--
-- Elle fait trois choses qu'aucune policy ne peut faire ensemble : vérifier un
-- secret à usage unique, rattacher un profil, et poser une affectation.
--
-- Le point le plus délicat est le rattachement. `guard_profile_privileges`
-- refuse tout changement de rôle ou d'organisation qui ne vient ni d'un
-- super-administrateur, ni d'un administrateur de l'organisation, ni d'un
-- contexte serveur sans jeton. Or ici l'appelant est l'invité lui-même. On
-- neutralise donc le jeton LE TEMPS de cette écriture, et c'est précisément le
-- cas que l'échappement du trigger décrit : l'autorité n'est pas l'appelant,
-- c'est l'invitation — un secret à usage unique, posé par un administrateur de
-- l'organisation, qui désigne nommément l'adresse destinataire.
--
-- Trois bornes à cette autorité, sans lesquelles ce serait une escalade :
--   * elle ne s'applique qu'à un profil NON RATTACHÉ ;
--   * elle n'accorde que le rôle `host`, qui ne donne rien par lui-même ;
--   * elle est tracée à l'audit.
-- ----------------------------------------------------------------------------
create or replace function public.claim_checkin_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_hash text;
  v_invitation public.checkin_invitations;
  v_profile public.profiles;
  v_claims text;
begin
  if v_actor is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if p_token is null or btrim(p_token) = '' then
    raise exception 'Lien incomplet' using errcode = '22023';
  end if;

  v_hash := encode(sha256(convert_to(btrim(p_token), 'UTF8')), 'hex');

  select * into v_invitation
    from public.checkin_invitations
   where token_hash = v_hash;

  -- Un lien inconnu, déjà consommé ou périmé reçoit la MÊME réponse : dire
  -- lequel des trois apprendrait à qui tâtonne qu'un jeton a existé.
  if v_invitation.id is null
     or v_invitation.claimed_at is not null
     or v_invitation.expires_at <= now()
  then
    raise exception 'Lien invalide ou expiré' using errcode = 'PT404';
  end if;

  if v_email = '' or v_email is distinct from lower(btrim(v_invitation.email)) then
    -- On ne nomme pas l'adresse attendue : le porteur du lien n'est pas
    -- nécessairement son destinataire.
    raise exception 'Ce lien a été envoyé à une autre adresse' using errcode = 'PT403';
  end if;

  select * into v_profile from public.profiles where id = v_actor;
  if v_profile.id is null then
    raise exception 'Profil introuvable' using errcode = 'PT404';
  end if;

  if v_profile.organisation_id is not null
     and v_profile.organisation_id <> v_invitation.organisation_id
  then
    -- Déplacer quelqu'un d'une organisation à une autre est exactement ce que
    -- le trigger anti-escalade interdit, et pour de bonnes raisons.
    raise exception 'Ce compte appartient déjà à une autre organisation'
      using errcode = 'PT409';
  end if;

  if v_profile.organisation_id is null then
    v_claims := current_setting('request.jwt.claims', true);
    -- Contexte serveur, le temps de cette seule écriture.
    perform set_config('request.jwt.claims', '', true);

    update public.profiles
       set organisation_id = v_invitation.organisation_id,
           role = 'host',
           status = 'active'
     where id = v_actor;

    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  end if;

  insert into public.checkin_staff (
    survey_id, profile_id, organisation_id, granted_by, expires_at
  )
  values (
    v_invitation.survey_id, v_actor, v_invitation.organisation_id,
    v_invitation.created_by, v_invitation.staff_expires_at
  )
  on conflict (survey_id, profile_id) do update
     set expires_at = excluded.expires_at;

  update public.checkin_invitations
     set claimed_at = now(), claimed_by = v_actor
   where id = v_invitation.id;

  perform app.write_audit(
    'checkin_invitation_claimed',
    v_invitation.organisation_id,
    'checkin_invitation',
    v_invitation.id::text,
    jsonb_build_object(
      'survey_id', v_invitation.survey_id,
      'attached', v_profile.organisation_id is null
    )
  );

  return jsonb_build_object('survey_id', v_invitation.survey_id);
end;
$$;

comment on function public.claim_checkin_invitation(text) is
  'Consomme une invitation à usage unique : rattache un profil non rattaché en rôle host, et l''affecte à l''événement.';

revoke all on function public.claim_checkin_invitation(text) from public, anon;
grant execute on function public.claim_checkin_invitation(text) to authenticated;
