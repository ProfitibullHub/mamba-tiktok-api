create table if not exists public.oauth_request_states (
    id uuid primary key default gen_random_uuid(),
    state_token text not null unique,
    provider text not null,
    actor_user_id uuid not null references public.profiles(id) on delete cascade,
    account_id uuid not null references public.accounts(id) on delete cascade,
    return_url text null,
    metadata jsonb not null default '{}'::jsonb,
    expires_at timestamptz not null default (now() + interval '15 minutes'),
    consumed_at timestamptz null,
    created_at timestamptz not null default now()
);

create index if not exists idx_oauth_request_states_lookup
    on public.oauth_request_states (state_token, provider, expires_at);

create index if not exists idx_oauth_request_states_actor
    on public.oauth_request_states (actor_user_id, created_at desc);

alter table public.oauth_request_states enable row level security;

drop policy if exists "Service role full access to oauth_request_states" on public.oauth_request_states;
create policy "Service role full access to oauth_request_states"
    on public.oauth_request_states
    for all
    to service_role
    using (true)
    with check (true);
