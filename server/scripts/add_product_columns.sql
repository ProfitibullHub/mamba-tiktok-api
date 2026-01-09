
-- Add new columns to shop_products table
ALTER TABLE shop_products 
ADD COLUMN IF NOT EXISTS click_through_rate decimal(5, 4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS gmv decimal(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS orders_count integer DEFAULT 0;
