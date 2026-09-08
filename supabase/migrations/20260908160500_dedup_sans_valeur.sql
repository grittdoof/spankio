-- ============================================================================
-- Une réponse SANS clé anti-doublon n'est plus refusée.
--
-- Défaut réel, constaté en production sur un formulaire d'inscription ouvert :
-- l'organisation avait refait ses questions, et `surveys.dedup_field` pointait
-- encore sur « email », un identifiant que le schéma ne contient plus. Aucune
-- valeur ne pouvait donc être extraite, `app.dedup_hash` renvoyait null, et
-- cette fonction levait PT400 — soit un 400 « Les données envoyées sont
-- invalides » sur CHAQUE inscription, pour une saisie parfaitement valide et
-- sans que rien, dans le formulaire, ne puisse être corrigé par le répondant.
-- Neuf réponses reçues jusqu'au changement de questions, puis plus aucune.
--
-- Le refus prétendait garantir « toute réponse porte une clé ». Cette garantie
-- n'était pas tenable : la question désignée peut avoir disparu du schéma, être
-- facultative, ou n'être POSÉE qu'à une partie des répondants — une adresse
-- demandée aux seuls présents n'existe pas chez ceux qui déclinent. Refuser
-- l'enregistrement dans ces trois cas bloque des réponses légitimes pour
-- protéger une unicité que rien ne rendait applicable.
--
-- La garantie réelle est celle de l'index : deux réponses vivantes ne peuvent
-- pas porter la MÊME clé (`survey_responses_dedup_uniq`, partiel sur
-- `dedup_key is not null`). Une clé absente ne collisionne avec rien — c'est la
-- sémantique de l'index, et c'est désormais celle de la fonction.
--
-- L'applicabilité de la désignation se juge en TypeScript, où le schéma et les
-- conditions d'affichage sont connus : `dedupDesignation` ignore une question
-- absente et le journalise ; l'écran d'édition la nomme et dit que l'unicité ne
-- s'applique plus. Muet plutôt que faux, comme pour une lecture d'effectif que
-- la question ne peut pas porter.
-- ============================================================================

create or replace function public.submit_survey_response(
  p_survey_id uuid,
  p_data jsonb,
  p_consent_given boolean default false,
  p_consent_text text default null,
  p_dedup_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_survey record;
  v_live_count integer;
  v_dedup_key text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_data, 'null'::jsonb)) <> 'object' then
    raise exception 'Payload invalide' using errcode = 'PT400';
  end if;

  if pg_column_size(p_data) > 65536 then
    raise exception 'Payload trop volumineux' using errcode = 'PT413';
  end if;

  select s.id, s.status, s.deleted_at, s.opens_at, s.closes_at, s.response_limit,
         s.require_consent, s.dedup_field, s.organisation_id
    into v_survey
  from public.surveys s
  join public.organisations o on o.id = s.organisation_id
  where s.id = p_survey_id and s.deleted_at is null and o.is_active;

  if v_survey.id is null then
    raise exception 'Sondage introuvable' using errcode = 'PT404';
  end if;

  if v_survey.status <> 'published'
     or (v_survey.opens_at is not null and v_survey.opens_at > now())
     or (v_survey.closes_at is not null and v_survey.closes_at <= now())
  then
    raise exception 'Sondage fermé' using errcode = 'PT423';
  end if;

  if v_survey.require_consent
     and (p_consent_given is not true or btrim(coalesce(p_consent_text, '')) = '')
  then
    raise exception 'Consentement requis' using errcode = 'PT412';
  end if;

  if v_survey.response_limit is not null then
    select count(*) into v_live_count
    from public.survey_responses r
    where r.survey_id = p_survey_id and r.deleted_at is null;

    if v_live_count >= v_survey.response_limit then
      raise exception 'Nombre maximal de réponses atteint' using errcode = 'PT429';
    end if;
  end if;

  -- Clé calculée quand une valeur est fournie, et SEULEMENT alors. Une valeur
  -- absente laisse `dedup_key` à null : la réponse est enregistrée, et l'index
  -- partiel continue d'interdire deux clés identiques.
  if v_survey.dedup_field is not null then
    v_dedup_key := app.dedup_hash(p_survey_id, p_dedup_value);
  end if;

  begin
    insert into public.survey_responses (
      survey_id, organisation_id, data, consent_given, consent_text, dedup_key
    )
    values (
      p_survey_id, v_survey.organisation_id, p_data,
      coalesce(p_consent_given, false), p_consent_text, v_dedup_key
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'Réponse déjà enregistrée' using errcode = 'PT409';
  end;

  return v_id;
end;
$$;

-- `create or replace` conserve les droits déjà accordés ; on les réaffirme pour
-- que la migration reste rejouable sur une base neuve.
revoke all on function public.submit_survey_response(uuid, jsonb, boolean, text, text)
  from public;
grant execute on function public.submit_survey_response(uuid, jsonb, boolean, text, text)
  to anon, authenticated;
