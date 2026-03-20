-- Migration: Add fbt_source column to track whether is_fbt was auto-detected or manually set
-- Run this against your Supabase database

-- Add fbt_source column
ALTER TABLE shop_products 
ADD COLUMN IF NOT EXISTS fbt_source text DEFAULT 'auto';

-- Add comment
COMMENT ON COLUMN shop_products.fbt_source IS 'Source of is_fbt value: auto (from TikTok API) or manual (user override)';

-- Update existing records that have is_fbt = true to be marked as 'manual'
-- (since they were set before auto-detection existed)
UPDATE shop_products 
SET fbt_source = 'manual' 
WHERE is_fbt = true AND fbt_source IS NULL;

-- Update existing records with is_fbt = false to 'auto' (default state)
UPDATE shop_products 
SET fbt_source = 'auto' 
WHERE is_fbt = false AND (fbt_source IS NULL OR fbt_source = 'auto');
