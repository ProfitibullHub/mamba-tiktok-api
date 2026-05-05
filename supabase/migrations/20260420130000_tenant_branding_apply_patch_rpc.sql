-- Atomic apply for tenant_branding: one INSERT ... ON CONFLICT DO UPDATE touching every column.
-- Ensures theme tokens (bg, sidebar, card, text) persist the same way as primary/secondary,
-- bypassing any PostgREST client/schema quirks on PATCH.

DROP FUNCTION IF EXISTS public.tenant_branding_apply_patch(
    uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text
);

CREATE OR REPLACE FUNCTION public.tenant_branding_apply_patch(
    p_tenant_id uuid,
    p_primary_color text,
    p_secondary_color text,
    p_bg_color text,
    p_sidebar_bg_color text,
    p_sidebar_border_color text,
    p_card_bg_color text,
    p_card_border_color text,
    p_text_color text,
    p_text_muted_color text,
    p_btn_text_color text,
    p_display_name text,
    p_email_sender_name text,
    p_email_sender_address text,
    p_custom_presets jsonb,
    p_logo_object_path text
)
RETURNS SETOF public.tenant_branding
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    INSERT INTO public.tenant_branding (
        tenant_id,
        primary_color,
        secondary_color,
        bg_color,
        sidebar_bg_color,
        sidebar_border_color,
        card_bg_color,
        card_border_color,
        text_color,
        text_muted_color,
        btn_text_color,
        display_name,
        email_sender_name,
        email_sender_address,
        custom_presets,
        logo_object_path
    )
    VALUES (
        p_tenant_id,
        p_primary_color,
        p_secondary_color,
        p_bg_color,
        p_sidebar_bg_color,
        p_sidebar_border_color,
        p_card_bg_color,
        p_card_border_color,
        p_text_color,
        p_text_muted_color,
        p_btn_text_color,
        p_display_name,
        p_email_sender_name,
        p_email_sender_address,
        COALESCE(p_custom_presets, '[]'::jsonb),
        p_logo_object_path
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
        primary_color = EXCLUDED.primary_color,
        secondary_color = EXCLUDED.secondary_color,
        bg_color = EXCLUDED.bg_color,
        sidebar_bg_color = EXCLUDED.sidebar_bg_color,
        sidebar_border_color = EXCLUDED.sidebar_border_color,
        card_bg_color = EXCLUDED.card_bg_color,
        card_border_color = EXCLUDED.card_border_color,
        text_color = EXCLUDED.text_color,
        text_muted_color = EXCLUDED.text_muted_color,
        btn_text_color = EXCLUDED.btn_text_color,
        display_name = EXCLUDED.display_name,
        email_sender_name = EXCLUDED.email_sender_name,
        email_sender_address = EXCLUDED.email_sender_address,
        custom_presets = EXCLUDED.custom_presets,
        logo_object_path = COALESCE(EXCLUDED.logo_object_path, tenant_branding.logo_object_path),
        updated_at = now()
    RETURNING *;
END;
$$;

COMMENT ON FUNCTION public.tenant_branding_apply_patch IS
    'Service-role only: upsert full tenant_branding row (all theme columns in one statement).';

REVOKE ALL ON FUNCTION public.tenant_branding_apply_patch(
    uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_branding_apply_patch(
    uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text
) TO service_role;
