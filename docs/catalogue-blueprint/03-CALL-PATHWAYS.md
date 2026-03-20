# Call Pathways & Data Flow

How data moves through the system for each major user action.

## The four layers

Everything flows through four layers:

**UI Components** — React views and modals that the user interacts with. These live in `src/components/views/` and `src/components/product/`.

**Zustand Store** (`src/store/useShopStore.ts`) — holds products, orders, settlements in memory. Components call store actions, which handle the HTTP calls and state updates.

**Express Server** (`server/src/routes/tiktok-shop-data.routes.ts`) — REST endpoints. Authenticates via `getShopWithToken()`, retries with `retryOperation()` (exponential backoff), and auto-refreshes expired tokens via `executeWithRefresh()`.

**Data layer** — Supabase (PostgreSQL) for persistence, TikTok Shop API (`server/src/services/tiktok-shop-api.service.ts`) for external data.

## Loading the catalogue (initial page load)

When a user opens the dashboard or selects a shop:

1. The view component mounts and calls `useShopStore.fetchShopData(accountId, shopId, options, startDate, endDate)`

2. The store checks `loadedDateRange` — if the requested range is already covered, it serves from cache and skips the fetch entirely. If it partially extends beyond what's loaded, it calculates the gap and only fetches the missing dates.

3. If a fetch is needed, it hits `GET /api/tiktok-shop/shop-data/:accountId` with the date params.

4. On the server, `getShopWithToken()` resolves the TikTok credentials (checking the in-memory cache first, falling back to a DB query). Then three queries run in parallel:
   - `shop_products` — all products, no date filter
   - `shop_orders` — filtered to `paid_time` within the date range, limit 1000, sorted by `paid_time DESC`
   - `shop_settlements` — filtered to `settlement_time` within the range

5. The server also checks `products_last_synced_at`. If it's been more than 30 minutes it flags the response. Over 24 hours and it kicks off a background `syncProducts()`.

6. The response comes back, the store maps the raw data into the `Product[]` interface (field name translations like `product_name` → `name`, `stock` → `stock_quantity`), parses SKUs out of the `details` JSONB, and updates state.

7. Components re-render.

## Updating COGS

When a user changes the COGS in the ProductDetails panel or the ProductCostsModal:

1. Component calls `useShopStore.updateProductCosts(productId, { cogs: 8.50, applyFrom: 'specific_date', effectiveDate: '2025-01-01', accountId })`.

2. If the effective date is today or in the past, the store does an optimistic update — `products[]` gets updated immediately so the UI reflects the change. Future-dated costs skip this since they shouldn't change the current display.

3. The store fires `PATCH /api/tiktok-shop/products/:productId/costs`.

4. Server validates inputs (COGS must be non-negative or null, accountId required), resolves the shop IDs, then updates the `shop_products` row.

5. If `applyFrom` isn't `'today'`, the server also manages cost history:
   - Closes the existing open record: `UPDATE product_cost_history SET end_date = :effectiveDate WHERE ... AND end_date IS NULL`
   - Inserts a new record with the given `effective_date` and `end_date = NULL`

6. Response comes back confirming the update. If it failed, the store reverts the optimistic change.

## Editing product content

When a user saves changes in the ProductEditModal (title, description, images):

1. Component calls `useShopStore.editProduct(accountId, productId, { title, description, main_images })`.

2. Store hits `POST /api/tiktok-shop/products/:productId/partial-edit`. This uses the partial edit API specifically because it doesn't trigger TikTok's full product audit — a full edit can temporarily take the listing down.

3. Server sends the changes to TikTok via `partialEditProduct()`.

4. If the title changed, the server also updates `shop_products.name` in our DB.

5. Store updates the local product name and components re-render.

## Updating inventory

From the ProductEditModal's Inventory tab:

1. Component calls `useShopStore.updateProductInventory(accountId, productId, skus)` where each SKU has an `id` and `inventory` array with warehouse IDs and quantities.

2. Store hits `POST /api/tiktok-shop/products/:productId/inventory`.

3. Server validates the SKU format (every SKU needs an id, every inventory item needs a warehouse_id, quantities must be >= 0).

4. Sends to TikTok — inventory updates are instant, no review period.

5. Server updates `shop_products.stock_quantity` with the sum of all quantities across all warehouses.

## Updating prices

From the ProductEditModal's Pricing tab:

1. Component calls `useShopStore.updateProductPrices(accountId, productId, skus)` with each SKU having an `id` and either `original_price` or `sale_price` (as strings).

2. Store hits `POST /api/tiktok-shop/products/:productId/prices`.

3. Server validates, sends to TikTok, then updates `shop_products.price` with the first SKU's price.

## Bulk status changes

When a user selects multiple products and clicks Activate / Deactivate / Delete:

1. Component calls the relevant store action (`activateProducts`, `deactivateProducts`, or `deleteProducts`) with the accountId and array of product IDs.

2. Store hits the corresponding endpoint (`/products/tiktok-activate`, `/products/tiktok-deactivate`, or `/products/tiktok-delete`).

