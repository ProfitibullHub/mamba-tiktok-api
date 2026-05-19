-- Support / bug reports: maps authenticated users to external ticketing issues (server-side only via service role).
-- Optional "My reports" + cached status when SUPPORT_TICKET_STATUS_ENABLED is set on the API.

CREATE TABLE IF NOT EXISTS public.support_ticket_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    tenant_id UUID,
    account_id UUID,
    shop_id TEXT,
    shop_name TEXT,
    title TEXT NOT NULL,
    vendor TEXT NOT NULL DEFAULT 'linear',
    external_id TEXT NOT NULL,
    identifier TEXT,
    url TEXT,
    cached_status TEXT,
    status_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_submissions_user_created
    ON public.support_ticket_submissions (user_id, created_at DESC);

ALTER TABLE public.support_ticket_submissions ENABLE ROW LEVEL SECURITY;

-- Intentionally no policies for authenticated role: only the API (service role) reads/writes this table.

COMMENT ON TABLE public.support_ticket_submissions IS 'Bug/support tickets filed from the app; populated by server using service role.';
