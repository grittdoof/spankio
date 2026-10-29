-- ============================================================================
-- Module « Accueil », lot 4 — la préparation.
--
-- Le plus gros risque du module n'est pas technique : c'est l'hôtesse qui
-- découvre à 19 h 50 que son compte ne marche pas. On ne le supprime pas en
-- écrivant du code plus solide, on le supprime en le rendant VISIBLE la
-- veille.
--
-- D'où deux colonnes, et rien de plus : « s'est-elle déjà connectée à CE
-- poste ? ». `auth.users.last_sign_in_at` ne répond pas à la question — il dit
-- qu'un compte sert, pas qu'il ouvre cet événement — et n'est de toute façon
-- pas lisible sous RLS.
-- ============================================================================

alter table public.checkin_staff
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz;

comment on column public.checkin_staff.first_seen_at is
  'Première ouverture du poste par cette personne. Répond à « sait-elle se connecter ? », la veille, quand on peut encore agir.';
comment on column public.checkin_staff.last_seen_at is
  'Dernière ouverture du poste. Sert à l''écran de préparation, jamais à un droit.';

-- ----------------------------------------------------------------------------
-- Onzième fonction exposée — et le piège qu'elle évite
--
-- La première version de cette migration n'ajoutait AUCUNE fonction : une
-- policy d'UPDATE bornée à `profile_id = auth.uid()`, plus un
-- `grant update (first_seen_at, last_seen_at)`, semblaient suffire.
--
-- C'était faux, et silencieusement. Le lot 1 a déjà écrit
-- `grant select, insert, update, delete on public.checkin_staff to
-- authenticated` — un droit de TABLE, donc sur toutes les colonnes. Un
-- `grant` de colonne ne RETIRE rien ; il s'ajoute. Et le RLS borne les LIGNES,
-- jamais les colonnes. La policy aurait donc laissé une hôtesse écrire
-- n'importe quelle colonne de sa propre ligne — à commencer par `expires_at`,
-- c'est-à-dire prolonger seule son accès à une liste nominative de plusieurs
-- centaines de personnes. Exactement l'accès que le lot 1 existe pour fermer.
--
-- Retirer le droit de table n'était pas une issue : l'administrateur et
-- l'hôtesse sont tous deux `authenticated`, et un `grant` ne sait pas les
-- distinguer — seule une policy le sait, et elle ne voit pas les colonnes.
--
-- D'où une porte, qui écrit `now()` côté serveur et ne touche que ces deux
-- colonnes. Elle ne remplace pas un `service role` comme les dix autres, mais
-- elle remplace une écriture directe qu'aucune policy ne peut borner
-- correctement — c'est le même raisonnement que `set_checkin`.
-- ----------------------------------------------------------------------------
create or replace function public.touch_checkin_staff(p_survey_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_touched integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Aucune vérification de droit à écrire ici : être affecté EST le droit, et
  -- le `where` le dit. Une personne non affectée ne touche aucune ligne et
  -- reçoit `false` — pas une erreur, puisqu'il n'y a rien d'anormal à ouvrir
  -- une page dont on vient d'être retiré.
  update public.checkin_staff
     set first_seen_at = coalesce(first_seen_at, now()),
         last_seen_at = now()
   where survey_id = p_survey_id
     and profile_id = auth.uid()
     and (expires_at is null or expires_at > now());

  get diagnostics v_touched = row_count;
  return v_touched > 0;
end;
$$;

comment on function public.touch_checkin_staff(uuid) is
  'Marque que cette personne a ouvert le poste. Écrit now() côté serveur, et seulement ces deux colonnes.';

revoke all on function public.touch_checkin_staff(uuid) from public, anon;
grant execute on function public.touch_checkin_staff(uuid) to authenticated;
