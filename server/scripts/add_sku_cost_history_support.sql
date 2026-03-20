-- Migration: Add SKU-level cost history support
-- Adds sku_id column to product_cost_history so we can track per-variant cost changes with effective dates

-- 1. Add sku_id column (nullable: NULL = product-level cost, non-NULL = SKU-level cost)
ALTER TABLE product_cost_history
ADD COLUMN IF NOT EXISTS sku_id TEXT DEFAULT NULL;

-- 2. Update the lookup index to include sku_id
DROP INDEX IF EXISTS idx_cost_history_lookup;

CREATE INDEX idx_cost_history_lookup
ON product_cost_history(shop_id, product_id, sku_id, cost_type, effective_date);
