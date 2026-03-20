-- Migration: Create agency_fees table with full enhanced structure
-- Includes fee_type (retainer/commission/both), commission fields, and recurrence

CREATE TABLE IF NOT EXISTS agency_fees (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  shop_id          text NOT NULL,
  date             date NOT NULL,
  agency_name      text NOT NULL,
  amount           numeric(12,2) NOT NULL DEFAULT 0,  -- legacy flat amount / backward compat
  description      text,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Enhanced fields
  fee_type         text NOT NULL DEFAULT 'retainer'
                     CHECK (fee_type IN ('retainer', 'commission', 'both')),
  retainer_amount  numeric(12,2) NOT NULL DEFAULT 0,
  commission_rate  numeric(8,4)  NOT NULL DEFAULT 0,  -- stored as %, e.g. 10 = 10%
  commission_base  text NOT NULL DEFAULT 'gmv'
                     CHECK (commission_base IN ('gmv', 'gross_profit', 'net_revenue')),
  recurrence       text NOT NULL DEFAULT 'monthly'
                     CHECK (recurrence IN ('monthly', 'quarterly', 'biannual', 'annual'))
);

-- If the table already existed without the new columns, add them safely
ALTER TABLE agency_fees
  ADD COLUMN IF NOT EXISTS fee_type        text NOT NULL DEFAULT 'retainer',
  ADD COLUMN IF NOT EXISTS retainer_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_rate numeric(8,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_base text NOT NULL DEFAULT 'gmv',
  ADD COLUMN IF NOT EXISTS recurrence      text NOT NULL DEFAULT 'monthly';

-- Back-fill: treat existing `amount` as retainer_amount for old rows
UPDATE agency_fees
SET retainer_amount = amount
WHERE retainer_amount = 0;

-- RLS
ALTER TABLE agency_fees ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agency_fees'
      AND policyname = 'Users can manage their own agency fees'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Users can manage their own agency fees"
        ON agency_fees
        FOR ALL
        USING (
          account_id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
          )
        )
    $policy$;
  END IF;
END $$;

-- Index for fast date-range queries
CREATE INDEX IF NOT EXISTS agency_fees_account_shop_date
  ON agency_fees (account_id, shop_id, date DESC);
