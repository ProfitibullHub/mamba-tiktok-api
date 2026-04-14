-- Platform operators: search profiles and tenants without pasting raw UUIDs (UI pickers).

CREATE OR REPLACE FUNCTION public.platform_search_profiles(p_query text, p_limit int DEFAULT 20)
RETURNS TABLE (id uuid, email text, full_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_raw text;
    v_q text;
    v_lim int;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT public.user_is_internal_platform_operator(v_caller) THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;

    v_raw := COALESCE(trim(p_query), '');
    IF length(v_raw) < 2 THEN
        RETURN;
    END IF;

    v_q := regexp_replace(v_raw, '[%_\\]', '', 'g');
    IF length(v_q) < 2 THEN
        RETURN;
    END IF;

    v_lim := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);

    IF v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RETURN QUERY
        SELECT p.id, p.email, p.full_name
        FROM profiles p
        WHERE p.id = v_q::uuid
        LIMIT 1;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT p.id, p.email, p.full_name
    FROM profiles p
    WHERE p.email ILIKE '%' || v_q || '%'
       OR (p.full_name IS NOT NULL AND p.full_name ILIKE '%' || v_q || '%')
       OR (length(v_q) >= 8 AND p.id::text ILIKE '%' || v_q || '%')
    ORDER BY p.email NULLS LAST
    LIMIT v_lim;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_search_tenants_for_operator(
    p_query text,
    p_kind text DEFAULT 'all',
    p_limit int DEFAULT 30
)
RETURNS TABLE (id uuid, name text, type text, parent_tenant_id uuid, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_raw text;
    v_q text;
    v_lim int;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT public.user_is_internal_platform_operator(v_caller) THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;

    IF p_kind IS NOT NULL AND lower(trim(p_kind)) NOT IN ('all', 'agency', 'seller') THEN
        RAISE EXCEPTION 'Invalid p_kind';
    END IF;

    v_raw := COALESCE(trim(p_query), '');
    IF length(v_raw) < 1 THEN
        RETURN;
    END IF;

    v_q := regexp_replace(v_raw, '[%_\\]', '', 'g');
    IF length(v_q) < 1 THEN
        RETURN;
    END IF;

    v_lim := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);

    IF v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RETURN QUERY
        SELECT t.id, t.name, t.type::text, t.parent_tenant_id, t.status
        FROM tenants t
        WHERE t.id = v_q::uuid
          AND t.type <> 'platform'
          AND (
              lower(COALESCE(p_kind, 'all')) = 'all'
              OR t.type::text = lower(trim(p_kind))
          )
        LIMIT 5;
        RETURN;
    END IF;

    IF length(v_q) < 2 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT t.id, t.name, t.type::text, t.parent_tenant_id, t.status
    FROM tenants t
    WHERE t.type <> 'platform'
      AND (
          lower(COALESCE(p_kind, 'all')) = 'all'
          OR t.type::text = lower(trim(p_kind))
      )
      AND (
          t.name ILIKE '%' || v_q || '%'
          OR t.id::text ILIKE '%' || v_q || '%'
      )
    ORDER BY t.name
    LIMIT v_lim;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_search_profiles(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_search_tenants_for_operator(text, text, int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.platform_search_profiles(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_search_tenants_for_operator(text, text, int) TO authenticated;

COMMENT ON FUNCTION public.platform_search_profiles IS 'Internal operator: search profiles by email, name, partial/full UUID.';
COMMENT ON FUNCTION public.platform_search_tenants_for_operator IS 'Internal operator: search agency/seller tenants by name or id (excludes platform).';
