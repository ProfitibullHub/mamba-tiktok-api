-- ============================================================
-- AUDIT LOG
-- Records all sensitive actor-initiated events:
--   - TikTok shop connect/disconnect
--   - Role grant/revoke
--   - Team invitations (sent/accepted/declined/revoked)
--   - Admin user-wipe actions
--   - Dashboard data exports
-- ============================================================

create table if not exists audit_logs (
    id              uuid primary key default gen_random_uuid(),

    -- Who did it
    actor_user_id   uuid null references auth.users(id) on delete set null,
    actor_email     text null,

    -- What they did
    action          text not null,          -- e.g. 'shop.connect', 'role.grant', 'member.remove'
    resource_type   text not null,          -- e.g. 'shop', 'tenant_membership', 'invitation'
    resource_id     text null,              -- UUID or external ID of the affected resource

    -- Context
    account_id      uuid null references accounts(id) on delete set null,
    tenant_id       uuid null references tenants(id) on delete set null,

    -- Before/after state (JSON snapshots for billing disputes and security reviews)
    before_state    jsonb null,
    after_state     jsonb null, 

    -- Request metadata
    ip_address      inet null,
    user_agent      text null,
 
    -- Extra structured context
    metadata        jsonb null default '{}'::jsonb,

    created_at      timestamptz not null default now()
);

-- Index for per-actor queries (user's own history)
create index if not exists idx_audit_logs_actor
    on audit_logs (actor_user_id, created_at desc);

-- Index for per-tenant security review
create index if not exists idx_audit_logs_tenant
    on audit_logs (tenant_id, created_at desc);

-- Index for per-account billing disputes
create index if not exists idx_audit_logs_account
    on audit_logs (account_id, created_at desc);

-- Index for action-type queries (e.g. "show all disconnects")
create index if not exists idx_audit_logs_action
    on audit_logs (action, created_at desc);

-- Only platform super-admins may read audit logs; no user writes (server inserts via service role)
alter table audit_logs enable row level security;

create policy "Service role full access to audit_logs"
    on audit_logs
    for all
    to service_role
    using (true)
    with check (true);

create policy "Platform super admins may read audit_logs"
    on audit_logs
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
