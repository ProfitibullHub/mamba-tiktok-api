/**
 * Maps TikTok Shop region codes to IANA timezone identifiers
 * Frontend version - mirrors server-side mapping
 */

export const REGION_TO_TIMEZONE: Record<string, string> = {
    // United States
    'US': 'America/Los_Angeles',

    // United Kingdom & Europe
    'GB': 'Europe/London',
    'UK': 'Europe/London',
    'DE': 'Europe/Berlin',
    'FR': 'Europe/Paris',
    'IT': 'Europe/Rome',
    'ES': 'Europe/Madrid',

    // Asia Pacific
    'SG': 'Asia/Singapore',
    'MY': 'Asia/Kuala_Lumpur',
    'TH': 'Asia/Bangkok',
    'VN': 'Asia/Ho_Chi_Minh',
    'PH': 'Asia/Manila',
    'ID': 'Asia/Jakarta',
    'CN': 'Asia/Shanghai',
    'HK': 'Asia/Hong_Kong',
    'JP': 'Asia/Tokyo',
    'KR': 'Asia/Seoul',
    'IN': 'Asia/Kolkata',
    'AU': 'Australia/Sydney',

    // Americas
    'MX': 'America/Mexico_City',
    'BR': 'America/Sao_Paulo',
    'CA': 'America/Toronto',
    'AR': 'America/Argentina/Buenos_Aires',
    'CL': 'America/Santiago',
    'CO': 'America/Bogota',
    'PE': 'America/Lima',
    'VE': 'America/Caracas',
    'EC': 'America/Guayaquil',
    'UY': 'America/Montevideo',
    'PY': 'America/Asuncion',
    'BO': 'America/La_Paz',
    'CR': 'America/Costa_Rica',
    'PA': 'America/Panama',
    'GT': 'America/Guatemala',
    'HN': 'America/Tegucigalpa',
    'SV': 'America/El_Salvador',
    'NI': 'America/Managua',
    'DO': 'America/Santo_Domingo',
    'PR': 'America/Puerto_Rico',
    'JM': 'America/Jamaica',
    'TT': 'America/Port_of_Spain',

    // Middle East & Africa
    'AE': 'Asia/Dubai',
    'SA': 'Asia/Riyadh',
    'ZA': 'Africa/Johannesburg',
    'EG': 'Africa/Cairo',
    'NG': 'Africa/Lagos',
};

/**
 * Get IANA timezone for a TikTok Shop region code
 */
export function getTimezoneForRegion(region: string): string {
    return REGION_TO_TIMEZONE[region?.toUpperCase()] || 'America/Los_Angeles';
}

/**
 * Get UTC offset string for a timezone (e.g., "UTC-5", "UTC+1")
 */
export function getTimezoneOffset(timezone: string): string {
    try {
        const now = new Date();

        // Get the offset in minutes
        const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
        const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        const offsetMinutes = (tzDate.getTime() - utcDate.getTime()) / (1000 * 60);
        const offsetHours = offsetMinutes / 60;

        if (offsetHours === 0) return 'UTC±0';

        const sign = offsetHours > 0 ? '+' : '';
        const hours = Math.floor(Math.abs(offsetHours));
        const minutes = Math.abs(offsetMinutes) % 60;

        if (minutes === 0) {
            return `UTC${sign}${offsetHours}`;
        } else {
            return `UTC${sign}${hours}:${minutes.toString().padStart(2, '0')}`;
        }
    } catch (error) {
        console.error(`Error getting offset for timezone ${timezone}:`, error);
        return 'UTC';
    }
}

/**
 * Get friendly timezone display name
 * Example: "Europe/London" -> "London (UTC+0)"
 */
export function getTimezoneDisplay(timezone: string): string {
    const city = timezone.split('/')[1]?.replace(/_/g, ' ') || timezone;
    const offset = getTimezoneOffset(timezone);
    return `${city} (${offset})`;
}
