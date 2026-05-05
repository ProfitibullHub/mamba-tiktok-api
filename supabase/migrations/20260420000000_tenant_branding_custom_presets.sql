-- Migration: Add custom_presets column to tenant_branding
-- Used to store user-defined custom theme preset configurations in the white-label settings.

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS custom_presets jsonb DEFAULT '[]'::jsonb;
