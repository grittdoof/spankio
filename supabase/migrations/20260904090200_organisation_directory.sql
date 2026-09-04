-- ============================================================================
-- Annuaire des organisations.
--
-- Problème réel qu'il résout : pour déposer une demande de rattachement, un
-- compte doit pouvoir DÉSIGNER une organisation — donc en connaître le nom.
-- Or la policy de `organisations` ne montre à un compte que la sienne, ce qui
-- est correct pour les données de gestion mais rend le parcours d'inscription
-- impossible.
--
-- Cette vue expose donc le strict minimum permettant de choisir : identifiant,
-- nom, logo. Aucune coordonnée, aucun réglage, aucune donnée de gestion. Elle
-- est en droits du propriétaire (`security_invoker = false`) et réservée aux
-- comptes authentifiés : la liste des clients de la plateforme n'a pas à être
-- publique.
-- ============================================================================

drop view if exists public.organisation_directory;
create view public.organisation_directory
with (security_invoker = false) as
select
  o.id,
  o.slug,
  o.name,
  o.logo_url
from public.organisations o
where o.is_active;

comment on view public.organisation_directory is
  'Choix d''une organisation au moment de la demande de rattachement. Colonnes minimales, réservé aux comptes authentifiés.';

grant select on public.organisation_directory to authenticated;
