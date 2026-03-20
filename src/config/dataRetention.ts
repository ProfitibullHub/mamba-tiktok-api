/**
 * Data Retention Configuration
 * 
 * Defines the maximum historical data window for the entire system.
 * This ensures consistency across:
 * - Backend sync operations
 * - Frontend calculations
 * - UI labels and tooltips
 * 
 * IMPORTANT: Changing this value will affect:
 * 1. How far back sync operations fetch data
 * 2. What data is included in "All-Time" metrics
 * 3. UI labels throughout the application
 */

// Maximum days the user can pick via date picker (on-demand fetch for older data)
export const MAX_HISTORICAL_DAYS = 365; // 1 year hard cap

// Days loaded on initial page visit (7 current + 7 comparison + 2 buffer)
// This is the fallback when no user preference is set
export const INITIAL_LOAD_DAYS = 16;

// Default days synced on first load (older data fetched on-demand when user picks it)
export const DEFAULT_SYNC_DAYS = 90;

// Selectable presets for how many days to load on initial page visit
export const LOAD_DAY_OPTIONS = [
    { value: 3,  label: '3 Days',  description: 'Fastest load · Limited historical data' },
    { value: 7,  label: '7 Days',  description: 'Fast load · 1 week of history' },
    { value: 14, label: '14 Days', description: 'Balanced · 2 weeks of history' },
    { value: 30, label: '30 Days', description: 'Standard · 1 month of history' },
    { value: 90, label: '90 Days', description: 'Comprehensive · Slower initial load' },
] as const;

// Default selection for new users (7 days)
export const DEFAULT_LOAD_DAYS = 3;

/**
 * Calculate the actual number of days to load from Supabase, with buffer.
 * Formula: selectedDays * 2 + 2  (selected range + equal comparison period + 2-day buffer)
 * This ensures comparison charts always have data for the previous period.
 */
export function getInitialLoadDaysWithBuffer(selectedDays: number): number {
    return selectedDays * 2 + 2;
}

// Helper to get the start timestamp (Unix seconds) for historical data queries
export function getHistoricalStartTime(): number {
    const now = Math.floor(Date.now() / 1000);
    return now - (MAX_HISTORICAL_DAYS * 24 * 60 * 60);
}

// Helper to get the start date (YYYY-MM-DD in local time) for historical data queries
export function getHistoricalStartDate(): string {
    const date = new Date();
    date.setDate(date.getDate() - MAX_HISTORICAL_DAYS);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Human-readable label for the time window
export function getHistoricalWindowLabel(): string {
    if (MAX_HISTORICAL_DAYS >= 365) {
        const years = Math.floor(MAX_HISTORICAL_DAYS / 365);
        return years === 1 ? '365d' : `${years}y`;
    }
    return `${MAX_HISTORICAL_DAYS}d`;
}

// Full description for tooltips
export function getHistoricalWindowDescription(): string {
    if (MAX_HISTORICAL_DAYS >= 365) {
        const years = Math.floor(MAX_HISTORICAL_DAYS / 365);
        return years === 1 ? 'Last 365 days' : `Last ${years} years`;
    }
    return `Last ${MAX_HISTORICAL_DAYS} days`;
}
