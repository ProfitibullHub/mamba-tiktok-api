# Mamba Catalogue Blueprint

This is the technical reference for the catalogue system. It covers everything you'd need to build it from scratch or extend what's already here.

## Documents

- [Database Schema](./01-DATABASE-SCHEMA.md) — tables, columns, indexes, RLS, JSONB structures, migrations
- [API Endpoints](./02-API-ENDPOINTS.md) — REST endpoints, request/response contracts, auth flow
- [Call Pathways](./03-CALL-PATHWAYS.md) — how data moves through the system end-to-end, caching, date handling
- [Frontend Components](./04-FRONTEND-COMPONENTS.md) — component hierarchy, props, store dependencies, TypeScript types

## Stack

The frontend is React + TypeScript, bundled with Vite. State lives in a Zustand store (`useShopStore`). The server is Express running on Node, talking to Supabase (PostgreSQL) for persistence and the TikTok Shop API (v202502) for product data. Auth goes through Supabase Auth on our side and TikTok OAuth2 for shop access.

## How the data fits together

There are six main tables. `shop_products` is the catalogue itself — one row per product. `product_cost_history` tracks COGS and shipping cost changes over time with date ranges so we can backdate. `shop_orders` has order data, and each order's `line_items` JSONB references products by `product_id` — that's how we connect sales back to the catalogue. `shop_settlements` and `shop_performance` round out the financial and analytics side. Everything hangs off `tiktok_shops` which holds OAuth tokens and sync state.

## API surface

The product endpoints break down into a few groups:

**Reads** — 6 endpoints for fetching products, details, cost history, warehouses, and categories. The main one is `GET /shop-data/:accountId` which returns products + orders + settlements in a single call.

**Writes** — 5 endpoints for updating costs (product-level and SKU-level), editing content (title/description/images), inventory, and prices.

**Bulk ops** — activate, deactivate, delete. These hit TikTok first, then update our local DB to match.

**Media** — image upload, returns a URI you use in subsequent edit calls.

**Sync** — manual trigger and cron job that pulls fresh data from TikTok.

## What's built vs what's not

Everything around browsing, editing, and managing existing products is done — search, filtering, detail views, inline cost editing, bulk actions, image management, performance charts, background sync, the whole thing.

What's missing: there's no way to *create* products through our system (they only come in via TikTok sync). No category/collection management UI (the endpoint exists but nothing consumes it). No bulk import/export, no reviews tracking, no barcode management, no variant creation from our side.

## Architecture decisions worth knowing

**Products don't get date-filtered.** The full catalogue loads every time. Only orders and settlements are scoped to whatever date range the user picks.

**TikTok is the source of truth** for product data (title, images, status, inventory). We write to TikTok first, then mirror locally. But COGS and shipping costs are ours — users enter those manually and they survive syncs. The `fbt_source` field tracks whether the fulfillment type came from the API or was set by hand.

**Cost history makes backdating possible.** The `product_cost_history` table uses `effective_date`/`end_date` ranges. When P&L calculations need the cost for an order from three weeks ago, they can look up what the COGS was on that specific date. If there's no history entry, it falls back to the current value on `shop_products`.

**The UI does optimistic updates** for cost changes. If you set COGS to $8.50 effective today, the store updates immediately and the API call fires in the background. Future-dated costs skip the optimistic update since they shouldn't affect the current display.

**Sync won't clobber user data.** The upsert during `syncProducts()` deliberately skips overwriting `cogs`, `shipping_cost`, and manually-set `is_fbt`. User enrichments are safe across sync cycles.
