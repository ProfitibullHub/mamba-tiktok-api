-- Store user-visible description for in-app ticket detail (email still includes full metadata).
ALTER TABLE public.support_ticket_submissions
ADD COLUMN IF NOT EXISTS description_snapshot TEXT;

COMMENT ON COLUMN public.support_ticket_submissions.description_snapshot IS 'User-entered bug description as shown in-app; optional until backfilled by new submissions.';
