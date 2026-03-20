# Data Retention & Historical Window Configuration

## Overview

This system uses a **configurable historical data window** to ensure consistency across all metrics and sync operations. Instead of claiming "all-time" data (which isn't truly possible), we maintain data within a defined time window.

## Configuration

**Default:** 365 days (1 year)

### Where to Change the Limit

To change the historical window (e.g., from 1 year to 2 years):

1. **Frontend:** `/src/config/dataRetention.ts`
   ```typescript
   export const MAX_HISTORICAL_DAYS = 730; // Change to 730 for 2 years
   ```

2. **Backend:** `/server/src/config/dataRetention.ts`
   ```typescript
   export const MAX_HISTORICAL_DAYS = 730; // Change to 730 for 2 years
   ```

**IMPORTANT:** Both values must match to ensure consistency!

## What This Affects

### 1. Backend Sync Operations
- **Orders Sync:** First sync fetches orders from the last `MAX_HISTORICAL_DAYS`
- **Settlements Sync:** First sync fetches settlements from the last `MAX_HISTORICAL_DAYS`
- **All incremental syncs** then fetch only new data

### 2. Frontend Calculations
- **Product Management View:** Sales and Revenue metrics use only orders within the window
- **Profit & Loss View:** Calculations limited to the configured time window
- **Overview View:** All metrics respect the historical limit

### 3. UI Labels
All "All-Time" labels have been replaced with accurate time windows:
- **Before:** "All-Time Sales" (misleading)
- **After:** "Sales (365d)" or "Sales (Last 365 days)"

The labels update automatically when you change `MAX_HISTORICAL_DAYS`:
- 365 days → "365d" / "Last 365 days"
- 730 days → "2y" / "Last 2 years"

### 4. Date Picker Constraints
The `DateRangePicker` component **automatically enforces** the MAX_HISTORICAL_DAYS limit:

- **Start Date:** Cannot be earlier than `MAX_HISTORICAL_DAYS` ago
- **End Date:** Cannot be later than today
- **Presets:** Only shows presets that fit within the configured limit
- **Max Range Preset:** Dynamically labeled as "Max Range (365d)" or "Max Range (730d)"
- **Helper Text:** Shows "Earliest: [date]" and "Latest: [date]" below date inputs

This prevents users from selecting dates beyond the available data window!

## Data Sources

### Product Management Stats

| Metric | Data Source | Time Window |
|--------|-------------|-------------|
| **Sales** | Synced Orders (`orders` table) | Last `MAX_HISTORICAL_DAYS` |
| **Revenue** | Synced Orders (`orders` table) | Last `MAX_HISTORICAL_DAYS` |
| **Total Products** | Products database | Current |
| **Active Products** | Products database | Current |
| **Inventory Status** | Products database | Current |

### Why Not TikTok Product Performance API?

The TikTok Product Performance API (`/analytics/shop_products/performance`) only provides:
- **Last 30 days** of performance data
- **Limited metrics** (not comprehensive)
- **Unreliable** for historical analysis

Instead, we use:
- **Orders database:** Complete, accurate transaction history within our time window
- **Finance Statements:** Verified revenue data from TikTok's settlement system

## Helper Functions

```typescript
// Get start timestamp for queries
getHistoricalStartTime(): number  // Unix seconds

// Get start date for queries
getHistoricalStartDate(): string  // ISO date string

// Get human-readable label
getHistoricalWindowLabel(): string  // "365d" or "2y"

// Get full description
getHistoricalWindowDescription(): string  // "Last 365 days"
```

## Benefits

1. **Honesty:** No misleading "all-time" claims
2. **Consistency:** Same time window across all features
3. **Accuracy:** Real transaction data, not API estimates
4. **Flexibility:** Easy to extend the window as needed
5. **Performance:** Limited data = faster queries
6. **Scalability:** Can increase window as business grows

## Future Considerations

If you want true "lifetime" metrics:
- Consider a separate "Lifetime Stats" endpoint
- Cache aggregate totals separately
- Update incrementally rather than recalculating

For now, the 1-year window provides:
- ✅ Accurate recent performance data
- ✅ Fast query performance
- ✅ Honest, transparent metrics
- ✅ Easy to understand and maintain
