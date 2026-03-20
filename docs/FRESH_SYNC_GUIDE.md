# Fresh Sync Guide - Reset and Re-sync All Data

## Overview
This guide shows you how to wipe all synced data and perform a fresh sync using the new `MAX_HISTORICAL_DAYS` configuration.

---

## 🚨 Before You Start

### What Will Happen:
- ✅ **Preserved:** Shop connections, access tokens, authentication
- ❌ **Deleted:** All orders, products, settlements, and synced data
- ✅ **Reset:** All sync timestamps (will trigger full initial sync)

### Why Do This:
- To re-sync with the new `MAX_HISTORICAL_DAYS = 365` configuration
- To ensure all data uses consistent time windows
- To start fresh with the improved sync system

---

## Step-by-Step Instructions

### Step 1: Run the SQL Reset

**Option A: Quick Reset (Recommended)**

1. Open Supabase Dashboard
2. Go to **SQL Editor**
3. Copy and paste this entire script:

```sql
-- Quick Reset - Wipe all synced data
BEGIN;

-- Delete all data
TRUNCATE shop_orders CASCADE;
TRUNCATE shop_products CASCADE;
TRUNCATE shop_settlements CASCADE;

-- Reset sync timestamps
UPDATE tiktok_shops
SET 
    orders_last_synced_at = NULL,
    products_last_synced_at = NULL,
    settlements_last_synced_at = NULL,
    performance_last_synced_at = NULL,
    updated_at = NOW();

COMMIT;

-- Verify reset
SELECT 
    (SELECT COUNT(*) FROM shop_orders) as orders_count,
    (SELECT COUNT(*) FROM shop_products) as products_count,
    (SELECT COUNT(*) FROM shop_settlements) as settlements_count,
    (SELECT COUNT(*) FROM tiktok_shops) as shops_count;
```

4. Click **Run** (or press F5)
5. Verify the results show 0 for orders, products, and settlements
6. Your shops count should still show your connected shops

**Option B: Detailed Reset (with verification)**

Use the script in `/docs/RESET_SYNC_DATA.sql` for a more controlled reset with verification steps.

---

### Step 2: Verify the Reset

Run this query to confirm everything is reset:

```sql
SELECT 
    shop_name,
    shop_id,
    orders_last_synced_at,
    products_last_synced_at,
    settlements_last_synced_at,
    token_expires_at
FROM tiktok_shops;
```

You should see:
- ✅ Your shop names and IDs still present
- ✅ All `*_last_synced_at` fields are `NULL`
- ✅ `token_expires_at` still has a valid date (not expired)

---

### Step 3: Trigger Fresh Sync

**Via Frontend:**
1. Open your application
2. Go to any view (Overview, Product Management, etc.)
3. Click the **Sync** button
4. The system will automatically detect it's a first sync and fetch the last 365 days of data

**Via API (if you prefer):**

```bash
# Replace with your actual accountId
curl -X POST http://localhost:3001/api/tiktok-shop-data/sync/{accountId}
```

---

### Step 4: Monitor the Sync

Watch the server logs for sync progress:

```bash
# You should see logs like:
[FULL] Syncing orders for shop [ShopName]...
[FULL] Fetching orders from last 1 year...
[FULL] Syncing settlements for shop [ShopName]...
[FULL] Fetching settlements from last 1 year...
```

Note the **"last 1 year"** - this confirms `MAX_HISTORICAL_DAYS = 365` is being used!

---

### Step 5: Verify the New Sync

Check that data is syncing correctly:

```sql
-- Check data counts
SELECT 
    (SELECT COUNT(*) FROM shop_orders) as orders_synced,
    (SELECT COUNT(*) FROM shop_products) as products_synced,
    (SELECT COUNT(*) FROM shop_settlements) as settlements_synced;

-- Check date ranges
SELECT 
    'Orders' as data_type,
    MIN(created_time) as earliest_date,
    MAX(created_time) as latest_date,
    COUNT(*) as total_count
FROM shop_orders
UNION ALL
SELECT 
    'Settlements' as data_type,
    MIN(settlement_time) as earliest_date,
    MAX(settlement_time) as latest_date,
    COUNT(*) as total_count
FROM shop_settlements;
```

**Expected Results:**
- Orders: Earliest date should be approximately 365 days ago
- Settlements: Earliest date should be approximately 365 days ago
- Counts should reflect your actual shop activity

---

## ⚠️ Troubleshooting

### If Sync Fails:

1. **Check Token Expiration:**
```sql
SELECT shop_name, token_expires_at < NOW() as is_expired
FROM tiktok_shops;
```
If expired, reconnect your shop in the UI.

2. **Check Server Logs:**
Look for errors like:
- `Error 105002` → Token expired, need to reconnect
- `Rate limit` → Wait a few minutes and try again

3. **Manual Sync via API:**
```bash
# Sync specific types
curl -X POST http://localhost:3001/api/tiktok-shop-data/sync/{accountId}?type=orders
curl -X POST http://localhost:3001/api/tiktok-shop-data/sync/{accountId}?type=products
curl -X POST http://localhost:3001/api/tiktok-shop-data/sync/{accountId}?type=settlements
```

---

## 🎉 Success Indicators

After a successful fresh sync, you should see:

### In Supabase:
- ✅ Thousands of orders (depending on your shop volume)
- ✅ All your products listed
- ✅ Settlement records for the last 365 days

### In Frontend:
- ✅ Product Management shows "Sales (365d)" and "Revenue (365d)"
- ✅ Date pickers limit you to max 365 days back
- ✅ P&L view shows accurate data
- ✅ Overview metrics are populated

### In Logs:
- ✅ Sync completed messages
- ✅ "Smart Stop Early" for incremental syncs (on subsequent syncs)
- ✅ No errors or warnings

---

## Next Steps

1. **Verify Metrics:** Check that all metrics in Product Management, P&L, and Overview are accurate
2. **Test Date Ranges:** Try different date ranges in the Date Picker
3. **Schedule Regular Syncs:** Set up automatic syncs (via cron or manual schedule)
4. **Monitor Performance:** Watch sync times and optimize if needed

---

## Rolling Back (Emergency)

If something goes wrong and you need to restore data:

1. **If using Supabase backups:** Restore from the latest backup before the reset
2. **If you have exports:** Re-import your data
3. **If neither:** You'll need to re-sync from TikTok (data is safe there)

**Note:** TikTok Shop API is your source of truth - as long as your shop connection is active, you can always re-sync!

---

## Files Reference

- **Quick Reset SQL:** `/docs/QUICK_RESET.sql`
- **Detailed Reset SQL:** `/docs/RESET_SYNC_DATA.sql`
- **Configuration:** `/server/src/config/dataRetention.ts`
- **Sync Audit:** `/docs/SYNC_OPERATIONS_AUDIT.md`
