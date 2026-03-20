-- =====================================================
-- Mamba TikTok Shop - Clean Database Schema
-- =====================================================
-- This creates ONLY the TikTok Shop tables for a fresh Supabase project
-- Run this in your new Supabase SQL Editor

-- =====================================================
-- Prerequisites: Ensure you have these tables from Supabase Auth
-- =====================================================
-- The following tables should already exist from Supabase:
-- - auth.users (created by Supabase Auth)
-- 
-- You need to create these core tables first:

-- 1. Profiles table (links to auth.users)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'client' CHECK (role IN ('admin', 'client')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Accounts table (represents TikTok Shop accounts/brands)
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    tiktok_handle TEXT,
    avatar_url TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_agency_view BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. User-Account junction table (which users can access which accounts)
CREATE TABLE IF NOT EXISTS user_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, account_id)
);

-- =====================================================
-- TikTok Shop Tables
-- =====================================================

-- 1. TikTok Shops Table
CREATE TABLE IF NOT EXISTS tiktok_shops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    shop_id TEXT NOT NULL,
    shop_cipher TEXT NOT NULL,
    shop_name TEXT NOT NULL,
    region TEXT,
    seller_type TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    refresh_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(account_id, shop_id)
);

CREATE INDEX idx_tiktok_shops_account_id ON tiktok_shops(account_id);
CREATE INDEX idx_tiktok_shops_shop_id ON tiktok_shops(shop_id);

-- 2. Shop Orders Table
CREATE TABLE IF NOT EXISTS shop_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES tiktok_shops(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL UNIQUE,
    order_status TEXT NOT NULL,
    create_time TIMESTAMP WITH TIME ZONE,
    update_time TIMESTAMP WITH TIME ZONE,
    payment_info JSONB,
    buyer_info JSONB,
    shipping_info JSONB,
    line_items JSONB,
    total_amount DECIMAL(12, 2),
    currency TEXT DEFAULT 'USD',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_shop_orders_shop_id ON shop_orders(shop_id);
CREATE INDEX idx_shop_orders_order_id ON shop_orders(order_id);
CREATE INDEX idx_shop_orders_status ON shop_orders(order_status);
CREATE INDEX idx_shop_orders_create_time ON shop_orders(create_time DESC);

-- 3. Shop Products Table
CREATE TABLE IF NOT EXISTS shop_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES tiktok_shops(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    sku_list JSONB,
    price DECIMAL(12, 2),
    stock INTEGER DEFAULT 0,
    sales_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    images JSONB,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(shop_id, product_id)
);

CREATE INDEX idx_shop_products_shop_id ON shop_products(shop_id);
CREATE INDEX idx_shop_products_product_id ON shop_products(product_id);
CREATE INDEX idx_shop_products_status ON shop_products(status);

-- 4. Shop Settlements Table
CREATE TABLE IF NOT EXISTS shop_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES tiktok_shops(id) ON DELETE CASCADE,
    settlement_id TEXT NOT NULL UNIQUE,
    order_id TEXT,
    settlement_time TIMESTAMP WITH TIME ZONE,
    total_amount DECIMAL(12, 2),
    platform_fee DECIMAL(12, 2) DEFAULT 0,
    shipping_fee DECIMAL(12, 2) DEFAULT 0,
    affiliate_commission DECIMAL(12, 2) DEFAULT 0,
    refund_amount DECIMAL(12, 2) DEFAULT 0,
    adjustment_amount DECIMAL(12, 2) DEFAULT 0,
    net_amount DECIMAL(12, 2),
    currency TEXT DEFAULT 'USD',
    settlement_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_shop_settlements_shop_id ON shop_settlements(shop_id);
CREATE INDEX idx_shop_settlements_settlement_id ON shop_settlements(settlement_id);
CREATE INDEX idx_shop_settlements_order_id ON shop_settlements(order_id);
CREATE INDEX idx_shop_settlements_time ON shop_settlements(settlement_time DESC);

-- 5. Shop Performance Table
CREATE TABLE IF NOT EXISTS shop_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES tiktok_shops(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_orders INTEGER DEFAULT 0,
    total_revenue DECIMAL(12, 2) DEFAULT 0,
    total_items_sold INTEGER DEFAULT 0,
    avg_order_value DECIMAL(12, 2) DEFAULT 0,
    conversion_rate DECIMAL(5, 2) DEFAULT 0,
    shop_rating DECIMAL(3, 2),
    review_count INTEGER DEFAULT 0,
    return_rate DECIMAL(5, 2) DEFAULT 0,
    performance_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(shop_id, date)
);

CREATE INDEX idx_shop_performance_shop_id ON shop_performance(shop_id);
CREATE INDEX idx_shop_performance_date ON shop_performance(date DESC);

-- =====================================================
-- Row Level Security (RLS) Policies
-- =====================================================

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_performance ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id);

