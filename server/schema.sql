-- Enable UUID extension if not already enabled
create extension if not exists "uuid-ossp";

-- 1. Shop Orders Table
create table if not exists shop_orders (
    id uuid default uuid_generate_v4() primary key,
    shop_id text not null, -- TikTok Shop ID
    account_id uuid references accounts(id) on delete cascade,
    order_id text not null unique, -- TikTok Order ID
    order_status text not null,
    order_amount decimal(10, 2),
    currency text default 'USD',
    payment_method text,
    shipping_provider text,
    tracking_number text,
    buyer_uid text,
    created_time bigint, -- Timestamp from TikTok
    updated_time bigint, -- Timestamp from TikTok
    line_items jsonb, -- Store line items as JSON for flexibility
    recipient_address jsonb, -- Store address as JSON
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Index for faster queries
create index if not exists idx_shop_orders_account_id on shop_orders(account_id);
create index if not exists idx_shop_orders_shop_id on shop_orders(shop_id);
create index if not exists idx_shop_orders_status on shop_orders(order_status);
create index if not exists idx_shop_orders_created_time on shop_orders(created_time);

-- 2. Shop Products Table
create table if not exists shop_products (
    id uuid default uuid_generate_v4() primary key,
    shop_id text not null,
    account_id uuid references accounts(id) on delete cascade,
    product_id text not null unique,
    name text not null,
    sku text,
    description text,
    status text, -- active, inactive, frozen, etc.
    price decimal(10, 2),
    currency text default 'USD',
    stock_quantity integer,
    sales_count integer default 0,
    view_count integer default 0,
    main_image_url text,
    created_time bigint,
    updated_time bigint,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_shop_products_account_id on shop_products(account_id);
create index if not exists idx_shop_products_shop_id on shop_products(shop_id);

-- 3. Shop Settlements Table (Financials)
create table if not exists shop_settlements (
    id uuid default uuid_generate_v4() primary key,
    shop_id text not null,
    account_id uuid references accounts(id) on delete cascade,
    settlement_id text not null unique,
    settlement_time bigint,
    currency text default 'USD',
    settlement_amount decimal(10, 2), -- Net amount paid to seller
    revenue_amount decimal(10, 2), -- Gross revenue
    fee_amount decimal(10, 2), -- Total fees deducted
    adjustment_amount decimal(10, 2), -- Any adjustments
    status text, -- paid, processing, failed
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_shop_settlements_account_id on shop_settlements(account_id);
create index if not exists idx_shop_settlements_time on shop_settlements(settlement_time);

-- 4. Shop Performance Table (Daily Metrics)
create table if not exists shop_performance (
    id uuid default uuid_generate_v4() primary key,
    shop_id text not null,
    account_id uuid references accounts(id) on delete cascade,
    date date not null,
    gross_revenue decimal(10, 2) default 0,
    net_revenue decimal(10, 2) default 0,
    orders_count integer default 0,
    average_order_value decimal(10, 2) default 0,
    items_sold integer default 0,
    refunds_count integer default 0,
    refunds_amount decimal(10, 2) default 0,
    views_count integer default 0,
    conversion_rate decimal(5, 4) default 0, -- 0.0000 to 1.0000
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(shop_id, date) -- Ensure one record per shop per day
);

create index if not exists idx_shop_performance_account_id on shop_performance(account_id);
create index if not exists idx_shop_performance_date on shop_performance(date);

-- RLS Policies (Row Level Security)
alter table shop_orders enable row level security;
alter table shop_products enable row level security;
alter table shop_settlements enable row level security;
alter table shop_performance enable row level security;

-- Policy: Users can view data for accounts they have access to
create policy "Users can view orders for their accounts"
    on shop_orders for select
    using (
        exists (
            select 1 from user_accounts
            where user_accounts.account_id = shop_orders.account_id
            and user_accounts.user_id = auth.uid()
        )
    );

create policy "Users can view products for their accounts"
    on shop_products for select
    using (
        exists (
            select 1 from user_accounts
            where user_accounts.account_id = shop_products.account_id
            and user_accounts.user_id = auth.uid()
        )
    );

create policy "Users can view settlements for their accounts"
    on shop_settlements for select
    using (
        exists (
            select 1 from user_accounts
            where user_accounts.account_id = shop_settlements.account_id
            and user_accounts.user_id = auth.uid()
        )
    );

create policy "Users can view performance for their accounts"
    on shop_performance for select
    using (
        exists (
            select 1 from user_accounts
            where user_accounts.account_id = shop_performance.account_id
            and user_accounts.user_id = auth.uid()
        )
    );
