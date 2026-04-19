-- ============================================================
-- SYSTEM LOGS
-- Persists all ingestionLogger events so they can be streamed
-- to the monitoring dashboard in real-time.
-- Automatically cleaned up — only last 24 hours are retained.
-- ============================================================

create table if not exists system_logs (
    id          uuid primary key default gen_random_uuid(),
    level       text not null default 'info', -- info | warn | error
    scope       text not null default 'ingestion',
    event       text not null,
    stream      text null,       -- shop | ads | null (system-level)
    job_id      uuid null,
    account_id  uuid null,
    shop_id     text null,
    message     text null,
    data        jsonb null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);

-- Primary streaming query: new rows since a given timestamp
create index if not exists idx_system_logs_created_at
    on system_logs (created_at desc);

-- Filter by stream
create index if not exists idx_system_logs_stream_created
    on system_logs (stream, created_at desc);

-- Filter by level (errors only, warnings only, etc.)
create index if not exists idx_system_logs_level_created
    on system_logs (level, created_at desc);

-- RLS: service role writes; super admins read
alter table system_logs enable row level security;

create policy "Service role full access to system_logs"
    on system_logs
    for all
    to service_role
    using (true)
    with check (true);

create policy "Platform super admins may read system_logs"
    on system_logs
    for select
    to authenticated
    using (
        exists (
            select 1 from tenant_memberships tm
            join roles r on r.id = tm.role_id
            join tenants t on t.id = tm.tenant_id
            where tm.user_id = auth.uid()
              and tm.status = 'active'
              and r.name = 'Super Admin'
              and t.type = 'platform'
        )
    );

-- ── Automatic TTL cleanup ─────────────────────────────────────
-- Keeps the table from growing unboundedly.
-- Called by the monitoring cron or a scheduled Postgres job.
-- In Supabase, you can also schedule this via the Dashboard → SQL Editor → Schedules.
create or replace function cleanup_system_logs_older_than_24h()
returns void
language sql
security definer
as $$
    delete from system_logs
    where created_at < now() - interval '24 hours';
$$;
