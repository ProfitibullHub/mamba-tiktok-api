-- Dashboard export hardening:
-- - store schedule frequency (daily/weekly/monthly)
-- - store report_types per schedule
-- - preserve existing schedules with safe defaults

ALTER TABLE public.dashboard_email_schedules
    ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'daily',
    ADD COLUMN IF NOT EXISTS day_of_week smallint,
    ADD COLUMN IF NOT EXISTS day_of_month smallint,
    ADD COLUMN IF NOT EXISTS report_types text[] NOT NULL DEFAULT ARRAY['order','pl']::text[];

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'dashboard_email_schedules_frequency_check'
          AND conrelid = 'public.dashboard_email_schedules'::regclass
    ) THEN
        ALTER TABLE public.dashboard_email_schedules
            ADD CONSTRAINT dashboard_email_schedules_frequency_check
            CHECK (frequency IN ('daily', 'weekly', 'monthly'));
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'dashboard_email_schedules_day_of_week_check'
          AND conrelid = 'public.dashboard_email_schedules'::regclass
    ) THEN
        ALTER TABLE public.dashboard_email_schedules
            ADD CONSTRAINT dashboard_email_schedules_day_of_week_check
            CHECK (
                day_of_week IS NULL
                OR (day_of_week >= 0 AND day_of_week <= 6)
            );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'dashboard_email_schedules_day_of_month_check'
          AND conrelid = 'public.dashboard_email_schedules'::regclass
    ) THEN
        ALTER TABLE public.dashboard_email_schedules
            ADD CONSTRAINT dashboard_email_schedules_day_of_month_check
            CHECK (
                day_of_month IS NULL
                OR (day_of_month >= 1 AND day_of_month <= 31)
            );
    END IF;
END
$$;

UPDATE public.dashboard_email_schedules
SET report_types = ARRAY['order','pl']::text[]
WHERE report_types IS NULL OR array_length(report_types, 1) IS NULL;

CREATE INDEX IF NOT EXISTS idx_dashboard_email_schedules_frequency
    ON public.dashboard_email_schedules (enabled, frequency, hour_utc)
    WHERE enabled = true;
