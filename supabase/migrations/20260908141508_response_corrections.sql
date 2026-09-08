-- ============================================================================
-- Correction d'une réponse déjà enregistrée
--
-- Le besoin est réel et légitime : un invité annonce venir accompagné sans dire
-- de combien, une adresse est mal saisie, un nom comporte une faute. Le RGPD
-- en fait même un droit — la rectification (art. 16).
--
-- MAIS une réponse est immuable, et cette immuabilité n'est pas décorative :
-- `consent_text` est la preuve auditable de ce qui a été affiché au répondant,
-- et `submitted_at` la date de son acte. Réécrire `data` en place détruirait la
-- correspondance entre la preuve et ce qu'elle prouve.
--
-- On ne relâche donc PAS le garde-fou. Une correction est :
--
--   1. la réponse d'origine passée en suppression logique — elle sort des
--      comptages et des exports, sans disparaître ;
--   2. une COPIE portant les données corrigées, la même date de soumission, le
--      même consentement et son texte, et un lien vers l'originale.
--
-- Le journal d'audit garde la trace de l'opération et de son auteur. Rien n'est
-- perdu, rien n'est réécrit, et l'index anti-doublon — partiel sur
-- `deleted_at is null` — libère la clé de l'originale pour la copie.
-- ============================================================================

alter table public.survey_responses
  add column if not exists corrects_id uuid
    references public.survey_responses (id) on delete set null;

comment on column public.survey_responses.corrects_id is
  'Réponse que cette ligne corrige. La corrigée est en suppression logique : les deux versions restent lisibles.';

-- Retrouver la chaîne des corrections d'une réponse sans balayer la table.
create index if not exists survey_responses_corrects_idx
  on public.survey_responses (corrects_id)
  where corrects_id is not null;

-- ----------------------------------------------------------------------------
-- La fonction est `SECURITY DEFINER` et revérifie elle-même les droits de
-- l'appelant, exactement comme les autres portes exposées : c'est ce qui évite
-- d'avoir à autoriser une écriture de `data` par une policy, laquelle
-- ouvrirait le chemin à tout appel direct.
--
-- La validation du CONTENU (champs connus du schéma, types, options) reste en
-- TypeScript, où le schéma du sondage est interprétable : la fonction reçoit
-- des données déjà reconstruites en liste blanche, comme `submit_survey_response`.
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

  -- Une réponse déjà corrigée ou supprimée n'existe plus pour l'appelant :
  -- `404` côté route, jamais un message qui confirmerait son existence.
  if v_old.id is null then
    raise exception 'Réponse introuvable' using errcode = 'PT404';
  end if;

  -- Mêmes droits que pour écrire un sondage de cette organisation, module
  -- compris. Un `viewer` ne corrige rien.
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

  -- La suppression logique D'ABORD, la copie ensuite. L'ordre inverse paraît
  -- plus prudent mais échoue : l'index anti-doublon est partiel sur
  -- `deleted_at is null`, et deux lignes vivantes portant la même clé le
  -- violent. Défaut attrapé par le test d'intégration, pas par la relecture.
  --
  -- L'ordre est sans risque parce que tout se joue dans UNE transaction : si
  -- l'insertion échoue, la suppression est annulée avec elle.
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

  -- Aucune donnée de la réponse dans l'audit : seuls les identifiants et le
  -- nombre de champs touchés. Le journal n'est pas une seconde copie.
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

comment on function public.correct_survey_response(uuid, jsonb) is
  'Corrige une réponse sans la réécrire : suppression logique de l''originale, copie portant les données corrigées, lien entre les deux, entrée d''audit.';

revoke all on function public.correct_survey_response(uuid, jsonb) from public, anon;
grant execute on function public.correct_survey_response(uuid, jsonb) to authenticated;