3. Server sends the action to TikTok, then updates the local DB statuses to match.

4. For deletions, the products also get removed from the local store array.

## Image upload flow

When a user adds an image in the ProductEditModal:

1. The image gets converted to base64 on the client.

2. `useShopStore.uploadProductImage(accountId, base64Data, fileName, 'MAIN_IMAGE')` fires.

3. Server converts base64 to a buffer and uploads to TikTok's CDN.

4. TikTok returns a URI (like `tos-us-i-xxxx/image_id`).

5. That URI gets stored in the modal's state. When the user saves, it's passed as part of the `main_images` array in the `partial-edit` call.

## Background sync

Triggered automatically when the cache is stale (>24hr) or manually via the Sync button:

1. `POST /api/tiktok-shop/sync/:accountId`

2. Server runs `syncProducts(shop)`:
   - Fetches the full product list from TikTok, paginated at 100/page
   - Fetches details for each product in parallel (5 concurrent)
   - Pulls performance metrics (CTR, GMV, order counts)
   - Batch upserts to `shop_products`, 20 at a time
   - Preserves user data (cogs, shipping_cost, manually-set is_fbt) during upsert
   - Updates `products_last_synced_at`

## Cost-at-date lookup (P&L)

When the finance views need to calculate profit on historical orders:

1. For each line item in an order, the system calls `GET /products/:productId/cost-at-date?accountId=xxx&date=2025-01-15`.

2. Server queries `product_cost_history` for the matching cost record:
   ```sql
   WHERE product_id = :productId AND cost_type = 'cogs'
     AND effective_date <= '2025-01-15'
     AND (end_date IS NULL OR end_date > '2025-01-15')
   ```

3. If a history record exists, that's the cost. If not, it falls back to the current `shop_products.cogs`.

4. P&L: revenue - cogs - shipping - fees = profit.

## Caching

There are two levels:

**Client-side (Zustand):**
- `memoryCache` stores a full snapshot per shop. When you switch shops and switch back, data restores instantly.
- `loadedDateRange` tracks the widest date range that's been loaded. If a new request falls within that range, no fetch needed. If it extends beyond, only the missing gap gets fetched.
- `fetchInProgress` flag prevents duplicate concurrent fetches.

**Server-side:**
- `shopTokenCache` (in-memory Map, 5min TTL) avoids repeated DB lookups for tokens during large sync operations.
- `products_last_synced_at` (DB column) drives freshness decisions: under 30min is fresh, 30min–24hr prompts a background sync, over 24hr triggers an auto-sync.

## Date handling notes

- Shop timezone is hardcoded to `America/Los_Angeles` (should eventually be per-shop).
- Orders filter on `paid_time` (Unix timestamp), not `created_time`.
- Products are never date-filtered. The full catalogue loads every time.
- Settlements filter on `settlement_time` (timestamptz).
- `getShopDayStartTimestamp()` computes shop-local midnight for date boundary comparisons.
- Default data window is 65 days, extended to ~130 days when `includePreviousPeriod` is set for trend comparisons.

## Ads Data Flow

### Connecting an Ad Account

1.  User clicks "Connect TikTok Ads" in the dashboard.
2.  Frontend calls `/api/tiktok-ads/auth/start`. Returns a TikTok OAuth URL.
3.  User is redirected to TikTok, grants permission.
4.  TikTok redirects back to `/api/tiktok-ads/auth/callback`.
5.  Server exchanges code for token, fetches advertiser info, saves to `tiktok_advertisers`.
6.  Server redirects user back to the dashboard with `?tiktok_ads_connected=true`.

### Syncing Ads Data

Triggered manually or on schedule:

1.  `POST /api/tiktok-ads/sync/:accountId`
2.  Server fetches **Campaigns**, **Ad Groups**, and **Ads** (paging through all of them).
    -   Upserts structural data to `tiktok_ad_campaigns` etc. with `status` and `raw_data`.
3.  Server performs a **Unified Metrics Sync**:
    -   Iterates through 30-day chunks going back 1 year.
    -   Fetches Daily Spend, Campaign Metrics, and Ad Metrics in parallel for each chunk.
    -   Upserts metrics to `tiktok_ad_metrics` and `tiktok_ad_spend_daily`.
4.  Updates `last_synced_at`.

### Loading the Marketing Dashboard

1.  `useTikTokAdsStore.fetchOverview(accountId)` -> calls `GET /overview/:accountId`.
    -   Server aggregates `tiktok_ad_metrics` for the date range.
    -   Calculates CTR, CPC, ROAS on the fly.
    -   Returns a fast, single JSON object for the top cards.

2.  `useTikTokAdsStore.fetchSpendData(accountId)` -> calls `GET /spend/:accountId`.
    -   Server queries `tiktok_ad_spend_daily`.
    -   Returns daily array for the big main chart.

3.  `useTikTokAdsStore.fetchCampaigns(accountId)` -> calls `GET /campaigns/:accountId`.
    -   Joins `tiktok_ad_campaigns` with aggregated metrics.
    -   Populates the campaigns table.

