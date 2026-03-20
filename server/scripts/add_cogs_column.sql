-- Add COGS (Cost of Goods Sold) column to shop_products table
-- This allows manual entry of product costs for accurate profit calculations

ALTER TABLE shop_products 
ADD COLUMN IF NOT EXISTS cogs DECIMAL(10, 2) DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN shop_products.cogs IS 'Cost of Goods Sold - manually entered cost per unit for profit calculations';
