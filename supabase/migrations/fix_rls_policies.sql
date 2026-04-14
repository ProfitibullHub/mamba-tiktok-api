-- =====================================================
-- Fix RLS Policies for Account Creation
-- =====================================================
-- Run this in Supabase SQL Editor to allow users to create accounts

-- 1. Drop the old restrictive policies
DROP POLICY IF EXISTS "Users can view their assigned accounts" ON accounts;
DROP POLICY IF EXISTS "Users can insert their own shops" ON accounts;
DROP POLICY IF EXISTS "Users can update their accounts" ON accounts;

-- 2. Create new permissive policies

-- Allow authenticated users to create accounts
CREATE POLICY "Authenticated users can create accounts"
    ON accounts FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Allow users to view accounts they're linked to
CREATE POLICY "Users can view their assigned accounts"
    ON accounts FOR SELECT
    TO authenticated
    USING (
        id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
        )
    );

-- Allow users to update accounts they're linked to
CREATE POLICY "Users can update their accounts"
    ON accounts FOR UPDATE
    TO authenticated
    USING (
        id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
        )
    );

-- Allow users to delete accounts they're linked to
CREATE POLICY "Users can delete their accounts"
    ON accounts FOR DELETE
    TO authenticated
    USING (
        id IN (
            SELECT account_id FROM user_accounts WHERE user_id = auth.uid()
        )
    );

-- =====================================================
-- Done! Now users can create accounts
-- =====================================================
