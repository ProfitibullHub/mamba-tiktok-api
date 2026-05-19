/**
 * Account / shop access control — where enforcement actually lives.
 *
 * Do not treat frontend Supabase RPCs as a security boundary. A user with a valid
 * session can call the REST API or PostgREST directly; only server middleware, RLS,
 * and service-role RPCs block unauthorized reads/writes.
 *
 * ## Layers (defense in depth)
 *
 * 1. **Row Level Security (Postgres)**
 *    - `account_is_visible_to_user(account_id, auth.uid())` on `accounts`, `tiktok_shops`,
 *      and shop-scoped tables (orders, products, fees, etc.).
 *    - Direct browser reads/writes use the user's JWT; invisible rows are filtered or rejected.
 *
 * 2. **Express API (`server/src/middleware/account-access.middleware.ts`)**
 *    - `verifyAccountIdParam` + `enforceRequestAccountAccess` on TikTok shop/data/finance/ads/auth routes.
 *    - `userCanAccessAccount` → `check_user_account_access` (service role only; not callable from the browser).
 *    - Writes (non-sync) → `check_user_account_write_access` (Seller User denied on seller tenant).
 *
 * 3. **UI convenience RPCs (`authenticated` only, SECURITY INVOKER)**
 *    - `user_can_access_account` — same rule as read visibility; used to show Unauthorized before mounting shop UI.
 *      **Not** sufficient alone: bypassing the UI still cannot read shop rows if RLS is correct.
 *    - `user_can_write_shop_account` — used for button gating *and* embedded in RLS on some tables
 *      (`agency_fees`, `affiliate_settlements`). Still not a substitute for API checks on mutations
 *      that go through Express.
 *
 * ## Frontend usage
 *
 * - `ShopPage` — `user_can_access_account` after resolving shop via RLS-filtered `tiktok_shops` query.
 * - `useShopAccessFlags` — `user_can_access_account` / `user_can_write_shop_account` for sync vs mutate buttons.
 * - Shop data mutations — always `shopApi` → Express routes with account middleware + entitlements.
 *
 * See also: `supabase/migrations/20260515210000_document_account_access_security_model.sql`
 *
 * ## Sessions / logout
 *
 * Access tokens are short-lived JWTs. `signOut({ scope: 'global' })` removes the session from
 * `auth.sessions`. PostgREST (`validate_active_auth_session` migration) and Express
 * (`resolveUserIdFromBearerToken`) reject bearer tokens whose `session_id` no longer exists,
 * so replayed cURL after logout should fail even before JWT expiry.
 */

export {};
