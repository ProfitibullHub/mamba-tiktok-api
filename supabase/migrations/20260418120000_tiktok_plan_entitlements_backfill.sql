-- Plan entitlements for TikTok Shop vs TikTok Ads (used by tenant_feature_allowed + API routes).
-- Default: all existing tenants get both features so RBAC checks do not regress after enabling feature gating.
-- OAuth tokens remain protected by platform/database controls (encryption at rest is provided by the Supabase-hosted Postgres tier and access policies; avoid logging secrets in application code).

INSERT INTO public.tenant_plan_entitlements (tenant_id, feature_key, allowed, source_plan_id)
SELECT t.id, v.feature_key, true, 'migration:20260418120000'
FROM public.tenants t
CROSS JOIN (VALUES ('tiktok_shop'), ('tiktok_ads')) AS v(feature_key)
ON CONFLICT (tenant_id, feature_key) DO UPDATE
SET allowed = EXCLUDED.allowed,
    updated_at = now();