-- Accounts policies
CREATE POLICY "Users can view their assigned accounts"
    ON accounts FOR SELECT
    USING (
        id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
        )
    );

-- User accounts policies
CREATE POLICY "Users can view their account assignments"
    ON user_accounts FOR SELECT
    USING (user_id = auth.uid());

-- TikTok Shops policies
CREATE POLICY "Users can view shops for their accounts"
    ON tiktok_shops FOR SELECT
    USING (
        account_id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert shops for their accounts"
    ON tiktok_shops FOR INSERT
    WITH CHECK (
        account_id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update shops for their accounts"
    ON tiktok_shops FOR UPDATE
    USING (
        account_id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete shops for their accounts"
    ON tiktok_shops FOR DELETE
    USING (
        account_id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
        )
    );

-- Shop Orders policies
CREATE POLICY "Users can view orders from their shops"
    ON shop_orders FOR SELECT
    USING (
        shop_id IN (
            SELECT id FROM tiktok_shops WHERE account_id IN (
                SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Users can insert orders to their shops"
    ON shop_orders FOR INSERT
    WITH CHECK (
        shop_id IN (
            SELECT id FROM tiktok_shops WHERE account_id IN (
                SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
            )
        )
    );

-- Shop Products policies
CREATE POLICY "Users can view products from their shops"
    ON shop_products FOR SELECT
    USING (
        shop_id IN (
            SELECT id FROM tiktok_shops WHERE account_id IN (
                SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
            )
        )
    );

-- Shop Settlements policies
CREATE POLICY "Users can view settlements from their shops"
    ON shop_settlements FOR SELECT
    USING (
        shop_id IN (
            SELECT id FROM tiktok_shops WHERE account_id IN (
                SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
            )
        )
    );

-- Shop Performance policies
CREATE POLICY "Users can view performance from their shops"
    ON shop_performance FOR SELECT
    USING (
        shop_id IN (
            SELECT id FROM tiktok_shops WHERE account_id IN (
                SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
            )
        )
    );

-- =====================================================
-- Helper Functions & Triggers
-- =====================================================

-- Auto-calculate net amount for settlements
CREATE OR REPLACE FUNCTION calculate_settlement_net_amount()
RETURNS TRIGGER AS $$
BEGIN
    NEW.net_amount := NEW.total_amount 
        - COALESCE(NEW.platform_fee, 0)
        - COALESCE(NEW.shipping_fee, 0)
        - COALESCE(NEW.affiliate_commission, 0)
        - COALESCE(NEW.refund_amount, 0)
        + COALESCE(NEW.adjustment_amount, 0);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_calculate_settlement_net_amount
    BEFORE INSERT OR UPDATE ON shop_settlements
    FOR EACH ROW
    EXECUTE FUNCTION calculate_settlement_net_amount();

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tiktok_shops_updated_at
    BEFORE UPDATE ON tiktok_shops
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shop_orders_updated_at
    BEFORE UPDATE ON shop_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shop_products_updated_at
    BEFORE UPDATE ON shop_products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shop_settlements_updated_at
    BEFORE UPDATE ON shop_settlements
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shop_performance_updated_at
    BEFORE UPDATE ON shop_performance
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Seed Data (Optional - for testing)
-- =====================================================

-- Create a test account (you'll need to create a user in Supabase Auth first)
-- Then run this with your actual user ID:

-- INSERT INTO profiles (id, email, full_name, role)
-- VALUES ('your-user-id-from-auth', 'test@example.com', 'Test User', 'admin');

-- INSERT INTO accounts (name, tiktok_handle, status)
-- VALUES ('Test Shop', '@testshop', 'active')
-- RETURNING id;

-- INSERT INTO user_accounts (user_id, account_id)
-- VALUES ('your-user-id', 'account-id-from-above');

-- =====================================================
-- Migration Complete!
-- =====================================================
-- Tables created:
--   Core: profiles, accounts, user_accounts
--   TikTok Shop: tiktok_shops, shop_orders, shop_products, 
--                shop_settlements, shop_performance
--
-- Next steps:
--   1. Create a user in Supabase Auth
--   2. Run the seed data queries above with your user ID
--   3. Deploy backend and frontend
--   4. Test OAuth flow
-- =====================================================
