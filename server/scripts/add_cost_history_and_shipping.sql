-- Migration: Add COGS history tracking and shipping costs
-- This enables backdating COGS changes and tracking shipping costs

-- 1. Create product cost history table for tracking COGS changes over time
CREATE TABLE IF NOT EXISTS product_cost_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID REFERENCES tiktok_shops(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    cost_type TEXT NOT NULL DEFAULT 'cogs', -- 'cogs', 'shipping', 'other'
    amount DECIMAL(10, 2) NOT NULL,
    effective_date DATE NOT NULL, -- When this cost starts applying
    end_date DATE, -- NULL means currently active (no end date)
    notes TEXT, -- Optional notes about the cost change
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID, -- Optional: track who made the change
    
    -- Ensure no overlapping date ranges for the same product/cost_type
    CONSTRAINT unique_active_cost UNIQUE (shop_id, product_id, cost_type, effective_date)
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_cost_history_lookup 
ON product_cost_history(shop_id, product_id, cost_type, effective_date);

-- 2. Add shipping cost fields to shop_products
ALTER TABLE shop_products 
ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(10, 2) DEFAULT NULL;

ALTER TABLE shop_products 
ADD COLUMN IF NOT EXISTS is_fbt BOOLEAN DEFAULT FALSE;

-- Add comments for documentation
COMMENT ON TABLE product_cost_history IS 'Tracks historical cost changes for products with effective dates';
COMMENT ON COLUMN product_cost_history.effective_date IS 'Date from which this cost applies';
COMMENT ON COLUMN product_cost_history.end_date IS 'Date until which this cost applies (NULL = still active)';
COMMENT ON COLUMN shop_products.shipping_cost IS 'Manual shipping cost per unit (for non-FBT products)';
COMMENT ON COLUMN shop_products.is_fbt IS 'Whether product is Fulfilled by TikTok (shipping handled by TikTok)';
