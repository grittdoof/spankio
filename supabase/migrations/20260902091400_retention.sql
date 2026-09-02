-- ============================================================================
-- Conservation et purge.
--
-- Les purges sont IDEMPOTENTES et appelables de trois façons :
--   * par pg_cron, si l'extension est disponible (voir migration suivante) ;
--   * par la route /api/cron/purge protégée par CRON_SECRET ;
--   * manuellement par un super_admin, via RPC.
-- Un environnement sans pg_cron reste donc conforme, sans échec silencieux.
-- ============================================================================

-- Nombre de jours pendant lesquels une ligne soft-deleted reste récupérable
-- avant effacement définitif.
create or replace function public.soft_delete_grace_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 30 $$;

-- ----------------------------------------------------------------------------
-- Purge des réponses : celles dont la durée de conservation est écoulée, et
-- celles supprimées il y a plus longtemps que le délai de grâce.
-- ----------------------------------------------------------------------------
create or replace function public.purge_expired_responses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer := 0;
  v_soft integer := 0;
begin
  -- `auth.uid()` nul = contexte serveur de confiance (cron, tâche planifiée).
  if auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Réservé au super administrateur' using errcode = 'SV403';
  end if;

  delete from public.survey_responses
  where purge_after is not null
    and purge_after <= now();
  get diagnostics v_expired = row_count;

  delete from public.survey_responses
  where deleted_at is not null
    and deleted_at <= now() - make_interval(days => public.soft_delete_grace_days());
  get diagnostics v_soft = row_count;

  if v_expired + v_soft > 0 then
    perform public.write_audit(
      'retention.purged_responses',
      null,
      'survey_responses',
      null,
      jsonb_build_object('expired', v_expired, 'soft_deleted', v_soft)
    );
  end if;

  return v_expired + v_soft;
end;
$$;

comment on function public.purge_expired_responses() is
  'Efface définitivement les réponses expirées et les réponses supprimées au-delà du délai de grâce. Idempotente.';

-- ----------------------------------------------------------------------------
-- Purge des sondages supprimés depuis plus longtemps que le délai de grâce.
-- Les réponses partent en cascade.
-- ----------------------------------------------------------------------------
create or replace function public.purge_deleted_surveys()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Réservé au super administrateur' using errcode = 'SV403';
  end if;

  delete from public.surveys
  where deleted_at is not null
    and deleted_at <= now() - make_interval(days => public.soft_delete_grace_days());
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform public.write_audit(
      'retention.purged_surveys', null, 'surveys', null,
      jsonb_build_object('count', v_count)
    );
  end if;

  return v_count;
end;
$$;

revoke all on function public.purge_expired_responses() from public;
revoke all on function public.purge_deleted_surveys() from public;
grant execute on function public.purge_expired_responses() to authenticated;
grant execute on function public.purge_deleted_surveys() to authenticated;
