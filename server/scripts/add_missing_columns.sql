-- Add missing columns to shop_products table
ALTER TABLE shop_products 
ADD COLUMN IF NOT EXISTS main_image_url TEXT,
ADD COLUMN IF NOT EXISTS details JSONB;

-- Update main_image_url from images JSONB for existing records
UPDATE shop_products 
SET main_image_url = images->0::text
WHERE images IS NOT NULL 
  AND jsonb_array_length(images) > 0 
  AND main_image_url IS NULL;
