-- Add return and refund related columns to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS return_status VARCHAR(50),
ADD COLUMN IF NOT EXISTS substatus VARCHAR(50),
ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS return_reason TEXT,
ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
ADD COLUMN IF NOT EXISTS med_return_amount DECIMAL(10, 2) DEFAULT 0;

-- Create index for faster filtering on status columns
CREATE INDEX IF NOT EXISTS idx_orders_return_status ON orders(return_status);
CREATE INDEX IF NOT EXISTS idx_orders_substatus ON orders(substatus);
