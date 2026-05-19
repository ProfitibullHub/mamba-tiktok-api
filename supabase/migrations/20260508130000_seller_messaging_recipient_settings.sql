-- Per-seller configuration: which team members receive agency→seller email from Mamba (To + BCC).
-- Empty recipient_user_ids means fall back to legacy pickSellerContactEmail ordering.

CREATE TABLE IF NOT EXISTS public.seller_messaging_settings (
    seller_tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
    recipient_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT seller_messaging_recipient_ids_max CHECK (cardinality(recipient_user_ids) <= 20)
);

CREATE INDEX IF NOT EXISTS idx_seller_messaging_settings_updated
    ON public.seller_messaging_settings (updated_at DESC);

COMMENT ON TABLE public.seller_messaging_settings IS
    'Ordered profile IDs for agency→seller unified messaging: first receives To, rest BCC; empty = auto primary contact.';

CREATE OR REPLACE FUNCTION public.seller_messaging_settings_enforce_seller_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.tenants t
        WHERE t.id = NEW.seller_tenant_id
          AND t.type = 'seller'
    ) THEN
        RAISE EXCEPTION 'seller_messaging_settings.seller_tenant_id must reference type seller';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seller_messaging_settings_enforce_seller_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_messaging_settings_enforce_seller_tenant() TO service_role;

DROP TRIGGER IF EXISTS trg_seller_messaging_settings_seller_only ON public.seller_messaging_settings;
CREATE TRIGGER trg_seller_messaging_settings_seller_only
    BEFORE INSERT OR UPDATE OF seller_tenant_id ON public.seller_messaging_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.seller_messaging_settings_enforce_seller_tenant();

CREATE OR REPLACE FUNCTION public.seller_messaging_settings_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seller_messaging_settings_touch_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_messaging_settings_touch_updated_at() TO service_role;

DROP TRIGGER IF EXISTS trg_seller_messaging_settings_updated ON public.seller_messaging_settings;
CREATE TRIGGER trg_seller_messaging_settings_updated
    BEFORE UPDATE ON public.seller_messaging_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.seller_messaging_settings_touch_updated_at();

ALTER TABLE public.seller_messaging_settings ENABLE ROW LEVEL SECURITY;
