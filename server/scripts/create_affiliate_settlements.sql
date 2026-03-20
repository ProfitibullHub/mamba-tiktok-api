-- Create affiliate_settlements table for manual entry
create table if not exists affiliate_settlements (
  id uuid default gen_random_uuid() primary key,
  account_id text not null, -- Links to the main account
  shop_id text not null,    -- Links to specific shop
  date date not null,       -- The date this cost applies to
  affiliate_name text not null, -- Name of the affiliate
  amount numeric not null,  -- Amount field (can be negative or positive, usually cost is positive in DB but treated as expense)
  description text,         -- Optional description
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Add updated_at if you want track edits, though not strictly necessary for simple log
-- alter table affiliate_settlements add column updated_at timestamp with time zone default timezone('utc'::text, now());

-- Enable RLS
alter table affiliate_settlements enable row level security;

-- Policies
create policy "Users can view their own affiliate settlements"
  on affiliate_settlements for select
  using ( account_id = auth.uid()::text ); -- Assuming auth.uid() maps to account_id or simple check

create policy "Users can insert their own affiliate settlements"
  on affiliate_settlements for insert
  with check ( account_id = auth.uid()::text );

create policy "Users can update their own affiliate settlements"
  on affiliate_settlements for update
  using ( account_id = auth.uid()::text );

create policy "Users can delete their own affiliate settlements"
  on affiliate_settlements for delete
  using ( account_id = auth.uid()::text );

-- Index for fast lookup by date range and account
create index if not exists idx_affiliate_settlements_account_date 
  on affiliate_settlements (account_id, shop_id, date);
