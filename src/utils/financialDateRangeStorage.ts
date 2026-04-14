const KEY_PREFIX = 'mamba:financial_date_range_v1:';

function key(shopId: string | undefined) {
    return `${KEY_PREFIX}${shopId || 'default'}`;
}

/** Same shape as `DateRange` from DateRangePicker (avoid importing from components here). */
export interface PersistedFinancialDateRange {
    startDate: string;
    endDate: string;
}

/** Last explicit date range picked for a shop (shared by P&L, Finance Debug, etc.). */
export function loadPersistedFinancialDateRange(shopId: string | undefined): PersistedFinancialDateRange | null {
    try {
        const raw = localStorage.getItem(key(shopId));
        if (!raw) return null;
        const p = JSON.parse(raw) as { startDate?: string; endDate?: string };
        if (
            typeof p.startDate === 'string' &&
            typeof p.endDate === 'string' &&
            p.startDate.length >= 8 &&
            p.endDate.length >= 8
        ) {
            return { startDate: p.startDate, endDate: p.endDate };
        }
    } catch {
        /* ignore */
    }
    return null;
}

export function persistFinancialDateRange(shopId: string | undefined, range: PersistedFinancialDateRange) {
    try {
        localStorage.setItem(key(shopId), JSON.stringify({ startDate: range.startDate, endDate: range.endDate }));
    } catch {
        /* ignore */
    }
}
