-- =====================================================
-- Mamba TikTok Shop - Add Missing Columns Migration
-- =====================================================
-- Run this in your Supabase SQL Editor to fix sync issues
-- 
-- This adds the revenue_breakdown column and ensures proper constraints

-- 1. Add revenue_breakdown column to shop_orders
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS revenue_breakdown JSONB;

-- 2. Fix the unique constraint for upsert operations
-- First, drop the old constraint if it exists
ALTER TABLE shop_orders DROP CONSTRAINT IF EXISTS shop_orders_order_id_key;

-- 3. Add the correct composite unique constraint (shop_id + order_id)
-- This allows the same order_id to exist for different shops
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'shop_orders_shop_id_order_id_key'
    ) THEN
        ALTER TABLE shop_orders ADD CONSTRAINT shop_orders_shop_id_order_id_key UNIQUE (shop_id, order_id);
    END IF;
END $$;

-- 4. Add missing sync timestamp columns to tiktok_shops if they don't exist
ALTER TABLE tiktok_shops ADD COLUMN IF NOT EXISTS orders_last_synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE tiktok_shops ADD COLUMN IF NOT EXISTS products_last_synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE tiktok_shops ADD COLUMN IF NOT EXISTS settlements_last_synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE tiktok_shops ADD COLUMN IF NOT EXISTS performance_last_synced_at TIMESTAMP WITH TIME ZONE;

-- 5. Add missing columns to shop_products for performance data
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS main_image_url TEXT;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS gmv DECIMAL(12, 2) DEFAULT 0;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS orders_count INTEGER DEFAULT 0;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS click_through_rate DECIMAL(5, 4) DEFAULT 0;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS details JSONB;

-- 6. Add missing columns to shop_settlements
ALTER TABLE shop_settlements ADD COLUMN IF NOT EXISTS fee_amount DECIMAL(12, 2) DEFAULT 0;
ALTER TABLE shop_settlements ADD COLUMN IF NOT EXISTS net_sales_amount DECIMAL(12, 2) DEFAULT 0;

-- 7. Verify all changes
DO $$
BEGIN
    RAISE NOTICE 'Migration completed successfully!';
    RAISE NOTICE 'Added columns: revenue_breakdown, sync timestamps, product performance fields';
END $$;
