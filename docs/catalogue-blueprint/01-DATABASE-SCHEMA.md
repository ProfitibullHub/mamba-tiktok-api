# Database Schema

Everything lives in Supabase (PostgreSQL). Here's how the tables relate to each other:

```
accounts ──── tiktok_shops (OAuth tokens, sync state)
    │              │
    │              │ shop internal UUID
    │              │
    ├── shop_products ──── product_cost_history
    │        │
    │        └── details JSONB (embedded SKUs, full TikTok data)
    │
    ├── shop_orders
    │        └── line_items JSONB (references product_id)
    │
    ├── shop_settlements
    │
    └── shop_performance
```

## `shop_products`

This is the main catalogue table. One row per product per shop.

```sql
create table shop_products (
    id                  uuid primary key default uuid_generate_v4(),
    shop_id             text not null,              -- TikTok Shop ID (external)
    account_id          uuid references accounts(id) on delete cascade,
    product_id          text not null unique,       -- TikTok product ID, globally unique
    name                text not null,              -- product title
    sku                 text,                       -- primary SKU identifier
    description         text,                       -- HTML description
    status              text,                       -- ACTIVATE, SELLER_DEACTIVATED, FROZEN, DELETED
    price               decimal(10,2),              -- display price (from primary SKU)
    currency            text default 'USD',
    stock_quantity      integer,                    -- total across all warehouses
    sales_count         integer default 0,
    cogs                decimal(10,2) default null, -- cost of goods sold per unit (user-entered)
    shipping_cost       decimal(10,2) default null, -- manual shipping cost per unit
    is_fbt              boolean default false,      -- fulfilled by TikTok
    fbt_source          text default 'auto',        -- 'auto' (from API) or 'manual' (user override)
    view_count          integer default 0,
    click_through_rate  decimal(5,4) default 0,     -- 0.0000 to 1.0000
    gmv                 decimal(10,2) default 0,    -- gross merchandise value
    orders_count        integer default 0,
    main_image_url      text,
    images              text[],                     -- additional image URLs
    details             jsonb,                      -- full product JSON from TikTok API
    created_time        bigint,                     -- unix timestamp from TikTok
    updated_time        bigint,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);
```

Indexed on `account_id` and `shop_id`. The `product_id` column has a unique constraint so upserts during sync work correctly.

The `details` JSONB column is the big one — it stores the complete TikTok product response. That includes all SKU variants with their pricing and inventory, category info, package dimensions, compliance data, everything. We pull SKUs out of this blob when the frontend needs them.

The `cogs`, `shipping_cost`, and `is_fbt` columns are our own enrichments on top of TikTok data. They're explicitly preserved during sync upserts — TikTok doesn't know about our cost data and we don't want sync to blow it away.

## `product_cost_history`

This is what makes cost backdating work. When someone changes the COGS or shipping cost, we don't just update the current value — we also create a time-ranged record here so we can look up what the cost was on any given date.

```sql
create table product_cost_history (
    id              uuid primary key default gen_random_uuid(),
    shop_id         uuid references tiktok_shops(id) on delete cascade,
    product_id      text not null,
    sku_id          text default null,              -- null = product-level, non-null = specific SKU
    cost_type       text not null default 'cogs',   -- 'cogs', 'shipping', or 'other'
    amount          decimal(10,2) not null,
    effective_date  date not null,                   -- when this cost starts applying
    end_date        date,                            -- null means it's still active
    notes           text,
    created_at      timestamptz not null default now(),
    created_by      uuid
);
```

The compound index on `(shop_id, product_id, sku_id, cost_type, effective_date)` is what makes lookups fast. There's also a unique constraint on `(shop_id, product_id, cost_type, effective_date)` to prevent overlapping records.

How the temporal logic works: a record with `end_date = NULL` is the currently active cost. When a new cost gets set, we close out the previous record by setting its `end_date` to the new record's `effective_date`. To find the cost on a specific date:

```sql
WHERE effective_date <= :target_date
  AND (end_date IS NULL OR end_date > :target_date)
ORDER BY effective_date DESC
LIMIT 1
```

If nothing comes back, the system falls back to whatever's in `shop_products.cogs`.

## `shop_orders`

Order records from TikTok. The connection to products happens through the `line_items` JSONB column — each line item has a `product_id` that matches back to the catalogue.

```sql
create table shop_orders (
    id                  uuid primary key default uuid_generate_v4(),
    shop_id             text not null,
    account_id          uuid references accounts(id) on delete cascade,
    order_id            text not null unique,
    order_status        text not null,          -- PAID, SHIPPED, DELIVERED, CANCELLED, etc.
    order_amount        decimal(10,2),
    currency            text default 'USD',
    payment_method      text,
    shipping_provider   text,
    tracking_number     text,
    buyer_uid           text,
    fulfillment_type    text default 'FULFILLMENT_BY_SELLER',
    is_fbt              boolean default false,
    fbt_fulfillment_fee decimal(10,2),          -- actual FBT fee from Finance API
    shipping_fee        decimal(10,2),          -- customer-paid shipping
    shipping_fee_offset decimal(10,2),          -- TikTok shipping offset/subsidy
    warehouse_id        text,
    line_items          jsonb,                  -- array of product references
    recipient_address   jsonb,
    created_time        bigint,
    updated_time        bigint,
    paid_time           bigint,                 -- THIS is the primary date filter, not created_time
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);
```

