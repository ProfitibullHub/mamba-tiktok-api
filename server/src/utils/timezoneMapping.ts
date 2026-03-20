/**
 * Maps TikTok Shop region codes to IANA timezone identifiers
 * 
 * TikTok Shop provides a region code (e.g., "US", "GB", "SG") which we map
 * to the appropriate IANA timezone for accurate date calculations.
 */

export const REGION_TO_TIMEZONE: Record<string, string> = {
    // United States - Default to Pacific for US
    'US': 'America/Los_Angeles',

    // United Kingdom & Europe
    'GB': 'Europe/London',
    'UK': 'Europe/London',
    'DE': 'Europe/Berlin',
    'FR': 'Europe/Paris',
    'IT': 'Europe/Rome',
    'ES': 'Europe/Madrid',
    'NL': 'Europe/Amsterdam',
    'BE': 'Europe/Brussels',
    'PL': 'Europe/Warsaw',
    'SE': 'Europe/Stockholm',
    'NO': 'Europe/Oslo',
    'DK': 'Europe/Copenhagen',
    'FI': 'Europe/Helsinki',

    // Asia Pacific
    'SG': 'Asia/Singapore',
    'MY': 'Asia/Kuala_Lumpur',
    'TH': 'Asia/Bangkok',
    'VN': 'Asia/Ho_Chi_Minh',
    'PH': 'Asia/Manila',
    'ID': 'Asia/Jakarta',
    'CN': 'Asia/Shanghai',
    'HK': 'Asia/Hong_Kong',
    'TW': 'Asia/Taipei',
    'JP': 'Asia/Tokyo',
    'KR': 'Asia/Seoul',
    'IN': 'Asia/Kolkata',
    'AU': 'Australia/Sydney',
    'NZ': 'Pacific/Auckland',

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
    'KE': 'Africa/Nairobi',
    'IL': 'Asia/Jerusalem',
    'TR': 'Europe/Istanbul',
};

/**
 * Get IANA timezone for a TikTok Shop region code
 */
export function getTimezoneForRegion(region: string): string {
    const timezone = REGION_TO_TIMEZONE[region?.toUpperCase()];
    if (!timezone) {
        console.warn(`Unknown region "${region}", defaulting to America/Los_Angeles`);
        return 'America/Los_Angeles';
    }
    return timezone;
}

/**
 * Get UTC offset string for a timezone (e.g., "UTC-5", "UTC+1")
 */
export function getTimezoneOffset(timezone: string): string {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeZoneName: 'shortOffset'
        });

        const parts = formatter.formatToParts(now);
        const offsetPart = parts.find(p => p.type === 'timeZoneName');

        if (offsetPart?.value) {
            // Convert "GMT-5" to "UTC-5"
            return offsetPart.value.replace('GMT', 'UTC');
        }

        // Fallback: calculate offset manually
        const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
        const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        const offset = (tzDate.getTime() - utcDate.getTime()) / (1000 * 60 * 60);

        if (offset === 0) return 'UTC';
        const sign = offset > 0 ? '+' : '';
        return `UTC${sign}${offset}`;
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
