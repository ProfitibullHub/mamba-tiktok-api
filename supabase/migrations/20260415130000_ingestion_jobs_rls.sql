-- ============================================================
-- RLS on ingestion_jobs and ingestion_job_attempts
-- These tables are accessed exclusively via the service-role
-- backend — never directly from the Supabase client SDK.
-- Adding RLS as defense-in-depth to prevent any anon/user
-- key from reading cross-tenant job data.
-- ============================================================

alter table if exists ingestion_jobs enable row level security;
alter table if exists ingestion_job_attempts enable row level security;

-- Only the service role key (used by our backend) may access these tables
create policy "Service role full access to ingestion_jobs"
    on ingestion_jobs
    for all
    to service_role
    using (true)
    with check (true);

create policy "Service role full access to ingestion_job_attempts"
    on ingestion_job_attempts
    for all
    to service_role
    using (true)
    with check (true);

-- Platform super-admins may read (for IngestionMonitoringView backend queries)
create policy "Platform super admins may read ingestion_jobs"
    on ingestion_jobs
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

create policy "Platform super admins may read ingestion_job_attempts"
    on ingestion_job_attempts
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
