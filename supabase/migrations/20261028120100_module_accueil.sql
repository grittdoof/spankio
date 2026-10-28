-- ============================================================================
-- Module « Accueil » — affectation des hôtes, et fermeture du rôle `host`.
--
-- Ce fichier ne contient AUCUN écran et AUCUN fait d'arrivée : seulement qui a
-- le droit de voir quoi. C'est délibéré — c'est le seul lot du module capable
-- d'ouvrir une fuite, et il doit pouvoir se relire seul.
--
-- Trois pièces, et elles ne valent qu'ensemble :
--
--  1. `app.is_active_member()` devient FAUSSE pour un `host` ;
--  2. `public.checkin_staff` dit à quels événements un `host` est affecté ;
--  3. deux policies additives lui ouvrent exactement ces événements-là.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Le catalogue
--
-- `checkin` n'est pas un module « core » : il se concède par le super
-- administrateur et s'active par l'organisation, comme `event`. On hérite ainsi
-- de toute la mécanique existante — concession, activation, surcharge PAR
-- UTILISATEUR — sans une ligne de plomberie nouvelle.
-- ----------------------------------------------------------------------------
insert into public.modules (key, name, description, is_core, sort_order) values
  ('checkin', 'Accueil et pointage',
   'Pointage des arrivées à l''entrée d''un événement, depuis un téléphone, par plusieurs personnes à la fois.',
   false, 30)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 2. « Membre actif » cesse d'inclure les comptes d'accueil
--
-- CŒUR DE LA MIGRATION, et le seul endroit où une erreur se paierait par une
-- fuite. `app.is_active_member()` n'est appelée que dans deux policies —
-- `surveys_select` et `survey_responses_select` — et ce sont exactement les
-- deux que le rôle `host` ne doit pas emprunter. La rendre fausse pour lui les
-- ferme toutes les deux d'un coup.
--
-- Pourquoi ici plutôt que dans chaque policy. Les policies permissives
-- s'ADDITIONNENT : une policy oubliée n'est pas une restriction manquante,
-- c'est une porte ouverte. En fermant à la source, toute policy ÉCRITE PLUS
-- TARD avec `is_active_member()` exclura les comptes d'accueil sans que son
-- auteur ait à y penser. C'est la règle déjà posée pour les droits par défaut :
-- un oubli doit devenir une absence d'accès, jamais une fuite.
--
-- Le nom reste juste à condition de le dire : « membre actif » signifie
-- désormais « membre actif de plein exercice ». Un compte d'accueil est un
-- membre, mais son accès ne vient pas de son rattachement — il vient, ligne à
-- ligne, de `public.checkin_staff`.
-- ----------------------------------------------------------------------------
create or replace function app.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.organisation_id is not null
      and p.role <> 'host'
  )
$$;

comment on function app.is_active_member() is
  'Membre actif de PLEIN EXERCICE. Un compte d''accueil (host) en est exclu : son accès vient de checkin_staff, événement par événement, jamais de son rattachement.';

