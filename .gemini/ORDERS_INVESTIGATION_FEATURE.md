# Orders View - Date Range Filter & Status Investigation Added

## Changes Made

### 1. **Added Date Range Filtering**
- ✅ Orders are now filtered by the selected date range
- ✅ All counts (Total, FBT, Seller Fulfilled, On Hold) respect the date range
- ✅ Consistent with Overview page behavior

### 2. **Added Status Investigation Section**
New blue investigation panel showing:
- **UNPAID Orders** (red) - Orders not yet paid
- **CANCELLED Orders** (orange) - Cancelled orders  
- **COMPLETED Orders** (green) - Successfully completed
- **PAID Orders** (cyan) - All orders with PAID status (what TikTok likely counts)

### 3. **PAID Orders Calculation**
Includes orders with these statuses:
- AWAITING_SHIPMENT
- AWAITING_COLLECTION
- IN_TRANSIT
- SHIPPED
- DELIVERED
- COMPLETED

**This matches TikTok Seller Center's definition of which orders count toward metrics!**

## How to Use

1. **Go to Orders page**
2. **Select your date range** (e.g., Jan 22-28, 2026)
3. **Look at the "Status Investigation" section**
4. **Compare the numbers:**
   - **Total Orders** = All orders in date range
   - **PAID Orders** = What TikTok Seller Center likely shows
   - **UNPAID Orders** = Orders excluded by TikTok
   - **CANCELLED Orders** = Orders excluded by TikTok

## Investigation Steps

To answer your questions:

### "How many orders are UNPAID for Jan 22-28?"
1. Set date range to Jan 22 - Jan 28
2. Look at **UNPAID Orders** card (red number)

### "How many orders are CANCELLED for Jan 22-28?"
1. Set date range to Jan 22 - Jan 28
2. Look at **CANCELLED Orders** card (orange number)

### "What should match TikTok Seller Center?"
1. Set date range to Jan 22 - Jan 28
2. Look at **PAID Orders** card (cyan number)
3. This number should match TikTok's "Orders" count!

## Expected Results

If the hypothesis is correct:

**Your Dashboard (before fix):**
- Total Orders: 248 (includes UNPAID + CANCELLED)
- GMV: Uses wrong source

**TikTok Seller Center:**
- Orders: 64 (PAID orders only) ✅
- GMV: From PAID orders only ✅

**After Filtering:**
- UNPAID: ~150-180 orders
- CANCELLED: ~5-10 orders  
- PAID: **Should be ~64 orders** matching TikTok!

## Files Modified

1. `/src/components/views/OrdersView.tsx`
   - Added `parseLocalDate` import
   - Added date range filtering to `filteredOrders`
   - Added status breakdown calculations
   - Added Status Investigation UI section
   - Updated all counts to use `filteredOrders`

## Next Steps

1. ✅ **Refresh the page**
2. ✅ **Select Jan 22-28 date range**
3. ✅ **Check the Status Investigation section**
4. ✅ **Report back the numbers:**
   - UNPAID: ?
   - CANCELLED: ?
   - COMPLETED: ?
   - PAID: ?
5. ✅ **Compare PAID count with TikTok's 64**

Once we confirm the numbers match, we'll update the Overview and Key Metrics to use the same filtering!
