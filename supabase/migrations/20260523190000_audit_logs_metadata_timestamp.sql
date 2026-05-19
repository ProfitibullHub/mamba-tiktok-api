-- PRD §10: each audit log includes a Timestamp on the structured envelope.
-- `created_at` remains the canonical row clock; `metadata.timestamp` duplicates it in ISO 8601 UTC
-- for exports and snapshots that read JSON only. Applies to all inserts (Express + PL/pgSQL).

CREATE OR REPLACE FUNCTION public.audit_logs_stamp_metadata_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.metadata :=
        COALESCE(NEW.metadata, '{}'::jsonb)
        || jsonb_build_object(
            'timestamp',
            to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        );
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.audit_logs_stamp_metadata_timestamp() IS
    'BEFORE INSERT on audit_logs: merge metadata.timestamp (UTC ISO-8601) for PRD §10; server clock at insert.';

DROP TRIGGER IF EXISTS trg_audit_logs_metadata_timestamp ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_metadata_timestamp
    BEFORE INSERT ON public.audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_logs_stamp_metadata_timestamp();

COMMENT ON TRIGGER trg_audit_logs_metadata_timestamp ON public.audit_logs IS
    'Ensures every audit row carries metadata.timestamp alongside created_at.';
