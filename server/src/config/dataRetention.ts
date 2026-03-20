/**
 * Data Retention Configuration (Server)
 * 
 * Defines the maximum historical data window for sync operations.
 * This should match the frontend configuration for consistency.
 * 
 * IMPORTANT: Changing this value will affect how far back sync operations fetch data.
 */

// Maximum days the user can request via date picker / on-demand fetch
export const MAX_HISTORICAL_DAYS = 365; // 1 year hard cap

// Default days to sync on first sync (keeps initial sync fast)
export const DEFAULT_SYNC_DAYS = 90; // 90 days for orders/products

// Settlements: Shorter window for faster syncs (90 days is enough for P&L)
export const MAX_SETTLEMENT_DAYS = 90; // 90 days (3 months)

// Helper to get the start timestamp (Unix seconds) for default sync window
export function getHistoricalStartTime(dataType?: 'settlements'): number {
    const now = Math.floor(Date.now() / 1000);
    const days = dataType === 'settlements' ? MAX_SETTLEMENT_DAYS : DEFAULT_SYNC_DAYS;
    return now - (days * 24 * 60 * 60);
}

// Helper to get the start date (ISO string) for historical data queries
export function getHistoricalStartDate(): string {
    const startTime = getHistoricalStartTime();
    return new Date(startTime * 1000).toISOString().split('T')[0];
}

// Human-readable label for logging
export function getHistoricalWindowLabel(): string {
    return `${DEFAULT_SYNC_DAYS} days`;
}
