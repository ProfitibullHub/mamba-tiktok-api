-- Enable Supabase Realtime for the tiktok_shops table
-- This is required for the frontend to receive DELETE events
-- when the webhook purges a shop after deauthorization.

-- 1. Add tiktok_shops to the Supabase Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE tiktok_shops;

-- 2. Set REPLICA IDENTITY FULL so DELETE events include the full old row
--    (needed to read shop_id from the payload)
ALTER TABLE tiktok_shops REPLICA IDENTITY FULL;
