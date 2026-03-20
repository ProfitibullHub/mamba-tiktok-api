# DEEP INVESTIGATION: Data Discrepancy Between Mamba and TikTok Seller Center

## The Problem

**Your Mamba Dashboard (Jan 22-28, 2026):**
- GMV: **$658.52**
- Orders: **248**
- Customers: **189**
- Items sold: **310**

**TikTok Seller Center (Jan 22-28, 2026):**
- GMV: **$2,278.80** (3.5x MORE!)
- Orders: **64** (3.9x LESS!)
- Customers: **60** (3.2x LESS!)
- Items sold: **71** (4.4x LESS!)

**This is IMPOSSIBLE unless different filtering logic is being used!**

---

## Investigation Findings

### 🔴 **CRITICAL ISSUE #1: Order Status Filtering**

**Current Code** (`MetricsChartGrid.tsx` line 79):
```typescript
const filteredOrders = orders.filter(o => o.created_time >= startTs && o.created_time <= endTs);
```

**Problem**: This counts **ALL orders regardless of status**!

**TikTok Seller Center Documentation Says:**
- ✅ **INCLUDED in metrics**: Orders with **PAID** status (includes AWAITING_SHIPMENT, IN_TRANSIT, DELIVERED, COMPLETED)
- ❌ **EXCLUDED from metrics**: Orders with **UNPAID**, **CANCELLED**, **AWAITING_COLLECTION** status

**Why This Matters:**
If you have 248 total orders but only 64 are actually PAID/COMPLETED, this explains the discrepancy!

**Example Breakdown (hypothetical):**
- Total orders fetched: 248
  - COMPLETED: 40
  - AWAITING_SHIPMENT: 15
  - IN_TRANSIT: 9
  - UNPAID: 120 ❌
  - CANCELLED: 50 ❌
  - AWAITING_COLLECTION: 14 ❌
- **TikTok shows: 40 + 15 + 9 = 64** ✅

---

### 🔴 **CRITICAL ISSUE #2: GMV Calculation Source**

**Current Code** (`MetricsChartGrid.tsx`):
- **Line 136** (daily breakdown): `dailyData[dateKey].gmv += order.order_amount || 0;`
- **Line 146** (total): `const totalGMV = filteredStatements.reduce((sum, s) => sum + parseFloat(s.revenue_amount || '0'), 0);`

**Problem 1:** **Inconsistency!**
- Daily GMV uses `order.order_amount` (from orders)
- Total GMV uses `statement.revenue_amount` (from statements)

**Problem 2:** **Wrong Data Source!**
- `order_amount` is the gross order total (before fees, returns, adjustments)
- `statement_amount` is the **net settlement** (after TikTok fees, refunds, etc.)

**TikTok Seller Center GMV Definition:**
According to TikTok documentation:
> "GMV (Gross Merchandise Value) represents the total value of products sold based on successfully completed transactions where customer payment has been made."

**This means:**
- GMV should use `order.order_amount` from PAID orders
- But ONLY for orders that have been **PAID** (not UNPAID/CANCELLED)
- Statements are for settlements (net revenue), not GMV

**Why Mamba Shows Lower GMV ($658.52):**
If you're using statements, it's calculating **net revenue** (after fees) instead of **gross GMV**:
- Gross order value: $2,278.80
- TikTok fees (8-12%): ~$200-270
- Net settlement: ~$2,000-2,070

But wait, your number is **$658.52**, which is way too low even for net. This suggests statements might only have partial data!

---

### 🔴 **CRITICAL ISSUE #3: Statement Data Completeness**

**Hypothesis:**
Your `statements` array might not have all the data for the selected period!

**Statements are created:**
- When orders are **settled** (usually 7-14 days after delivery)
- Not when orders are **placed**

**What This Means:**
- Order placed: Jan 22
- Delivered: Jan 28
- Settlement: Feb 5-12 (outside your date range!)

So if you filter statements by Jan 22-28, you won't get settlements for orders placed in that period!

---

### 🔴 **CRITICAL ISSUE #4: Additional Filtering Needed**

**TikTok Seller Center "Key Metrics" Likely Filters By:**

1. **Order Status**: Only PAID statuses
   - ✅ AWAITING_SHIPMENT
   - ✅ AWAITING_COLLECTION (if paid)
   - ✅ IN_TRANSIT
   - ✅ DELIVERED
   - ✅ COMPLETED
   - ❌ UNPAID
   - ❌ CANCELLED
   - ❌ ON_HOLD (remorse period)

2. **Payment Completion**: Only orders where payment was successful

3. **Date Range**: By `create_time` (when order was placed), not settlement time

---

## Recommended Fix (Don't Implement Yet!)

### For Orders Count:
```typescript
const validStatuses = ['AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'IN_TRANSIT', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
const filteredOrders = orders.filter(o => 
    o.created_time >= startTs && 
    o.created_time <= endTs &&
    validStatuses.includes(o.order_status?.toUpperCase())
);
```

### For GMV:
```typescript
// Use order_amount from PAID orders, not statements
const totalGMV = filteredOrders.reduce((sum, o) => sum + (o.order_amount || 0), 0);
```

### For Daily GMV:
```typescript
// Already correct - uses order.order_amount
dailyData[dateKey].gmv += order.order_amount || 0;
```

---

## Verification Steps Needed

**Before making any code changes, please verify:**

1. **Check Your Order Statuses:**
   - How many orders are UNPAID?
   - How many are CANCELLED?
   - How many are COMPLETED/PAID?
   - Run this query: Count all orders by status for Jan 22-28

2. **Check Your Statements:**
   - How many statements exist for Jan 22-28?
   - What's the total revenue_amount from those statements?
   - Compare to order_amount totals

3. **Compare With TikTok:**
   - Download the exact report from TikTok Seller Center
   - Check what filters they're using
   - Confirm which order statuses are included

4. **Database Query Needed:**
   ```sql
   SELECT 
       order_status,
       COUNT(*) as count,
       SUM(order_amount) as total_amount
   FROM shop_orders
   WHERE created_time >= {start_timestamp}
     AND created_time <= {end_timestamp}
   GROUP BY order_status;
   ```

---

## Summary of Root Causes

| Issue | Current Behavior | TikTok Behavior | Impact |
|-------|-----------------|-----------------|---------|
| **Order filtering** | Counts ALL orders | Only counts PAID orders | You show 248, TikTok shows 64 |
| **GMV source** | Uses statements (net) | Uses order_amount (gross) | Different GMV values |
| **Statement timing** | Filters by settlement time | Uses order create time | Missing recent orders |
| **Status filtering** | No status filter | Excludes UNPAID/CANCELLED | 3.9x difference in count |

---

## Next Steps

1. ❌ **DO NOT EDIT CODE YET**
2. ✅ **Run database queries** to verify order status breakdown
3. ✅ **Check TikTok Seller Center** filters and settings
4. ✅ **Confirm statement vs order data** availability
5. ✅ **Verify timezone** is consistent (already fixed)
6. ✅ **Download TikTok report** for the exact same date range
7. ✅ **Compare field by field** to identify exact differences

Once we have this data, we can implement the correct fix!
