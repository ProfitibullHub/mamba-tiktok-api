# API Endpoints

All product endpoints are served by Express under `/api/tiktok-shop/`. The route file is `server/src/routes/tiktok-shop-data.routes.ts`.

## How auth works

Every request that touches TikTok needs a valid access token. The flow:

1. Request comes in with an `accountId`
2. `getShopWithToken()` looks up the shop — checks an in-memory cache first (5min TTL), then hits the `tiktok_shops` table
3. If the access token is about to expire (within 5 minutes), it refreshes automatically
4. Endpoints that call TikTok are wrapped in `executeWithRefresh()`, which handles 401s by refreshing the token and retrying once

```
Frontend (React / Zustand)
    │
    │  axios
    ▼
Express Server
    ├── Routes (tiktok-shop-data.routes.ts)
    ├── Services (tiktok-shop-api.service.ts → TikTok API)
    └── Supabase client → PostgreSQL
```

## Reading product data

### `GET /shop-data/:accountId`

This is the primary data endpoint — it powers the whole dashboard. Returns products, orders, and settlements together in one shot.

Query params: `shopId` (optional), `startDate`, `endDate` (both YYYY-MM-DD, optional)

Products come back without any date filtering (you always get the full catalogue). Orders are filtered to `paid_time` within the date range, settlements to `settlement_time`. If the product cache is older than 30 minutes the response will flag it, and if it's over 24 hours a background sync kicks off automatically.

Example response:
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "product_id": "1729384756",
        "product_name": "Widget Pro",
        "status": "ACTIVATE",
        "price": 29.99,
        "currency": "USD",
        "stock": 150,
        "sales_count": 45,
        "main_image_url": "https://...",
        "images": ["https://..."],
        "click_through_rate": 0.0342,
        "gmv": 1349.55,
        "orders_count": 45,
        "cogs": 8.50,
        "shipping_cost": 3.25,
        "is_fbt": false,
        "fbt_source": "auto",
        "details": {},
        "skus": [
          {
            "id": "sku_001",
            "seller_sku": "WP-BLK-SM",
            "price": { "currency": "USD", "sale_price": "27.99", "tax_exclusive_price": "29.99" },
            "inventory": [{ "quantity": 150, "warehouse_id": "wh_001" }],
            "sales_attributes": [{ "name": "Color", "value_name": "Black" }]
          }
        ]
      }
    ],
    "orders": [],
    "settlements": [],
    "cacheStatus": { "productsLastSynced": "2025-01-15T10:00:00Z" },
    "syncStats": { "products": { "fetched": 50, "upserted": 50 } }
  }
}
```

### `GET /products/:accountId`

Hits TikTok's search API directly for real-time data. Supports `page` and `pageSize` query params (defaults: page 1, 20 per page). Also triggers a background sync to persist the data locally. Use this when you need fresh-from-TikTok data rather than our cached version.

### `GET /products/synced/:accountId`

Returns products from our database. Faster since it doesn't hit TikTok. Same data shape as what comes back from `/shop-data`. Takes an optional `shopId` query param.

### `GET /products/:productId/tiktok-details`

Fetches the full detail blob for a single product from TikTok. Requires `accountId` as a query param.

### `GET /products/:productId/cost-history`

Returns the full timeline of cost changes for a product. Optional `costType` query param to filter to just `cogs` or just `shipping`.

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "cost_type": "cogs",
      "amount": 8.50,
      "effective_date": "2025-01-01",
      "end_date": null,
      "notes": "Cost updated via dashboard (specific_date)",
      "created_at": "2025-01-15T10:00:00Z"
    }
  ]
}
```

### `GET /products/:productId/cost-at-date`

Point-in-time cost lookup. Give it a `date` query param (YYYY-MM-DD) and it returns what the COGS and shipping cost were on that date. This is what the P&L calculations use to attribute costs accurately to historical orders.

```json
{
  "success": true,
  "data": { "cogs": 8.50, "shipping": 3.25, "effective_date": "2025-01-01" }
}
```

### `GET /warehouses/:accountId`

Returns available warehouses from TikTok. Needed for the inventory editing UI.

### `GET /categories/:accountId`

Returns TikTok's product category tree. The endpoint exists but there's no UI consuming it yet.

## Updating products

### `PATCH /products/:productId/costs`

Updates COGS, shipping cost, and/or FBT status on a product. This is the workhorse for cost management.

Body fields:
- `accountId` (required)
- `cogs` — number or null
- `shipping_cost` — number or null
- `is_fbt` — boolean
- `applyFrom` — `'today'`, `'backdate'`, or `'specific_date'`
- `effectiveDate` — YYYY-MM-DD, used when backdating

What happens on the backend: it updates the `shop_products` row, and if `applyFrom` isn't `'today'`, it also closes out the current cost history record and inserts a new one with the specified effective date. Setting `is_fbt` also flips `fbt_source` to `'manual'` so auto-sync won't overwrite it.

### `PATCH /products/:productId/sku-costs`

Same idea as above but for a specific SKU variant. Takes an additional `skuId` in the body. The cost history records get the `sku_id` set so they're scoped to that variant.

### `POST /products/:productId/partial-edit`

Edits product content on TikTok — title, description, images. This is the preferred edit method because it doesn't trigger TikTok's full product audit (which can temporarily take the listing down).

