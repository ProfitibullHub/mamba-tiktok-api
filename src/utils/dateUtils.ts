/**
 * Timezone-safe date utilities for Shop-specific timezones.
 * 
 * All dates displayed in the application must strictly adhere to the Shop's timezone
 * which is determined by the shop's region and stored in the database.
 * 
 * IMPORTANT: All functions now require a timezone parameter. Do not use hardcoded timezones.
 */

/**
 * Parses a date input (timestamp, string, or Date) and formats it strictly
 * in the specified timezone.
 * 
 * @param date - Unix timestamp (seconds), ISO string, or Date object
 * @param timezone - IANA timezone identifier (e.g., 'America/Los_Angeles', 'Europe/London')
 * @returns Formatted date string in the shop's timezone
 * 
 * Input: 1737833701 (Unix timestamp) or '2026-01-25T19:35:01Z'
 * Output: "01/25/2026, 7:35:01 PM" (in specified timezone)
 */
export function formatShopDateTime(date: number | Date | string, timezone: string = 'America/Los_Angeles'): string {
  if (!date) return 'N/A';

  // Handle Unix timestamp (seconds) vs Milliseconds
  let d: Date;
  if (typeof date === 'number') {
    // Assume seconds if small (typical for TikTok API), milliseconds if huge
    // TikTok timestamps are usually seconds.
    // 2026 timestamp ~ 1.7e9. Milliseconds ~ 1.7e12.
    if (date < 10000000000) {
      d = new Date(date * 1000);
    } else {
      d = new Date(date);
    }
  } else {
    d = new Date(date);
  }

  if (isNaN(d.getTime())) return 'Invalid Date';

  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: timezone
  });

  return formatter.format(d);
}

/**
 * Formats just the date part (MM/DD/YYYY) in specified timezone.
 * Useful for grouping or simple display.
 * 
 * @param date - Unix timestamp (seconds), ISO string, or Date object
 * @param timezone - IANA timezone identifier
 * @returns Formatted date string (MM/DD/YYYY)
 */
export function formatShopDate(date: number | Date | string, timezone: string = 'America/Los_Angeles'): string {
  if (!date) return '';

  let d: Date;
  if (typeof date === 'number') {
    if (date < 10000000000) {
      d = new Date(date * 1000);
    } else {
      d = new Date(date);
    }
  } else {
    d = new Date(date);
  }

  if (isNaN(d.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone
  });

  return formatter.format(d);
}

/**
 * Formats date in YYYY-MM-DD format (ISO date string) in specified timezone.
 * Use this for API calls and backend communication.
 * 
 * @param date - Unix timestamp (seconds), ISO string, or Date object
 * @param timezone - IANA timezone identifier
 * @returns Formatted date string (YYYY-MM-DD)
 */
export function formatShopDateISO(date: number | Date | string, timezone: string = 'America/Los_Angeles'): string {
  if (!date) return '';

  let d: Date;
  if (typeof date === 'number') {
    if (date < 10000000000) {
      d = new Date(date * 1000);
    } else {
      d = new Date(date);
    }
  } else {
    d = new Date(date);
  }

  if (isNaN(d.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone
  });

  const parts = formatter.formatToParts(d);
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;

  return `${year}-${month}-${day}`;
}


/**
 * Helper to get START of day in specified timezone for a given date string (YYYY-MM-DD).
 * Returns Unix timestamp (seconds) UTC.
 * Ensures that 00:00:00 in the shop's timezone corresponds to the returned UTC timestamp.
 * 
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param timezone - IANA timezone identifier
 * @returns Unix timestamp (seconds) representing start of day in shop timezone
 */
export function getShopDayStartTimestamp(dateStr: string, timezone: string = 'America/Los_Angeles'): number {
  if (!dateStr) return 0;

  const [year, month, day] = dateStr.split('-').map(Number);

  // Guess UTC time: 08:00 UTC is usually 00:00 PST (UTC-8)
  let currentMs = Date.UTC(year, month - 1, day, 8, 0, 0, 0);

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false
  });

  // Iteratively adjust to find exact 00:00:00 in Shop Timezone
  for (let i = 0; i < 3; i++) {
    const parts = fmt.formatToParts(currentMs);
    const p = parts.reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {} as Record<string, string>);

    const hour = parseInt(p.hour);
    const shopTimeAsUtc = Date.UTC(
      parseInt(p.year),
      parseInt(p.month) - 1,
      parseInt(p.day),
      hour === 24 ? 0 : hour,
      parseInt(p.minute),
      parseInt(p.second)
    );

    const targetTimeAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);

    const diff = shopTimeAsUtc - targetTimeAsUtc;
    if (diff === 0) {
      return currentMs / 1000;
    }

    currentMs -= diff;
  }

  return currentMs / 1000;
}

/**
 * ORIGINAL UTILS (Preserved for compatibility but deprecated for UI display)
 */

export function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

export function parseUTCDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00Z');
}


/**
 * Converts a saved date preset ID (e.g. 'today', 'last7', 'mtd') to an
 * actual { startDate, endDate } range using timezone-aware formatting.
 * Matches the DATE_PRESETS defined in OverviewView.
 */
export function getDateRangeFromPreset(
  preset: string,
  timezone: string = 'America/Los_Angeles'
): { startDate: string; endDate: string } {
  const today = new Date();
  const todayStr = formatShopDateISO(today, timezone);

  switch (preset) {
    case 'yesterday': {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const s = formatShopDateISO(d, timezone);
      return { startDate: s, endDate: s };
    }
    case 'last7': {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return { startDate: formatShopDateISO(d, timezone), endDate: todayStr };
    }
    case 'last30': {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      return { startDate: formatShopDateISO(d, timezone), endDate: todayStr };
    }
    case 'mtd': {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: formatShopDateISO(d, timezone), endDate: todayStr };
    }
    case 'lastMonth': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: formatShopDateISO(start, timezone), endDate: formatShopDateISO(end, timezone) };
    }
    case 'today':
    default:
      return { startDate: todayStr, endDate: todayStr };
  }
}

export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper to align Previous Period calculation with Seller Center's hybrid logic.
// Seller Center uses UTC-aligned days for historical comparisons even if the shop is in Local Time.
// This manifests as an ~8-hour gap (UTC-8) for America/Los_Angeles shops.
export const getPreviousPeriodRange = (currentStart: number, currentEnd: number, timezone: string, useHybrid: boolean = true) => {
  const duration = currentEnd - currentStart;
  let prevStart = currentStart - duration;
  const prevEnd = currentStart; // Exclusive end of previous period is start of current

  // HYBRID FIX: Seller Center uses UTC start for previous period in LA timezone.
  // This captures an extra 8 hours of data (the gap).
  if (useHybrid && timezone === 'America/Los_Angeles') {
    const offsetSeconds = 8 * 3600; // 8 hours
    prevStart = prevStart - offsetSeconds;
  }

  return { prevStart, prevEnd };
};
