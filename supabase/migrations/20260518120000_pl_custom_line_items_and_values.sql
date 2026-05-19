-- Custom P&L: structural line items per shop + date-scoped values (UTC calendar dates,
-- aligned with P&L settlement filtering / getUtcCalendarRangeExclusiveUnix on the client).

CREATE TABLE IF NOT EXISTS public.pl_custom_line_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    tiktok_shop_id uuid NOT NULL REFERENCES public.tiktok_shops (id) ON DELETE CASCADE,
    category text NOT NULL,
    name text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
    CONSTRAINT pl_custom_line_items_category_chk
        CHECK (category IN ('revenue', 'cogs', 'expenses', 'supplementary'))
);

CREATE INDEX IF NOT EXISTS idx_pl_custom_line_items_shop_active_sort
    ON public.pl_custom_line_items (tiktok_shop_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_pl_custom_line_items_tenant
    ON public.pl_custom_line_items (seller_tenant_id);

CREATE TABLE IF NOT EXISTS public.pl_custom_line_item_values (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    line_item_id uuid NOT NULL REFERENCES public.pl_custom_line_items (id) ON DELETE RESTRICT,
    seller_tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    tiktok_shop_id uuid NOT NULL REFERENCES public.tiktok_shops (id) ON DELETE CASCADE,
    amount numeric NOT NULL,
    start_date date NOT NULL,
    end_date date NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
    CONSTRAINT pl_custom_line_item_values_amount_finite_chk
        CHECK (amount = amount)
);

CREATE INDEX IF NOT EXISTS idx_pl_custom_line_item_values_line_start
    ON public.pl_custom_line_item_values (line_item_id, start_date);

CREATE INDEX IF NOT EXISTS idx_pl_custom_line_item_values_shop_dates
    ON public.pl_custom_line_item_values (tiktok_shop_id, start_date, end_date);

-- Denormalized tenant/shop must match parent line item
CREATE OR REPLACE FUNCTION public.pl_custom_line_item_values_sync_from_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_tenant uuid;
    v_shop uuid;
BEGIN
    SELECT i.seller_tenant_id, i.tiktok_shop_id
    INTO v_tenant, v_shop
    FROM public.pl_custom_line_items i
    WHERE i.id = NEW.line_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'pl_custom_line_item_values: line_item_id not found';
    END IF;

    NEW.seller_tenant_id := v_tenant;
    NEW.tiktok_shop_id := v_shop;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pl_custom_line_item_values_sync ON public.pl_custom_line_item_values;
CREATE TRIGGER trg_pl_custom_line_item_values_sync
    BEFORE INSERT OR UPDATE OF line_item_id ON public.pl_custom_line_item_values
    FOR EACH ROW
    EXECUTE FUNCTION public.pl_custom_line_item_values_sync_from_parent();

-- Inclusive date overlap: treat NULL end_date as open-ended (9999-12-31 for comparison).
CREATE OR REPLACE FUNCTION public.pl_custom_line_item_values_overlap_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_max constant date := '9999-12-31'::date;
    v_end_new date;
    v_end_o date;
BEGIN
    v_end_new := COALESCE(NEW.end_date, v_max);
    IF NEW.start_date > v_end_new THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_invalid_range'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.start_date IS NOT DISTINCT FROM NEW.start_date
       AND OLD.end_date IS NOT DISTINCT FROM NEW.end_date
       AND OLD.line_item_id IS NOT DISTINCT FROM NEW.line_item_id
       AND OLD.amount IS NOT DISTINCT FROM NEW.amount THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.pl_custom_line_item_values o
        WHERE o.line_item_id = NEW.line_item_id
          AND o.id IS DISTINCT FROM NEW.id
          AND NEW.start_date <= COALESCE(o.end_date, v_max)
          AND o.start_date <= v_end_new
    ) THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_overlap'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pl_custom_line_item_values_overlap_ins ON public.pl_custom_line_item_values;
CREATE TRIGGER trg_pl_custom_line_item_values_overlap_ins
    BEFORE INSERT ON public.pl_custom_line_item_values
    FOR EACH ROW
    EXECUTE FUNCTION public.pl_custom_line_item_values_overlap_guard();

DROP TRIGGER IF EXISTS trg_pl_custom_line_item_values_overlap_upd ON public.pl_custom_line_item_values;
CREATE TRIGGER trg_pl_custom_line_item_values_overlap_upd
    BEFORE UPDATE OF start_date, end_date, line_item_id ON public.pl_custom_line_item_values
    FOR EACH ROW
    EXECUTE FUNCTION public.pl_custom_line_item_values_overlap_guard();

-- Append-only helper: close strictly-prior open-ended segments, then insert (single transaction).
CREATE OR REPLACE FUNCTION public.append_pl_custom_line_item_value(
    p_line_item_id uuid,
    p_amount numeric,
    p_start_date date,
    p_end_date date,
    p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_id uuid;
    v_lock int;
BEGIN
    IF p_amount IS NULL OR p_start_date IS NULL THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_missing_fields' USING ERRCODE = '23502';
    END IF;

    IF p_end_date IS NOT NULL AND p_end_date < p_start_date THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_invalid_range' USING ERRCODE = '23514';
    END IF;

    SELECT 1 INTO v_lock
    FROM public.pl_custom_line_items i
    WHERE i.id = p_line_item_id
      AND i.is_active = true
    FOR UPDATE;

    IF v_lock IS NULL THEN
        RAISE EXCEPTION 'pl_custom_line_item_not_found_or_inactive' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.pl_custom_line_item_values v
    SET end_date = p_start_date - 1
    WHERE v.line_item_id = p_line_item_id
      AND v.end_date IS NULL
      AND v.start_date < p_start_date;

    INSERT INTO public.pl_custom_line_item_values (line_item_id, amount, start_date, end_date, created_by)
    VALUES (p_line_item_id, p_amount, p_start_date, p_end_date, p_actor)
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_pl_custom_line_item_value(uuid, numeric, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_pl_custom_line_item_value(uuid, numeric, date, date, uuid) TO service_role;

ALTER TABLE public.pl_custom_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pl_custom_line_item_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pl_custom_line_items_select_visible ON public.pl_custom_line_items;
CREATE POLICY pl_custom_line_items_select_visible
    ON public.pl_custom_line_items
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.tiktok_shops ts
            WHERE ts.id = pl_custom_line_items.tiktok_shop_id
              AND public.account_is_visible_to_user(ts.account_id, auth.uid())
        )
    );

DROP POLICY IF EXISTS pl_custom_line_item_values_select_visible ON public.pl_custom_line_item_values;
CREATE POLICY pl_custom_line_item_values_select_visible
    ON public.pl_custom_line_item_values
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.tiktok_shops ts
            WHERE ts.id = pl_custom_line_item_values.tiktok_shop_id
              AND public.account_is_visible_to_user(ts.account_id, auth.uid())
        )
    );

COMMENT ON TABLE public.pl_custom_line_items IS 'Seller-defined P&L line item structure per TikTok shop; soft-delete via is_active.';
COMMENT ON TABLE public.pl_custom_line_item_values IS 'Date-scoped amounts for a custom P&L line; UTC calendar dates inclusive; end_date NULL means ongoing.';
COMMENT ON FUNCTION public.append_pl_custom_line_item_value IS 'Closes prior open-ended segments starting strictly before p_start_date, then inserts a new value row (overlap-safe).';
