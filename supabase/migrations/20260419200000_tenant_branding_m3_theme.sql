-- Migration: Add full theme token support to tenant_branding
-- Adds 8 new color columns to allow a completely custom UI per-agency.
-- Each column is nullable (null means fallback to platform default).

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS bg_color text,
    ADD COLUMN IF NOT EXISTS sidebar_bg_color text,
    ADD COLUMN IF NOT EXISTS sidebar_border_color text,
    ADD COLUMN IF NOT EXISTS card_bg_color text,
    ADD COLUMN IF NOT EXISTS card_border_color text,
    ADD COLUMN IF NOT EXISTS text_color text,
    ADD COLUMN IF NOT EXISTS text_muted_color text,
    ADD COLUMN IF NOT EXISTS btn_text_color text;

-- Add CHECK constraints identical to the existing primary/secondary color checks
ALTER TABLE public.tenant_branding
    ADD CONSTRAINT tenant_branding_bg_color_hex CHECK (
        bg_color IS NULL OR bg_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
    ),
    ADD CONSTRAINT tenant_branding_sidebar_bg_color_hex CHECK (
        sidebar_bg_color IS NULL OR sidebar_bg_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
    ),
    ADD CONSTRAINT tenant_branding_sidebar_border_color_hex CHECK (
        sidebar_border_color IS NULL OR sidebar_border_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
    ),
    ADD CONSTRAINT tenant_branding_card_bg_color_hex CHECK (
        card_bg_color IS NULL OR card_bg_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
    ),
    ADD CONSTRAINT tenant_branding_card_border_color_hex CHECK (
        card_border_color IS NULL OR card_border_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
    ),
    ADD CONSTRAINT tenant_branding_text_color_hex CHECK (
        text_color IS NULL OR text_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
    ),
    ADD CONSTRAINT tenant_branding_text_muted_color_hex CHECK (
        text_muted_color IS NULL OR text_muted_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
    ),
    ADD CONSTRAINT tenant_branding_btn_text_color_hex CHECK (
        btn_text_color IS NULL OR btn_text_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
    );