-- ----------------------------------------------------------------------------
-- 3. L'affectation
--
-- Une ligne = « cette personne tient la porte de cet événement ». C'est la
-- seule chose qui ouvre quoi que ce soit à un compte d'accueil.
--
-- `organisation_id` est dénormalisé, comme partout ailleurs : le RLS filtre
-- sans jointure.
--
-- `expires_at` n'est pas un raffinement. Une hôtesse engagée pour une soirée
-- garderait sinon, indéfiniment, l'accès à une liste nominative de plusieurs
-- centaines de personnes. Personne n'y pense le lendemain ; tout le monde le
-- regrette. `null` reste possible — une équipe permanente existe — mais
-- l'écran d'affectation proposera une date par défaut.
-- ----------------------------------------------------------------------------
-- Les deux clés composites ci-dessous rendent possible ce que la table exige :
-- que le sondage ET la personne affectée appartiennent à l'organisation portée
-- par la ligne. `id` étant déjà clé primaire, ces unicités sont toujours
-- satisfaites — elles ne contraignent rien, elles rendent référençable un
-- couple qui ne l'était pas.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'surveys_id_org_uniq') then
    alter table public.surveys add constraint surveys_id_org_uniq unique (id, organisation_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_id_org_uniq') then
    alter table public.profiles add constraint profiles_id_org_uniq unique (id, organisation_id);
  end if;
end
$$;

create table if not exists public.checkin_staff (
  survey_id uuid not null,
  profile_id uuid not null,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (survey_id, profile_id),

  -- La cohérence d'organisation est STRUCTURELLE, pas déclarative.
  --
  -- Elle aurait pu s'écrire dans la policy d'insertion — c'était la première
  -- version. Une policy ne protège que le chemin qu'elle garde : un `service
  -- role`, une fonction `security definer` écrite plus tard, une migration de
  -- données, et la ligne incohérente passe. Ici le moteur refuse, quel que soit
  -- l'appelant. C'est le même raisonnement que l'anti-doublon, porté par une
  -- contrainte d'unicité réelle et non par une colonne décorative.
  --
  -- Effet second, voulu : un profil NON rattaché ne peut pas être affecté. Son
  -- `organisation_id` est nul, donc aucun couple ne correspond.
  constraint checkin_staff_survey_fk
    foreign key (survey_id, organisation_id)
    references public.surveys (id, organisation_id) on delete cascade,
  constraint checkin_staff_profile_fk
    foreign key (profile_id, organisation_id)
    references public.profiles (id, organisation_id) on delete cascade
);

comment on table public.checkin_staff is
  'Affectation d''un compte à la porte d''un événement. C''est l''unique source du droit de lecture d''un host : sans ligne vivante ici, il ne voit rien.';
comment on column public.checkin_staff.expires_at is
  'Fin de l''affectation. Passée cette date la ligne ne donne plus aucun droit, sans être supprimée : le rapport doit pouvoir dire qui tenait la porte.';

-- Lister les affectations d'une personne (« à quels événements suis-je
-- attendu ? ») est la requête de la page d'accueil : elle a son index.
create index if not exists checkin_staff_profile_idx
  on public.checkin_staff (profile_id);

alter table public.checkin_staff enable row level security;

-- ----------------------------------------------------------------------------
-- 4. L'affectation est-elle VIVANTE pour l'appelant ?
--
-- `security definer` pour la même raison que les autres fonctions de policy :
-- une sous-requête écrite directement dans une policy resterait soumise au RLS
-- de la table interrogée, ce qui produit des refus silencieux difficiles à
-- diagnostiquer.
--
-- Trois conditions, et aucune n'est redondante : la ligne existe, le compte
-- est toujours actif (une suspension doit fermer la porte immédiatement), et
-- l'affectation n'a pas expiré.
-- ----------------------------------------------------------------------------
create or replace function app.can_staff_survey(p_survey_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.checkin_staff s
    join public.profiles p on p.id = s.profile_id
    where s.survey_id = p_survey_id
      and s.profile_id = auth.uid()
      and p.status = 'active'
      and (s.expires_at is null or s.expires_at > now())
  )
$$;

comment on function app.can_staff_survey(uuid) is
  'L''appelant tient-il la porte de cet événement, maintenant ? Affectation présente, compte actif, échéance non passée.';

-- ----------------------------------------------------------------------------
-- 4 bis. Les droits de cette fonction, et la lacune qu'elle a révélée
--
-- PostgreSQL accorde `EXECUTE` à `PUBLIC` sur toute fonction nouvellement
-- créée. Le schéma `app` a bien été purgé à sa création
-- (`revoke all on all functions in schema app ...`), mais ce revoke ne vaut
-- que pour les fonctions existant À CE MOMENT-LÀ : `can_staff_survey`, créée
-- aujourd'hui, est née exécutable par un visiteur anonyme.
--
-- Le défaut a été attrapé par `tests/rls/exposed-surface.test.ts`, qui existe
-- précisément pour cela. Sans lui, une fonction interne de plus aurait été
-- appelable par n'importe qui — la même famille de défaut que `write_audit`
-- trouvé au déploiement du 4 septembre, et pour la même cause.
--
-- On corrige donc les deux niveaux : cette fonction-ci, et la règle qui aurait
-- dû la protéger. Les *default privileges* n'avaient été révoqués que sur le
-- schéma `public` ; ils le sont désormais aussi sur `app`, si bien que la
-- PROCHAINE fonction interne naîtra sans droits, qu'on y pense ou non.
-- ----------------------------------------------------------------------------
alter default privileges in schema app revoke all on functions from public, anon, authenticated;

revoke all on function app.can_staff_survey(uuid) from public, anon, authenticated;

-- Appelée DANS une policy, donc avec les droits de l'appelant : elle doit
-- rester exécutable par `authenticated`.
grant execute on function app.can_staff_survey(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Qui écrit les affectations
--
-- L'ADMINISTRATEUR de l'organisation, pas l'éditeur. Désigner une personne
-- pour lui ouvrir une liste nominative est un acte sur des COMPTES, pas sur un
-- formulaire : c'est la même frontière que `profiles_update`. Et c'est aussi la
-- seule cohérente, puisque l'administrateur est déjà le seul à pouvoir lire les
-- profils de son organisation — un éditeur n'aurait même pas de quoi composer
-- la liste des personnes à affecter.
--
-- Un compte d'accueil lit SES propres affectations, et rien d'autre : c'est ce
-- qui lui permet de savoir où il est attendu.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.checkin_staff to authenticated;

drop policy if exists checkin_staff_select on public.checkin_staff;
create policy checkin_staff_select on public.checkin_staff
  for select to authenticated
  using (
    app.is_super_admin()
    or profile_id = auth.uid()
    or (app.is_org_admin() and organisation_id = app.my_org_id())
  );

drop policy if exists checkin_staff_insert on public.checkin_staff;
create policy checkin_staff_insert on public.checkin_staff
  for insert to authenticated
  with check (
    app.is_super_admin()
    or (
      app.is_org_admin()
      and organisation_id = app.my_org_id()
      and app.can_use_module('checkin')
    )
  );

drop policy if exists checkin_staff_update on public.checkin_staff;
create policy checkin_staff_update on public.checkin_staff
  for update to authenticated
  using (
    app.is_super_admin()
    or (app.is_org_admin() and organisation_id = app.my_org_id())
  )
  with check (
    app.is_super_admin()
    or (app.is_org_admin() and organisation_id = app.my_org_id())
  );

drop policy if exists checkin_staff_delete on public.checkin_staff;
create policy checkin_staff_delete on public.checkin_staff
  for delete to authenticated
  using (
    app.is_super_admin()
    or (app.is_org_admin() and organisation_id = app.my_org_id())
  );

-- ----------------------------------------------------------------------------
-- 6. Ce qu'un compte d'accueil peut lire
--
-- Deux policies ADDITIVES, et rien de plus. Elles sont rédigées en recréant
-- les policies existantes à l'identique PLUS une branche : une policy séparée
-- aurait le même effet, mais la lecture d'un `surveys_select` complet en un
-- seul endroit vaut mieux que deux fragments à rapprocher mentalement.
--
-- Le module exigé est `checkin`, PAS celui du sondage. Tenir une porte n'est
-- pas éditer un événement : demander en plus le module `event` obligerait à
-- concéder aux hôtesses un droit dont elles ne font rien, et chaque droit
-- superflu est un droit à retirer un jour.
-- ----------------------------------------------------------------------------
drop policy if exists surveys_select on public.surveys;
create policy surveys_select on public.surveys
  for select to authenticated
  using (
    app.is_super_admin()
    or (app.is_active_member() and organisation_id = app.my_org_id())
    or (app.can_use_module('checkin') and app.can_staff_survey(id))
  );

drop policy if exists survey_responses_select on public.survey_responses;
create policy survey_responses_select on public.survey_responses
  for select to authenticated
  using (
    app.is_super_admin()
    or (
      app.is_active_member()
      and organisation_id = app.my_org_id()
      -- La restriction de modules s'applique aussi aux ressources imbriquées.
      and app.can_use_module(app.survey_module_key(survey_id))
    )
    or (
      app.can_use_module('checkin')
      and app.can_staff_survey(survey_id)
      -- Une réponse supprimée sort de la liste d'accueil comme elle sort des
      -- comptages. L'administration peut vouloir la revoir ; la porte, non.
      and deleted_at is null
    )
  );

-- ----------------------------------------------------------------------------
-- 7. Ce qu'un compte d'accueil ne peut PAS faire, et qui ne demande rien
--
-- Écrire un sondage         : `app.can_write_surveys()` n'accepte que
--                             admin / editor / super_admin.
-- Écrire une réponse        : même fonction, et le trigger d'immuabilité.
-- Lire le journal d'audit   : `app.is_org_admin()`.
-- Lire les autres profils   : `profiles_select` n'ouvre que le sien.
-- Lire l'annuaire, les
-- demandes, les modules     : toutes gardées par is_org_admin / is_super_admin.
--
-- Aucune de ces policies n'a eu besoin de changer : elles étaient déjà
-- rédigées sur des autorités qu'un compte d'accueil n'a pas. Seules les deux
-- qui passaient par « membre actif » demandaient une décision, et elle a été
-- prise au point 2 plutôt qu'ici.
-- ----------------------------------------------------------------------------
