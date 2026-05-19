-- PRD §7.2: truncate end_date via new active row + prior row marked replaced_by (no in-place end_date mutation).
-- PRD §5.3: per-shop preference for custom P&L lines with no value in range — API shows 0 vs null.

ALTER TABLE public.tiktok_shops
    ADD COLUMN IF NOT EXISTS pl_custom_empty_value_display text NOT NULL DEFAULT 'zero';

ALTER TABLE public.tiktok_shops DROP CONSTRAINT IF EXISTS pl_custom_empty_value_display_chk;
ALTER TABLE public.tiktok_shops
    ADD CONSTRAINT pl_custom_empty_value_display_chk
        CHECK (pl_custom_empty_value_display IN ('zero', 'null'));

COMMENT ON COLUMN public.tiktok_shops.pl_custom_empty_value_display IS
    'When a custom P&L line has no value overlapping the report range: zero = amount_in_range 0; null = amount_in_range JSON null. Category rollups still use 0 for arithmetic.';

-- Truncate: insert shortened active segment; supersede prior row (historical row unchanged except replaced_by).
CREATE OR REPLACE FUNCTION public.truncate_pl_custom_line_item_value(
    p_old_value_id uuid,
    p_new_end date,
    p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old record;
    v_new_id uuid;
BEGIN
    IF p_new_end IS NULL THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_missing_fields' USING ERRCODE = '23502';
    END IF;

    SELECT v.* INTO v_old
    FROM public.pl_custom_line_item_values v
    WHERE v.id = p_old_value_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'pl_custom_value_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_old.replaced_by IS NOT NULL THEN
        RAISE EXCEPTION 'pl_custom_value_superseded' USING ERRCODE = '23503';
    END IF;

    IF p_new_end < v_old.start_date THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_invalid_range' USING ERRCODE = '23514';
    END IF;

    IF v_old.end_date IS NOT NULL AND p_new_end > v_old.end_date THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_invalid_range' USING ERRCODE = '23514';
    END IF;

    -- No-op: requested end matches current active end (inclusive).
    IF v_old.end_date IS NOT NULL AND p_new_end IS NOT DISTINCT FROM v_old.end_date THEN
        RETURN v_old.id;
    END IF;

    BEGIN
        ALTER TABLE public.pl_custom_line_item_values DISABLE TRIGGER trg_pl_custom_line_item_values_overlap_ins;

        INSERT INTO public.pl_custom_line_item_values (line_item_id, amount, start_date, end_date, created_by)
        VALUES (v_old.line_item_id, v_old.amount, v_old.start_date, p_new_end, p_actor)
        RETURNING id INTO v_new_id;

        UPDATE public.pl_custom_line_item_values
        SET replaced_by = v_new_id
        WHERE id = p_old_value_id;

        ALTER TABLE public.pl_custom_line_item_values ENABLE TRIGGER trg_pl_custom_line_item_values_overlap_ins;
    EXCEPTION
        WHEN OTHERS THEN
            ALTER TABLE public.pl_custom_line_item_values ENABLE TRIGGER trg_pl_custom_line_item_values_overlap_ins;
            RAISE;
    END;

    RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.truncate_pl_custom_line_item_value(uuid, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.truncate_pl_custom_line_item_value(uuid, date, uuid) TO service_role;
