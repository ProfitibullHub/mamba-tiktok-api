-- Add paid_time column to shop_orders table
-- This column stores when the order was actually paid (not when it was created)
-- UNPAID orders will have NULL paid_time

ALTER TABLE shop_orders
ADD COLUMN IF NOT EXISTS paid_time TIMESTAMP WITH TIME ZONE;

-- Create index for efficient filtering and sorting by paid_time
CREATE INDEX IF NOT EXISTS idx_shop_orders_paid_time ON shop_orders(paid_time);

-- Add comment to explain the column
COMMENT ON COLUMN shop_orders.paid_time IS 'Timestamp when the order was paid. NULL for UNPAID orders. Used for metrics to match TikTok Seller Center.';
