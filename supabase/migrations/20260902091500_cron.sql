-- ============================================================================
-- Planification des purges via pg_cron.
--
-- L'extension n'est pas disponible sur tous les plans Supabase, ni sous PGlite
-- (tests). Toute cette migration est donc tolérante : si pg_cron est absent,
-- elle ne fait rien et ne casse pas le déploiement. Les purges restent
-- déclenchables par la route /api/cron/purge et par RPC — le mécanisme n'est
-- jamais « silencieusement inexistant », il a un chemin de repli documenté.
-- ============================================================================

do $$
declare
  v_has_cron boolean;
begin
  -- 1. L'extension est-elle installable / installée ?
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception
      when others then
        raise notice 'pg_cron indisponible (%). Purges à déclencher via /api/cron/purge.', sqlerrm;
    end;
  end if;

  select exists (select 1 from pg_extension where extname = 'pg_cron') into v_has_cron;

  if not v_has_cron then
    return;
  end if;

  -- 2. Reprogrammation idempotente : on retire l'ancien job avant de le poser.
  begin
    perform cron.unschedule('purge-expired-responses');
  exception
    when others then null;
  end;

  begin
    perform cron.unschedule('purge-deleted-surveys');
  exception
    when others then null;
  end;

  perform cron.schedule(
    'purge-expired-responses',
    '17 3 * * *',
    'select public.purge_expired_responses();'
  );

  perform cron.schedule(
    'purge-deleted-surveys',
    '37 3 * * *',
    'select public.purge_deleted_surveys();'
  );
end
$$;
