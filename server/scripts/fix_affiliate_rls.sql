-- Fix RLS policies for affiliate_settlements table

-- Drop existing policies to avoid conflicts
drop policy if exists "Users can view their own affiliate settlements" on affiliate_settlements;
drop policy if exists "Users can insert their own affiliate settlements" on affiliate_settlements;
drop policy if exists "Users can update their own affiliate settlements" on affiliate_settlements;
drop policy if exists "Users can delete their own affiliate settlements" on affiliate_settlements;

-- Create new policies using user_accounts check (Allow access if user belongs to the account)
create policy "Users can view affiliate settlements for their accounts"
  on affiliate_settlements for select
  using (
    exists (
      select 1 from user_accounts
      where user_accounts.account_id = affiliate_settlements.account_id::uuid
      and user_accounts.user_id = auth.uid()
    )
  );

create policy "Users can insert affiliate settlements for their accounts"
  on affiliate_settlements for insert
  with check (
    exists (
      select 1 from user_accounts
      where user_accounts.account_id = affiliate_settlements.account_id::uuid
      and user_accounts.user_id = auth.uid()
    )
  );

create policy "Users can update affiliate settlements for their accounts"
  on affiliate_settlements for update
  using (
    exists (
      select 1 from user_accounts
      where user_accounts.account_id = affiliate_settlements.account_id::uuid
      and user_accounts.user_id = auth.uid()
    )
  );

create policy "Users can delete affiliate settlements for their accounts"
  on affiliate_settlements for delete
  using (
    exists (
      select 1 from user_accounts
      where user_accounts.account_id = affiliate_settlements.account_id::uuid
      and user_accounts.user_id = auth.uid()
    )
  );
