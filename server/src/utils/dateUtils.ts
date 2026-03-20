/**
 * Backend date utilities for timezone-aware date calculations
 */

/**
 * Converts a YYYY-MM-DD date string to a Unix timestamp at the start of that day
 * in the specified timezone.
 * 
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param timezone - IANA timezone identifier (e.g., 'America/Los_Angeles', 'Europe/London')
 * @returns Unix timestamp (seconds) at the start of the day in the specified timezone
 */
export function getShopDayStartTimestamp(dateStr: string, timezone: string): number {
    // Parse the date string
    const [year, month, day] = dateStr.split('-').map(Number);

    // Create a date string that represents midnight on the given date
    // We'll use the timezone to figure out what UTC timestamp corresponds to midnight in that timezone
    const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`;

    // Parse this as a date in the target timezone
    // We create a formatter that will give us the UTC offset for this specific date/time
    const testDate = new Date(dateString + 'Z'); // Start with UTC

    // Use Intl to format the date in the target timezone and extract components
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'longOffset'
    });

    // Get the offset by comparing the same instant in UTC vs the target timezone
    // We want to find the UTC timestamp that corresponds to midnight in the target timezone

    // Strategy: Binary search or iterative approach to find the right UTC timestamp
    // Simpler approach: Use the timezone offset

    // Create a date at noon on the target date in the target timezone to get the offset
    const noonLocal = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00`);

    // Format it in the target timezone to see what time it shows
    const parts = formatter.formatToParts(noonLocal);
    const tzYear = parseInt(parts.find(p => p.type === 'year')!.value);
    const tzMonth = parseInt(parts.find(p => p.type === 'month')!.value);
    const tzDay = parseInt(parts.find(p => p.type === 'day')!.value);
    const tzHour = parseInt(parts.find(p => p.type === 'hour')!.value);

    // Calculate the offset: if we create a UTC date at noon and it shows a different hour in the TZ,
    // that's our offset
    const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
    const tzNoon = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, 0, 0);
    const offsetMs = utcNoon - tzNoon;

    // Now calculate midnight in the target timezone
    // Midnight in TZ = midnight UTC + offset
    const midnightLocal = Date.UTC(year, month - 1, day, 0, 0, 0);
    const midnightUTC = midnightLocal + offsetMs;

    return Math.floor(midnightUTC / 1000);
}