Indexed on `account_id`, `shop_id`, `order_status`, and `created_time`. Worth noting: all date filtering in the app uses `paid_time`, not `created_time`. That's an intentional choice — we care about when money changed hands, not when the order was placed.

## `shop_settlements`

Financial settlement records from TikTok. Each settlement links back to an order via `order_id`.

```sql
create table shop_settlements (
    id                    uuid primary key default uuid_generate_v4(),
    shop_id               text not null,
    account_id            uuid references accounts(id) on delete cascade,
    settlement_id         text not null unique,
    order_id              text,                       -- links to shop_orders
    settlement_time       timestamptz,                -- when it was processed
    currency              text default 'USD',
    total_amount          decimal(10,2),              -- gross revenue
    net_amount            decimal(10,2),              -- what the seller actually gets
    fee_amount            decimal(10,2),              -- TikTok's cut
    adjustment_amount     decimal(10,2),
    shipping_fee          decimal(10,2),
    net_sales_amount      decimal(10,2),
    settlement_data       jsonb,                      -- raw TikTok response
    transaction_summary   jsonb,                      -- aggregated breakdown
    transactions_synced_at timestamptz,
    status                text,                       -- paid, processing, failed
    created_at            timestamptz not null default now(),
    updated_at            timestamptz
);
```

## `shop_performance`

Daily aggregated metrics per shop. One row per shop per day (enforced by unique constraint).

```sql
create table shop_performance (
    id                  uuid primary key default uuid_generate_v4(),
    shop_id             text not null,
    account_id          uuid references accounts(id) on delete cascade,
    date                date not null,
    gross_revenue       decimal(10,2) default 0,
    net_revenue         decimal(10,2) default 0,
    orders_count        integer default 0,
    average_order_value decimal(10,2) default 0,
    items_sold          integer default 0,
    refunds_count       integer default 0,
    refunds_amount      decimal(10,2) default 0,
    views_count         integer default 0,
    conversion_rate     decimal(5,4) default 0,
    created_at          timestamptz not null default now(),
    unique(shop_id, date)
);
```

## `tiktok_shops`

The parent config table. Stores OAuth tokens, shop metadata, and sync timestamps. Referenced by `product_cost_history.shop_id` (via internal UUID, not the external TikTok shop ID).

Key columns for catalogue purposes:
- `id` — internal UUID, what cost history references
- `shop_id` — TikTok's external shop identifier
- `access_token` / `refresh_token` — OAuth credentials for API calls
- `shop_cipher` — TikTok API encryption key
- `products_last_synced_at` — when we last pulled product data (drives auto-sync decisions)
- `timezone` — defaults to `America/Los_Angeles`, should eventually be configurable per shop

## `tiktok_advertisers` (Ads)

The parent table for Ads integration, similar to `tiktok_shops` but for the Marketing API. Stores OAuth creds for an ad account.

