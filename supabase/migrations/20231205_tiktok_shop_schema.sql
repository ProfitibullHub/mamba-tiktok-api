-- =====================================================
-- Mamba TikTok Shop Database Migration
-- =====================================================
-- This migration creates the schema for TikTok Shop data
-- Run this in your Supabase SQL Editor

-- =====================================================
-- 1. TikTok Shops Table
-- =====================================================
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

-- Index for faster lookups
CREATE INDEX idx_tiktok_shops_account_id ON tiktok_shops(account_id);
CREATE INDEX idx_tiktok_shops_shop_id ON tiktok_shops(shop_id);

-- =====================================================
-- 2. Shop Orders Table
-- =====================================================
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

-- Indexes
CREATE INDEX idx_shop_orders_shop_id ON shop_orders(shop_id);
CREATE INDEX idx_shop_orders_order_id ON shop_orders(order_id);
CREATE INDEX idx_shop_orders_status ON shop_orders(order_status);
CREATE INDEX idx_shop_orders_create_time ON shop_orders(create_time DESC);

-- =====================================================
-- 3. Shop Products Table
-- =====================================================
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

-- Indexes
CREATE INDEX idx_shop_products_shop_id ON shop_products(shop_id);
CREATE INDEX idx_shop_products_product_id ON shop_products(product_id);
CREATE INDEX idx_shop_products_status ON shop_products(status);

-- =====================================================
-- 4. Shop Settlements Table
-- =====================================================
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

-- Indexes
CREATE INDEX idx_shop_settlements_shop_id ON shop_settlements(shop_id);
CREATE INDEX idx_shop_settlements_settlement_id ON shop_settlements(settlement_id);
CREATE INDEX idx_shop_settlements_order_id ON shop_settlements(order_id);
CREATE INDEX idx_shop_settlements_time ON shop_settlements(settlement_time DESC);

-- =====================================================
-- 5. Shop Performance Table
-- =====================================================
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

-- Indexes
CREATE INDEX idx_shop_performance_shop_id ON shop_performance(shop_id);
CREATE INDEX idx_shop_performance_date ON shop_performance(date DESC);

-- =====================================================
-- Row Level Security (RLS) Policies
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE tiktok_shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_performance ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access shops linked to their accounts
CREATE POLICY "Users can view their own shops"
    ON tiktok_shops FOR SELECT
    USING (
        account_id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert their own shops"
    ON tiktok_shops FOR INSERT
    WITH CHECK (
        account_id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their own shops"
    ON tiktok_shops FOR UPDATE
    USING (
        account_id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete their own shops"
    ON tiktok_shops FOR DELETE
    USING (
        account_id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can only access orders from their shops
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

-- Similar policies for products, settlements, and performance
CREATE POLICY "Users can view products from their shops"
    ON shop_products FOR SELECT
    USING (
        shop_id IN (
            SELECT id FROM tiktok_shops WHERE account_id IN (
                SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Users can view settlements from their shops"
    ON shop_settlements FOR SELECT
    USING (
        shop_id IN (
            SELECT id FROM tiktok_shops WHERE account_id IN (
                SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
            )
        )
    );

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
-- Helper Functions
-- =====================================================

-- Function to calculate net amount for settlements
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

-- Trigger to auto-calculate net amount
CREATE TRIGGER trigger_calculate_settlement_net_amount
    BEFORE INSERT OR UPDATE ON shop_settlements
    FOR EACH ROW
    EXECUTE FUNCTION calculate_settlement_net_amount();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
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
-- Migration Complete
-- =====================================================
-- Tables created:
--   - tiktok_shops
--   - shop_orders
--   - shop_products
--   - shop_settlements
--   - shop_performance
--
-- Next steps:
--   1. Verify tables are created in Supabase
--   2. Test RLS policies
--   3. Deploy backend with new routes
-- =====================================================
