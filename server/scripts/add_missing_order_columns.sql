-- Add missing columns to shop_orders table
ALTER TABLE shop_orders
ADD COLUMN IF NOT EXISTS collection_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS shipping_due_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS is_cod BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_exchange_order BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_on_hold_order BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_replacement_order BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS delivery_type TEXT,
ADD COLUMN IF NOT EXISTS seller_note TEXT,
ADD COLUMN IF NOT EXISTS tracking_number TEXT,
ADD COLUMN IF NOT EXISTS shipping_provider TEXT,
ADD COLUMN IF NOT EXISTS shipping_provider_id TEXT;

-- Index for collection_time as it might be useful for sorting/filtering
CREATE INDEX IF NOT EXISTS idx_shop_orders_collection_time ON shop_orders(collection_time);
