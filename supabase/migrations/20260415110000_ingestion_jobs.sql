-- Durable ingestion queue for TikTok sync orchestration

create table if not exists ingestion_jobs (
    id uuid primary key default gen_random_uuid(),
    provider text not null default 'tiktok',
    stream text not null, -- shop | ads
    account_id uuid not null references accounts(id) on delete cascade,
    shop_id uuid null references tiktok_shops(id) on delete cascade,
    sync_type text not null default 'all',
    payload jsonb not null default '{}'::jsonb,
    idempotency_key text not null,
    status text not null default 'queued', -- queued | running | succeeded | failed | dead_letter
    priority int not null default 100,
    max_attempts int not null default 5,
    attempt_count int not null default 0,
    next_retry_at timestamptz not null default now(),
    locked_at timestamptz null,
    locked_by text null,
    last_error text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz null,
    unique (idempotency_key)
);

create index if not exists idx_ingestion_jobs_status_retry
    on ingestion_jobs (status, next_retry_at, priority, created_at);

create index if not exists idx_ingestion_jobs_account
    on ingestion_jobs (account_id, stream, created_at desc);

create table if not exists ingestion_job_attempts (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references ingestion_jobs(id) on delete cascade,
    attempt_no int not null,
    started_at timestamptz not null default now(),
    finished_at timestamptz null,
    status text not null default 'running', -- running | succeeded | failed
    worker_id text null,
    error text null,
    result jsonb null
);

create index if not exists idx_ingestion_attempts_job
    on ingestion_job_attempts (job_id, attempt_no desc);

-- Token lifecycle visibility for proactive 30-day reauth mitigation
alter table if exists tiktok_shops
    add column if not exists token_status text not null default 'active',
    add column if not exists last_token_error text null,
    add column if not exists token_warning_level text null,
    add column if not exists token_last_checked_at timestamptz null;

create index if not exists idx_tiktok_shops_token_health
    on tiktok_shops (token_status, token_warning_level, refresh_token_expires_at);