```sql
create table tiktok_advertisers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    advertiser_id TEXT NOT NULL UNIQUE,  -- The TikTok ad account ID
    advertiser_name TEXT,
    app_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    access_token_expires_at TIMESTAMPTZ,
    company TEXT,
    currency TEXT DEFAULT 'USD',
    timezone TEXT DEFAULT 'UTC',
    balance DECIMAL(15,2) DEFAULT 0,
    last_synced_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## `tiktok_ad_campaigns`

Stores campaign structure.

```sql
create table tiktok_ad_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID REFERENCES tiktok_advertisers(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL UNIQUE,
    campaign_name TEXT NOT NULL,
    objective_type TEXT,                -- TRAFFIC, CONVERSIONS, etc.
    status TEXT,                        -- ENABLE, DISABLE, DELETE
    budget DECIMAL(15,2),
    budget_mode TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ
);
```

## `tiktok_ad_groups`

The ad set level, sitting between campaigns and ads. Contains targeting and bidding info.

```sql
create table tiktok_ad_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID REFERENCES tiktok_advertisers(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES tiktok_ad_campaigns(id) ON DELETE CASCADE,
    adgroup_id TEXT NOT NULL UNIQUE,
    adgroup_name TEXT NOT NULL,
    status TEXT,
    budget DECIMAL(15,2),
    bid_type TEXT,
    bid_price DECIMAL(15,2),
    optimization_goal TEXT,
    location_ids TEXT[],
    age_groups TEXT[],
    gender TEXT,
    schedule_start_time TIMESTAMPTZ,
    schedule_end_time TIMESTAMPTZ,
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ
);
```

## `tiktok_ads`

The actual creatives (videos/images).

```sql
create table tiktok_ads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID REFERENCES tiktok_advertisers(id) ON DELETE CASCADE,
    adgroup_id UUID REFERENCES tiktok_ad_groups(id) ON DELETE CASCADE,
    ad_id TEXT NOT NULL UNIQUE,
    ad_name TEXT NOT NULL,
    ad_format TEXT,                     -- VIDEO, IMAGE
    ad_text TEXT,
    call_to_action TEXT,
    landing_page_url TEXT,
    video_id TEXT,
    image_ids TEXT[],
    status TEXT,
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ
);
```

## `tiktok_ad_metrics`

Daily performance metrics. This is a polymorphic table that stores stats for Campaigns, Ad Groups, AND Ads in one place, distinguished by `dimension_type`.

```sql
create table tiktok_ad_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID REFERENCES tiktok_advertisers(id) ON DELETE CASCADE,
    
    dimension_type TEXT NOT NULL,       -- 'CAMPAIGN', 'ADGROUP', 'AD'
    dimension_id UUID NOT NULL,         -- Links to the respective table's internal UUID
    
    stat_date DATE NOT NULL,
    stat_datetime TIMESTAMPTZ NOT NULL,
    
    -- Core metrics
    impressions BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    reach BIGINT DEFAULT 0,
    frequency DECIMAL(10,2) DEFAULT 0,
    
    -- Engagement
    likes BIGINT DEFAULT 0,
    comments BIGINT DEFAULT 0,
    shares BIGINT DEFAULT 0,
    follows BIGINT DEFAULT 0,
    video_views BIGINT DEFAULT 0,
    video_watched_2s BIGINT DEFAULT 0,
    
    -- Money
    spend DECIMAL(15,2) DEFAULT 0,
    cpc DECIMAL(10,4) DEFAULT 0,
    cpm DECIMAL(10,4) DEFAULT 0,
    
    -- Conversions
    conversions BIGINT DEFAULT 0,
    conversion_rate DECIMAL(10,4) DEFAULT 0,
    cost_per_conversion DECIMAL(15,4) DEFAULT 0,
    conversion_value DECIMAL(15,2) DEFAULT 0,
    
    currency TEXT DEFAULT 'USD',
    
    unique(advertiser_id, dimension_type, dimension_id, stat_date)
);
```

## `tiktok_ad_spend_daily`

A high-level daily aggregation for the "Spend" charts. It's essentially a rollup of account-level spend per day.

```sql
create table tiktok_ad_spend_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID REFERENCES tiktok_advertisers(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    
    spend_date DATE NOT NULL,
    total_spend DECIMAL(15,2) DEFAULT 0,
    total_impressions BIGINT DEFAULT 0,
    total_clicks BIGINT DEFAULT 0,
    total_conversions BIGINT DEFAULT 0,
    conversion_value DECIMAL(15,2) DEFAULT 0,
    
    currency TEXT DEFAULT 'USD',
    
    unique(advertiser_id, spend_date)
);
```

## Row-Level Security

RLS is on for all the data tables. The policy is the same everywhere — you can only see rows where the `account_id` matches an account you have access to via the `user_accounts` join table:

```sql
create policy "Users can view products for their accounts"
    on shop_products for select
    using (
        exists (
            select 1 from user_accounts
            where user_accounts.account_id = shop_products.account_id
            and user_accounts.user_id = auth.uid()
        )
    );
```

Same pattern on `shop_orders`, `shop_settlements`, `shop_performance`, and all the `tiktok_ad_*` tables.

## JSONB Structures

These aren't separate tables but they're important to understand since they carry a lot of the product detail.

**SKU data** (embedded in `shop_products.details`):

```json
{
  "id": "sku_12345",
  "seller_sku": "WIDGET-BLK-SM",
  "price": {
    "currency": "USD",
    "sale_price": "19.99",
    "tax_exclusive_price": "24.99"
  },
  "inventory": [
    { "quantity": 150, "warehouse_id": "wh_001" }
  ],
  "sales_attributes": [
    {
      "id": "attr_color", "name": "Color",
      "value_id": "val_black", "value_name": "Black",
      "sku_img": { "urls": ["https://..."] }
    },
    {
      "id": "attr_size", "name": "Size",
      "value_id": "val_small", "value_name": "Small"
    }
  ]
}
```

**Order line items** (embedded in `shop_orders.line_items`):

```json
{
  "product_id": "prod_12345",
  "product_name": "Widget Pro",
  "sku_id": "sku_12345",
  "sku_name": "Black / Small",
  "quantity": 2,
  "sale_price": "19.99",
  "original_price": "24.99",
  "product_image": "https://..."
}
```

## Migrations

The schema was built up incrementally. Here's the order things were added:

1. `server/schema.sql` — base tables (products, orders, settlements, performance)
2. `add_product_columns.sql` — `click_through_rate`, `gmv`, `orders_count` on products
3. `add_cogs_column.sql` — initial COGS support
4. `add_cost_history_and_shipping.sql` — the `product_cost_history` table, plus `shipping_cost` and `is_fbt` on products
5. `add_fbt_source.sql` — `fbt_source` column so we know if FBT was auto-detected or manually set
6. `add_details_column.sql` — `details` JSONB for storing the full TikTok product blob
7. `add_sku_cost_history_support.sql` — `sku_id` on cost history so we can track per-variant costs
8. `create_tiktok_ads_tables.sql` — added `tiktok_advertisers`, `tiktok_ad_campaigns` etc. for marketing integration
