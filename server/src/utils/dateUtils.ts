/**
 * Backend date utilities for timezone-aware date calculations.
 * Keep day-boundary logic aligned with `src/utils/dateUtils.ts` (client).
 */

/**
 * Formats date in YYYY-MM-DD in specified timezone (for calendar-day iteration).
 */
export function formatShopDateISO(date: number | Date | string, timezone: string): string {
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
 * Converts a YYYY-MM-DD date string to a Unix timestamp at the start of that day
 * in the specified timezone (same iterative strategy as the client).
 */
export function getShopDayStartTimestamp(dateStr: string, timezone: string): number {
    if (!dateStr) return 0;

    const [year, month, day] = dateStr.split('-').map(Number);

    let currentMs = Date.UTC(year, month - 1, day, 8, 0, 0, 0);

    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    });

    for (let i = 0; i < 3; i++) {
        const parts = fmt.formatToParts(currentMs);
        const p = parts.reduce(
            (acc, part) => {
                acc[part.type] = part.value;
                return acc;
            },
            {} as Record<string, string>
        );

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

export function previousCalendarDayISO(dateStr: string, timezone: string): string {
    const startSec = getShopDayStartTimestamp(dateStr, timezone);
    return formatShopDateISO((startSec - 1) * 1000, timezone);
}

export function nextCalendarDayISO(dateStr: string, timezone: string): string {
    const startSec = getShopDayStartTimestamp(dateStr, timezone);
    let probe = startSec + 1;
    const maxProbe = startSec + 48 * 3600;
    while (probe <= maxProbe && formatShopDateISO(probe * 1000, timezone) === dateStr) {
        probe += 3600;
    }
    return formatShopDateISO(probe * 1000, timezone);
}

/** Exclusive upper bound for paid_time filters — same instant as client `getShopDayEndExclusiveTimestamp`. */
export function getShopDayEndExclusiveTimestamp(dateStr: string, timezone: string): number {
    return getShopDayStartTimestamp(nextCalendarDayISO(dateStr, timezone), timezone);
}
