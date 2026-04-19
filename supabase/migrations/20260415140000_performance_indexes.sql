-- ============================================================
-- PERFORMANCE INDEXES — P2
-- Missing indexes identified in the production hardening audit.
-- ============================================================

-- Composite index for multi-tenant, date-range order queries.
-- RLS policies join through tiktok_shops → accounts; queries that
-- filter by account_id + date will now hit this index instead of
-- a seq-scan followed by a nested-loop on shop_id.
create index if not exists idx_shop_orders_shop_created
    on shop_orders (shop_id, create_time desc);

-- shop_orders: account-level queries via shop → account join path
-- (used by P&L calculations and finance debug view)
create index if not exists idx_shop_orders_paid_time
    on shop_orders (shop_id, paid_time desc nulls last)
    where paid_time is not null;

-- settlement → order join (used in finance reconciliation)
create index if not exists idx_shop_settlements_shop_time
    on shop_settlements (shop_id, settlement_time desc);

-- ingestion_job_attempts: monitoring queries fetch by started_at desc
create index if not exists idx_ingestion_attempts_started
    on ingestion_job_attempts (started_at desc);

-- audit_logs: very common query — recent actions across all tenants
create index if not exists idx_audit_logs_created_at
    on audit_logs (created_at desc);

-- tiktok_shops: orders_last_synced_at used by staleness detection in monitoring
create index if not exists idx_tiktok_shops_synced_at
    on tiktok_shops (orders_last_synced_at nulls first);
