-- This is a sample seed script for testing the TikTok Dashboard
-- You can use this to populate demo data in your database

-- Note: You'll need to create user accounts via the Supabase Auth UI first
-- Then use their user IDs in the profiles table

-- Example: Create sample accounts
INSERT INTO accounts (name, tiktok_handle, status) VALUES
('Fashion Boutique', '@fashionboutique', 'active'),
('Tech Gadgets Store', '@techgadgets', 'active'),
('Beauty Products', '@beautyproducts', 'active'),
('Fitness Hub', '@fitnesshub', 'active'),
('Home Decor', '@homedecor', 'active'),
('Pet Paradise', '@petparadise', 'active'),
('Snack Box', '@snackbox', 'active'),
('Outdoor Adventure', '@outdooradventure', 'active'),
('Gaming World', '@gamingworld', 'active'),
('Jewelry Shop', '@jewelryshop', 'active'),
('Sports Gear', '@sportsgear', 'active'),
('Book Corner', '@bookcorner', 'active'),
('Toy Store', '@toystore', 'active'),
('Kitchen Essentials', '@kitchenessentials', 'active'),
('Music Shop', '@musicshop', 'active')
ON CONFLICT DO NOTHING;

-- Example: Create sample KPI data for each account and metric type
-- This would be done for each account with realistic data
-- You'll need to replace 'account-id-here' with actual account IDs from your database

-- Sample KPI metrics template (repeat for each account and adjust values)
-- INSERT INTO kpi_metrics (account_id, date, metric_type, impressions, clicks, conversions, revenue, spend, engagement_rate, followers_gained, video_views, likes, comments, shares, affiliate_commissions)
-- VALUES
-- ('account-id-here', CURRENT_DATE - INTERVAL '1 day', 'overview', 50000, 2500, 125, 3750.00, 500.00, 5.5, 250, 45000, 2200, 180, 95, 375.00),
-- ('account-id-here', CURRENT_DATE - INTERVAL '1 day', 'ads', 30000, 1500, 75, 2250.00, 450.00, 0, 0, 0, 0, 0, 0, 0),
-- Add more entries for different dates and metric types...

-- NOTE: To fully populate the database with sample data:
-- 1. Get the account IDs after inserting accounts
-- 2. Create user profiles linked to auth.users
-- 3. Link users to accounts via user_accounts table
-- 4. Generate KPI metrics for the last 30 days for each account and metric type
