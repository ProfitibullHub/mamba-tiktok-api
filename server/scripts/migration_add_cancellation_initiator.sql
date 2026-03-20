-- Add cancellation_initiator column to shop_orders table for tracking refunded orders
ALTER TABLE shop_orders 
ADD COLUMN IF NOT EXISTS cancellation_initiator TEXT;

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_shop_orders_cancellation_initiator ON shop_orders(cancellation_initiator);
