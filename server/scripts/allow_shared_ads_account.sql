-- This script removes the 1:1 restriction between Mamba Shops and TikTok Ads accounts.
-- It drops the unique constraint on advertiser_id and creates a composite constraint
-- allowing the same TikTok Ads account to exist across different Mamba shops.

BEGIN;

-- 1. Drop the existing constraint
ALTER TABLE "public"."tiktok_advertisers" 
  DROP CONSTRAINT IF EXISTS "tiktok_advertisers_advertiser_id_key";

-- 2. Add the new composite constraint
ALTER TABLE "public"."tiktok_advertisers"
  ADD CONSTRAINT "tiktok_advertisers_account_advertiser_key" UNIQUE ("account_id", "advertiser_id");

COMMIT;
