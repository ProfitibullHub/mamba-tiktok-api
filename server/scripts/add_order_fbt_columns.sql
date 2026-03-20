-- Migration: Add FBT (Fulfilled by TikTok) tracking and enhanced order details to shop_orders table
-- This adds columns to track FBT status and fees at the ORDER level

-- Add fulfillment_type column (FULFILLMENT_BY_TIKTOK or FULFILLMENT_BY_SELLER)
ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS fulfillment_type text DEFAULT 'FULFILLMENT_BY_SELLER';

-- Add is_fbt as a computed/cached boolean for easier querying
ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS is_fbt boolean DEFAULT false;

-- Add FBT fulfillment fee (the actual cost charged by TikTok for FBT)
ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS fbt_fulfillment_fee decimal(10, 2) DEFAULT NULL;

-- Add shipping fee (what customer paid)
ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS shipping_fee decimal(10, 2) DEFAULT NULL;

-- Add customer shipping fee offset (TikTok reimbursement for FBT)
ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS shipping_fee_offset decimal(10, 2) DEFAULT NULL;

-- Add warehouse_id for reference
ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS warehouse_id text DEFAULT NULL;

-- Add payment_info JSONB column to store full payment breakdown
ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS payment_info jsonb DEFAULT NULL;

-- Add payment method name (ApplePay, Card, etc)
ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS payment_method_name text DEFAULT NULL;

-- Add shipping type (SELLER or PLATFORM)
ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS shipping_type text DEFAULT NULL;

-- Add delivery option fields
ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS delivery_option_id text DEFAULT NULL;

ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS delivery_option_name text DEFAULT NULL;

-- Add total_amount column if not exists (sometimes missing from old schemas)
ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS total_amount decimal(10, 2) DEFAULT NULL;

-- Add comments
COMMENT ON COLUMN shop_orders.fulfillment_type IS 'FULFILLMENT_BY_TIKTOK or FULFILLMENT_BY_SELLER';
COMMENT ON COLUMN shop_orders.is_fbt IS 'True if fulfilled by TikTok (cached boolean for easier querying)';
COMMENT ON COLUMN shop_orders.fbt_fulfillment_fee IS 'Actual FBT fee charged by TikTok from Finance API';
COMMENT ON COLUMN shop_orders.shipping_fee IS 'Shipping fee paid by customer';
COMMENT ON COLUMN shop_orders.shipping_fee_offset IS 'Customer shipping fee offset by TikTok (for FBT)';
COMMENT ON COLUMN shop_orders.warehouse_id IS 'Warehouse ID from order';
COMMENT ON COLUMN shop_orders.payment_info IS 'Full payment breakdown from TikTok API';
COMMENT ON COLUMN shop_orders.payment_method_name IS 'Payment method used (ApplePay, Card, etc)';
COMMENT ON COLUMN shop_orders.shipping_type IS 'SELLER or PLATFORM';
COMMENT ON COLUMN shop_orders.delivery_option_name IS 'Delivery option selected (Standard Shipping, etc)';

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_shop_orders_is_fbt ON shop_orders(is_fbt);
CREATE INDEX IF NOT EXISTS idx_shop_orders_fulfillment_type ON shop_orders(fulfillment_type);
CREATE INDEX IF NOT EXISTS idx_shop_orders_shipping_type ON shop_orders(shipping_type);