Body: `accountId` (required), plus any of `title`, `description`, `main_images` (array of `{uri}` from the upload endpoint), `skus`.

If the title changes, we also update `shop_products.name` locally.

### `POST /products/:productId/inventory`

Updates stock quantities. Goes to TikTok for the actual inventory change (which is instant, no review period), then updates our local `shop_products.stock_quantity` with the total across all warehouses.

Body format:
```json
{
  "accountId": "uuid",
  "skus": [
    {
      "id": "sku_001",
      "inventory": [
        { "warehouse_id": "wh_001", "quantity": 200 }
      ]
    }
  ]
}
```

Every SKU needs an `id`, every inventory item needs a `warehouse_id` and a non-negative `quantity`. The endpoint validates all of this before making the API call.

### `POST /products/:productId/prices`

Updates pricing per SKU on TikTok. Each SKU in the array needs an `id` and at least one of `original_price` or `sale_price` (as strings). After updating TikTok, the first SKU's price gets written back to `shop_products.price`.

## Bulk operations

All three of these take `accountId` and a `productIds` string array in the body. They hit TikTok first, then update the local DB status to match.

### `POST /products/tiktok-activate`
Sets status to `ACTIVATE`.

### `POST /products/tiktok-deactivate`
Sets status to `SELLER_DEACTIVATED`.

### `POST /products/tiktok-delete`
Sets status to `DELETED`.

## Media

### `POST /images/upload`

Uploads an image to TikTok's CDN. You can send either `imageData` (base64) or `imageUrl` (and we'll fetch it). Also takes `fileName` (defaults to `image.jpg`) and `useCase` (`MAIN_IMAGE` or `SKU_IMAGE`).

Returns a URI like `tos-us-i-xxxx/image_id` that you pass into the `main_images` array on a `partial-edit` call.

## Sync

### `POST /sync/:accountId`

Triggers a full sync from TikTok. Optional body params: `shopId` (specific shop) and `syncType` (`products`, `orders`, `settlements`, or `all`).

The product sync pipeline:
1. Fetch the product list from TikTok (paginated at 100/page)
2. Fetch full details for each product in parallel (5 concurrent requests)
3. Pull performance metrics (CTR, GMV, order counts)
4. Batch upsert into `shop_products` (20 per batch)
5. Update `products_last_synced_at` on the shop record

The upsert is careful to preserve `cogs`, `shipping_cost`, and manually-set `is_fbt`. User data survives the sync.

### `GET /sync/cron`

Called by an external scheduler. Syncs all active shops. Same pipeline as above but runs across every shop.

## Error format

All endpoints use the same error shape:

```json
{
  "success": false,
  "error": "Something went wrong",
  "code": "TIKTOK_ERROR_CODE",
  "requestId": "tiktok-request-id"
}
```

Status codes: 200 for success, 400 for validation errors, 404 when a resource isn't found, 500 for server/TikTok API errors.

# Ads API Endpoints

Served under `/api/tiktok-ads/`. The route file is `server/src/routes/tiktok-ads.routes.ts`.

## Auth

### `POST /auth/start`
Generates the TikTok OAuth URL. You pass it an `accountId` and it returns the URL to redirect the user to.

### `GET /auth/callback`
The OAuth callback handler. Exchanges the code for an access token, fetches the advertiser info, and saves it to `tiktok_advertisers`. Redirects back to the frontend.

### `GET /status/:accountId`
Checks if we have a valid connected ad account for this user. Returns `connected: true/false` and the advertiser info if connected.

## Data & Sync

### `POST /sync/:accountId`
Triggers a full sync of ads data.
1.  Fetches Campaigns, Ad Groups, and Ads (pages through everything).
2.  Fetches performance metrics (spend, impressions, clicks, conversions, etc.) for the last 365 days (or requested range).
3.  Fetches daily spend aggregation.
4.  Upserts everything to the DB.
5.  Returns a summary of what was synced.

### `GET /overview/:accountId`
Returns the high-level dashboard stats.
-   **Aggregates** total spend, impressions, clicks, conversions, etc. from the `tiktok_ad_metrics` table.
-   **Calculates** rates like CTR, CPC, ROAS on the fly from the aggregated totals.
-   Returns `active` vs `total` campaign counts.

### `GET /spend/:accountId`
Returns daily spend data for charting.
-   Query params: `startDate`, `endDate`.
-   Returns an array of daily records (date, spend, impressions, etc.) plus a totals summary object.

### `GET /campaigns/:accountId`
Returns a list of all campaigns with their aggregated metrics for the selected date range.
-   Useful for the "Campaigns" table view.
-   Computes metrics by summing up the `tiktok_ad_metrics` rows for each campaign.

### `GET /assets/:accountId`
Returns the full hierarchy: Campaigns -> Ad Groups -> Ads.
-   Used for detailed breakdown views.
-   Aggregates metrics at every level (Ad -> Group -> Campaign) so you can see performance at any depth.
-   Includes `last_active` dates for ads.

### `GET /historical/:accountId`
Returns ad-level performance data for a specific date range.
-   Used for "Top Ads" or detailed analysis.
-   Groups metrics by Ad ID and calculates derived stats (CTR, CPC, etc.).

