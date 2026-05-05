/** Normalize user/brand color strings to #rrggbb for pickers and API (server accepts #RGB / #RRGGBB / #RRGGBBAA). */

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;
const HEX8 = /^#([0-9a-f]{8})$/i;

export function normalizeHex6(input: string | undefined | null, fallback = '#ec4899'): string {
    let s = (input || '').trim();
    if (s && !s.startsWith('#')) s = '#' + s;
    if (HEX6.test(s)) return s.toLowerCase();
    const m3 = s.match(HEX3);
    if (m3) {
        const [r, g, b] = m3[1].split('');
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    const m8 = s.match(HEX8);
    if (m8) return `#${m8[1].slice(0, 6)}`.toLowerCase();
    return fallback;
}

export function normalizeHexAlpha(input: string | undefined | null, fallback = '#ec4899'): string {
    let s = (input || '').trim();
    if (s && !s.startsWith('#')) s = '#' + s;
    if (HEX8.test(s)) return s.toLowerCase();
    if (HEX6.test(s)) return s.toLowerCase();
    const m3 = s.match(HEX3);
    if (m3) {
        const [r, g, b] = m3[1].split('');
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return fallback;
}
