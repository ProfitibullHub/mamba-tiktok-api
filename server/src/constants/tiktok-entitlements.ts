/** Keys in tenant_plan_entitlements; checked via tenant_feature_allowed RPC. */
export const FEATURE_TIKTOK_SHOP = 'tiktok_shop';
export const FEATURE_TIKTOK_ADS = 'tiktok_ads';

/** Permission seeded in DB (see tenants_accounts_memberships migration). */
export const ACTION_TIKTOK_AUTH = 'tiktok.auth';

/** Read synced Shop dashboard (GET/HEAD); Seller User has this, not tiktok.auth. */
export const ACTION_TIKTOK_SHOP_DATA = 'tiktok.shop.data';

/** Email dashboard summary / manage digest schedules (seed · Account Manager assignment path). */
export const ACTION_DASHBOARD_EXPORT_EMAIL = 'dashboard.export_email';

/** Read synced Ads dashboard (GET/HEAD); Seller User has this, not tiktok.auth. */
export const ACTION_TIKTOK_ADS_DATA = 'tiktok.ads.data';
