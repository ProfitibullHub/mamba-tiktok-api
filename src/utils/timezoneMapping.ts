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

/**
 * Grouped IANA timezone options for the timezone selector dropdown
 */
export interface TimezoneOption {
    value: string;
    label: string;
}

export interface TimezoneGroup {
    label: string;
    options: TimezoneOption[];
}

export const TIMEZONE_OPTIONS: TimezoneGroup[] = [
    {
        label: 'Americas',
        options: [
            { value: 'America/New_York', label: 'New York (Eastern)' },
            { value: 'America/Chicago', label: 'Chicago (Central)' },
            { value: 'America/Denver', label: 'Denver (Mountain)' },
            { value: 'America/Los_Angeles', label: 'Los Angeles (Pacific)' },
            { value: 'America/Anchorage', label: 'Anchorage (Alaska)' },
            { value: 'Pacific/Honolulu', label: 'Honolulu (Hawaii)' },
            { value: 'America/Phoenix', label: 'Phoenix (Arizona)' },
            { value: 'America/Toronto', label: 'Toronto (Eastern)' },
            { value: 'America/Vancouver', label: 'Vancouver (Pacific)' },
            { value: 'America/Edmonton', label: 'Edmonton (Mountain)' },
            { value: 'America/Winnipeg', label: 'Winnipeg (Central)' },
            { value: 'America/Halifax', label: 'Halifax (Atlantic)' },
            { value: 'America/Mexico_City', label: 'Mexico City' },
            { value: 'America/Sao_Paulo', label: 'São Paulo' },
            { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
            { value: 'America/Bogota', label: 'Bogotá' },
            { value: 'America/Lima', label: 'Lima' },
            { value: 'America/Santiago', label: 'Santiago' },
        ],
    },
    {
        label: 'Europe',
        options: [
            { value: 'Europe/London', label: 'London (GMT/BST)' },
            { value: 'Europe/Paris', label: 'Paris (CET)' },
            { value: 'Europe/Berlin', label: 'Berlin (CET)' },
            { value: 'Europe/Madrid', label: 'Madrid (CET)' },
            { value: 'Europe/Rome', label: 'Rome (CET)' },
            { value: 'Europe/Amsterdam', label: 'Amsterdam (CET)' },
            { value: 'Europe/Brussels', label: 'Brussels (CET)' },
            { value: 'Europe/Zurich', label: 'Zurich (CET)' },
            { value: 'Europe/Stockholm', label: 'Stockholm (CET)' },
            { value: 'Europe/Warsaw', label: 'Warsaw (CET)' },
            { value: 'Europe/Athens', label: 'Athens (EET)' },
            { value: 'Europe/Istanbul', label: 'Istanbul' },
            { value: 'Europe/Moscow', label: 'Moscow' },
        ],
    },
    {
        label: 'Asia Pacific',
        options: [
            { value: 'Asia/Dubai', label: 'Dubai (GST)' },
            { value: 'Asia/Kolkata', label: 'Mumbai/Kolkata (IST)' },
            { value: 'Asia/Bangkok', label: 'Bangkok (ICT)' },
            { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
            { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (MYT)' },
            { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh (ICT)' },
            { value: 'Asia/Manila', label: 'Manila (PHT)' },
            { value: 'Asia/Jakarta', label: 'Jakarta (WIB)' },
            { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
            { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)' },
            { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
            { value: 'Asia/Seoul', label: 'Seoul (KST)' },
            { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
            { value: 'Australia/Melbourne', label: 'Melbourne (AEST)' },
            { value: 'Australia/Perth', label: 'Perth (AWST)' },
            { value: 'Pacific/Auckland', label: 'Auckland (NZST)' },
        ],
    },
    {
        label: 'Africa & Middle East',
        options: [
            { value: 'Asia/Riyadh', label: 'Riyadh (AST)' },
            { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
            { value: 'Africa/Cairo', label: 'Cairo (EET)' },
            { value: 'Africa/Lagos', label: 'Lagos (WAT)' },
            { value: 'Africa/Nairobi', label: 'Nairobi (EAT)' },
        ],
    },
];
