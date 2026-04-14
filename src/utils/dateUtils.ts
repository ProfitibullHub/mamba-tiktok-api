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
 * Live clock string (time only) in the shop timezone, e.g. "6:31:24 PM".
 * Falls back to the browser's local timezone if `timezone` is invalid.
 */
export function formatShopTimeOnly(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: timezone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(date);
  }
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

/** Previous calendar day (YYYY-MM-DD) in `timezone` for the given shop-local date. */
export function previousCalendarDayISO(dateStr: string, timezone: string): string {
  const startSec = getShopDayStartTimestamp(dateStr, timezone);
  return formatShopDateISO((startSec - 1) * 1000, timezone);
}

/**
 * Next calendar day in `timezone`. Steps forward until `formatShopDateISO` changes (DST-safe).
 */
export function nextCalendarDayISO(dateStr: string, timezone: string): string {
  const startSec = getShopDayStartTimestamp(dateStr, timezone);
  let probe = startSec + 1;
  const maxProbe = startSec + 48 * 3600;
  while (probe <= maxProbe && formatShopDateISO(probe * 1000, timezone) === dateStr) {
    probe += 3600;
  }
  return formatShopDateISO(probe * 1000, timezone);
}

/** Unix seconds: start of the day *after* `dateStr` in the shop timezone (exclusive upper bound for range filters). */
export function getShopDayEndExclusiveTimestamp(dateStr: string, timezone: string): number {
  return getShopDayStartTimestamp(nextCalendarDayISO(dateStr, timezone), timezone);
}

/**
 * Previous comparison window aligned to shop calendar days.
 * `prevEndExclusive` matches server queries: paid_time < start of current period (no double-count at midnight).
 */
export function getPreviousPeriodRange(
  startDateISO: string,
  endDateISO: string,
  timezone: string,
  useHybrid: boolean = true
): { prevStart: number; prevEndExclusive: number } {
  const prevEndExclusive = getShopDayStartTimestamp(startDateISO, timezone);

  let span = 1;
  let d = startDateISO;
  while (d !== endDateISO) {
    d = nextCalendarDayISO(d, timezone);
    span++;
  }

  let prevStartDate = startDateISO;
  for (let i = 0; i < span; i++) {
    prevStartDate = previousCalendarDayISO(prevStartDate, timezone);
  }

  let prevStart = getShopDayStartTimestamp(prevStartDate, timezone);
  if (useHybrid && timezone === 'America/Los_Angeles') {
    prevStart -= 8 * 3600;
  }
  return { prevStart, prevEndExclusive };
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
 * UTC calendar bounds for TikTok settlement `statement_time` / `settlement_time`.
 * Those timestamps use UTC calendar midnights (e.g. 2026-02-28T00:00:00.000Z for the Feb 28 statement).
 * P&L must filter by this calendar, not shop-local day boundaries, or the wrong statement id is included.
 *
 * @param startDateYmd - inclusive start (YYYY-MM-DD)
 * @param endDateYmd - inclusive end (YYYY-MM-DD)
 * @returns Unix seconds for `settlement_time >= start` and `settlement_time < endExclusive`, or null if invalid
 */
export function getUtcCalendarRangeExclusiveUnix(
  startDateYmd: string,
  endDateYmd: string
): { start: number; endExclusive: number } | null {
  if (!startDateYmd || !endDateYmd) return null;

  const parse = (s: string) => {
    const parts = s.split('-').map(Number);
    const [y, m, d] = parts;
    if (!y || !m || !d) return null;
    return { y, m, d };
  };

  const pStart = parse(startDateYmd);
  const pEnd = parse(endDateYmd);
  if (!pStart || !pEnd) return null;

  const start = Date.UTC(pStart.y, pStart.m - 1, pStart.d) / 1000;
  const endDay = new Date(Date.UTC(pEnd.y, pEnd.m - 1, pEnd.d));
  endDay.setUTCDate(endDay.getUTCDate() + 1);
  const endExclusive = endDay.getTime() / 1000;

  if (endExclusive <= start) return null;
  return { start, endExclusive };
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

