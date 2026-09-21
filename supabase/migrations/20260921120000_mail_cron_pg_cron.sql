-- The 15-minute tick moves from GitHub Actions to pg_cron. GitHub's schedule is
-- best-effort and in practice fired every 2–5 hours (Sentry GETHIRED-4: 155 missed
-- check-ins in 4 days), so retries, reminders and nudges went out hours late.
-- pg_cron runs inside Supabase and calls /api/cron through pg_net. The URL and
-- bearer token live in Vault, not in this file — see docs/deploy-checklist.md:
--   select vault.create_secret('https://hiring.example.com/api/cron', 'cron_url');
--   select vault.create_secret('<CRON_SECRET value>', 'cron_secret');
-- Guarded so the local embedded Postgres (no pg_cron/pg_net) applies it as a no-op.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron/pg_net not available: mail-cron schedule skipped';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';
  if exists (select 1 from cron.job where jobname = 'mail-cron') then
    perform cron.unschedule('mail-cron');
  end if;
  perform cron.schedule(
    'mail-cron',
    '*/15 * * * *',
    $job$
      select net.http_get(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_url'),
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        timeout_milliseconds := 60000)
    $job$
  );
end $$;
