-- Add transaction_summary JSONB column to shop_settlements
-- This stores the aggregated breakdown from statement transactions API
-- Used for accurate P&L calculations
ALTER TABLE shop_settlements
ADD COLUMN IF NOT EXISTS transaction_summary JSONB,
ADD COLUMN IF NOT EXISTS transactions_synced_at TIMESTAMPTZ;

-- Add index for faster P&L queries by date range
CREATE INDEX IF NOT EXISTS idx_shop_settlements_settlement_time
ON shop_settlements(shop_id, settlement_time);
