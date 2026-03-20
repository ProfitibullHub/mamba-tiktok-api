# Sync Operations Audit - MAX_HISTORICAL_DAYS Compliance

## Overview
This document verifies that ALL sync operations are properly configured to:
1. ✅ Use `MAX_HISTORICAL_DAYS` as the starting point for initial syncs
2. ✅ Sort in `DESC` order (newest first) for optimal performance
3. ✅ Use global configuration helpers from `/server/src/config/dataRetention.ts`

---

## ✅ Sync Operations Summary

### 1. syncOrders
**File:** `/server/src/routes/tiktok-shop-data.routes.ts` (Line 2073)

**Status:** ✅ COMPLIANT

**Configuration:**
```typescript
// First sync start time
startTime = getHistoricalStartTime();  // Uses MAX_HISTORICAL_DAYS

// Sort order
sort_field: 'create_time',
sort_order: 'DESC'  // Newest first
```

**Notes:**
- Incremental syncs fetch only newer orders after last sync
- Smart Stop Early implemented for optimal performance

---

### 2. syncSettlements
**File:** `/server/src/routes/tiktok-shop-data.routes.ts` (Line 2950)

**Status:** ✅ COMPLIANT

**Configuration:**
```typescript
// First sync start time
startTime = getHistoricalStartTime();  // Uses MAX_HISTORICAL_DAYS

// Sort order
sort_field: 'statement_time',
sort_order: 'DESC'  // Newest first
```

**Notes:**
- Incremental syncs fetch only newer settlements after last sync
- Smart Stop Early implemented for optimal performance
- All fallbacks use `getHistoricalStartTime()`

---

### 3. syncProducts
**File:** `/server/src/routes/tiktok-shop-data.routes.ts` (Line 2611)

**Status:** ✅ COMPLIANT

**Configuration:**
```typescript
// Products fetch ALL active products (no time limit needed)
// This is correct - we need current inventory regardless of age

// Sort order
sort_field: 'create_time',
sort_order: 'DESC'  // Newest first
```

**Embedded Product Performance:**
```typescript
// Product performance analytics
start_date_ge: getHistoricalStartDate(),  // Uses MAX_HISTORICAL_DAYS
end_date_lt: today
```

**Notes:**
- Products themselves don't need time constraints (we need current inventory)
- Product PERFORMANCE analytics now uses `MAX_HISTORICAL_DAYS`
- Previously used hardcoded 30 days - FIXED ✅

---

### 4. syncStatementTransactions
**File:** `/server/src/routes/tiktok-shop-data.routes.ts` (Line 3168)

**Status:** ✅ COMPLIANT

**Configuration:**
```typescript
// Fetches transactions for settlements (time range from settlements)

// Sort order
sort_field: 'order_create_time',
sort_order: 'DESC'  // Newest first
```

**Notes:**
- Time range determined by settlements (which use MAX_HISTORICAL_DAYS)
- Smart Stop Early: Only processes settlements without transaction_summary

---

### 5. syncFbtFees
**File:** `/server/src/routes/tiktok-shop-data.routes.ts` (Line 2333)

**Status:** ✅ COMPLIANT

**Configuration:**
- Syncs FBT fees for FBT orders (no independent time range)
- Operates on orders already synced (which use MAX_HISTORICAL_DAYS)

**Notes:**
- Processes batches of 10 orders at a time
- Smart Stop Early implemented

---

### 6. syncPerformance
**File:** `/server/src/routes/tiktok-shop-data.routes.ts` (Line 3538)

**Status:** ✅ COMPLIANT (Different Purpose)

**Configuration:**
```typescript
// Fetches YESTERDAY's performance metrics only
start_date_ge: yesterday,
end_date_lt: today
```

**Notes:**
- This is for DAILY performance tracking, not historical data
- Intentionally fetches yesterday only (not related to MAX_HISTORICAL_DAYS)
- This is correct behavior for daily metrics

---

## Summary Table

| Sync Function | Uses MAX_HISTORICAL_DAYS | Sort Order | Smart Stop Early | Status |
|---------------|--------------------------|------------|------------------|---------|
| syncOrders | ✅ Yes (first sync) | DESC ✅ | Yes ✅ | COMPLIANT |
| syncSettlements | ✅ Yes (first sync) | DESC ✅ | Yes ✅ | COMPLIANT |
| syncProducts | N/A (fetches all active) | DESC ✅ | No (full refresh) | COMPLIANT |
| - Product Performance | ✅ Yes (analytics) | N/A | N/A | COMPLIANT |
| syncStatementTxns | Inherited from settlements | DESC ✅ | Yes ✅ | COMPLIANT |
| syncFbtFees | Inherited from orders | N/A | Yes ✅ | COMPLIANT |
| syncPerformance | N/A (daily metrics) | N/A | N/A | COMPLIANT |

---

## Key Benefits

### 1. Consistency
- All historical syncs use the same time window
- No hardcoded dates in sync operations
- Single source of truth: `MAX_HISTORICAL_DAYS`

### 2. Performance
- DESC sorting ensures newest data first
- Smart Stop Early prevents unnecessary API calls
- Incremental syncs only fetch new data

### 3. Maintainability
- Change `MAX_HISTORICAL_DAYS` once, affects all syncs
- Clear logging shows actual time windows used
- Easy to audit and verify configuration

### 4. Scalability
- Easy to extend time window (365d → 730d)
- Efficient pagination with Smart Stop Early
- Optimized for large data sets

---

## Testing Checklist

To verify all syncs are working correctly:

- [ ] Change `MAX_HISTORICAL_DAYS` to 180 (6 months)
- [ ] Run initial sync for a new shop
- [ ] Verify Orders sync logs show "last 6 months"
- [ ] Verify Settlements sync logs show "last 6 months"
- [ ] Verify Product Performance uses 180 days
- [ ] Change back to 365 and verify logs update
- [ ] Run incremental sync and verify Smart Stop Early works

---

## Change Log

**2026-01-29:**
- ✅ Added `MAX_HISTORICAL_DAYS` to syncOrders
- ✅ Added `MAX_HISTORICAL_DAYS` to syncSettlements
- ✅ Fixed Product Performance (was 30 days, now uses `MAX_HISTORICAL_DAYS`)
- ✅ Verified all sync operations use DESC sorting
- ✅ Confirmed Smart Stop Early in appropriate syncs
