import { nextCalendarDayISO } from './dateUtils.js';

export type AgencyFeeType = 'retainer' | 'commission' | 'both';
export type AgencyFeeRecurrence = 'monthly' | 'quarterly' | 'biannual' | 'annual';
export type AgencyCommissionBase = 'gmv' | 'net_revenue' | 'gross_profit';

/** Minimal agency fee row for proration (matches `agency_fees` usage in the app). */
export type AgencyFeeRow = {
    id: string;
    agency_name: string;
    date: string;
    fee_type?: string | null;
    recurrence?: string | null;
    retainer_amount?: number | null;
    amount?: number | null;
    commission_rate?: number | null;
    commission_base?: string | null;
};

export interface AgencyFeeLineDetail {
    id: string;
    agencyName: string;
    feeStartDate: string;
    feeType: AgencyFeeType;
    recurrence: AgencyFeeRecurrence;
    retainerPart: number;
    commissionPart: number;
    total: number;
    notes: string[];
}

function maxYmd(a: string, b: string): string {
    return a >= b ? a : b;
}

export function countInclusiveShopDays(startYmd: string, endYmd: string, timezone: string): number {
    if (!startYmd || !endYmd || startYmd > endYmd) return 0;
    let n = 0;
    let d = startYmd;
    for (;;) {
        n++;
        if (d === endYmd) break;
        const next = nextCalendarDayISO(d, timezone);
        if (next === d) break;
        d = next;
        if (n > 4000) break;
    }
    return n;
}

function daysInGregorianMonth(ymd: string): number {
    const [y, m] = ymd.split('-').map(Number);
    if (!y || !m) return 30;
    return new Date(y, m, 0).getDate();
}

function forEachYmdInclusive(fromYmd: string, toYmd: string, timezone: string, fn: (ymd: string) => void): void {
    if (fromYmd > toYmd) return;
    let d = fromYmd;
    for (;;) {
        fn(d);
        if (d === toYmd) break;
        d = nextCalendarDayISO(d, timezone);
    }
}

function recurrenceLabel(r: AgencyFeeRecurrence): string {
    switch (r) {
        case 'quarterly':
            return 'quarterly (amount ÷ 3 per month)';
        case 'biannual':
            return 'every 6 months (amount ÷ 6 per month)';
        case 'annual':
            return 'annual (amount ÷ 12 per month)';
        default:
            return 'monthly';
    }
}

function baseLabel(base: AgencyCommissionBase): string {
    switch (base) {
        case 'gross_profit':
            return 'Gross profit';
        case 'net_revenue':
            return 'Net revenue';
        default:
            return 'GMV';
    }
}

export function computeAgencyFeesRollup(
    agencyFees: AgencyFeeRow[],
    rangeStartYmd: string,
    rangeEndYmd: string,
    timezone: string,
    bases: { grossSalesGMV: number; netRevenue: number; grossProfit: number }
): { total: number; lines: AgencyFeeLineDetail[]; summaryNotes: string[] } {
    const totalRangeDays = countInclusiveShopDays(rangeStartYmd, rangeEndYmd, timezone);
    const lines: AgencyFeeLineDetail[] = [];

    const summaryNotes = [
        `Range ${rangeStartYmd} → ${rangeEndYmd} (${totalRangeDays} day${totalRangeDays === 1 ? '' : 's'}) in shop timezone (${timezone}).`,
        'Retainer: each calendar day in range adds (period retainer ÷ months in that schedule) ÷ days in that month.',
        'Commission: (rate ÷ 100) × base metric for the full P&L range × (overlapping days ÷ range days). Base does not include agency fees.',
    ];

    for (const fee of agencyFees) {
        const feeType = (fee.fee_type ?? 'retainer') as AgencyFeeType;
        const recurrence = (fee.recurrence ?? 'monthly') as AgencyFeeRecurrence;
        const feeStart = fee.date;
        if (!feeStart || feeStart > rangeEndYmd) {
            continue;
        }

        const overlapStart = maxYmd(feeStart, rangeStartYmd);
        const overlapEnd = rangeEndYmd;
        if (overlapStart > overlapEnd) {
            continue;
        }

        const notes: string[] = [];
        let retainerPart = 0;

        const overlapDays = countInclusiveShopDays(overlapStart, overlapEnd, timezone);

        if (feeType === 'retainer' || feeType === 'both') {
            const amount = Number(fee.retainer_amount ?? fee.amount ?? 0);
            if (amount > 0) {
                forEachYmdInclusive(overlapStart, overlapEnd, timezone, (ymd) => {
                    const dim = daysInGregorianMonth(ymd);
                    let dailyRate = 0;
                    if (recurrence === 'monthly') dailyRate = amount / dim;
                    else if (recurrence === 'quarterly') dailyRate = (amount / 3) / dim;
                    else if (recurrence === 'biannual') dailyRate = (amount / 6) / dim;
                    else if (recurrence === 'annual') dailyRate = (amount / 12) / dim;
                    else dailyRate = amount / dim;
                    retainerPart += dailyRate;
                });
                notes.push(
                    `Retainer (${recurrenceLabel(recurrence)}): period $${amount.toFixed(2)}, summed daily share over ${overlapDays} shop-local day(s) → $${retainerPart.toFixed(2)}`
                );
            }
        }

        let commissionPart = 0;
        if (feeType === 'commission' || feeType === 'both') {
            const ratePct = Number(fee.commission_rate || 0);
            if (ratePct > 0) {
                const base = (fee.commission_base ?? 'gmv') as AgencyCommissionBase;
                const baseValue =
                    base === 'gross_profit'
                        ? bases.grossProfit
                        : base === 'net_revenue'
                          ? bases.netRevenue
                          : bases.grossSalesGMV;
                const activeRatio = totalRangeDays > 0 ? Math.min(1, overlapDays / totalRangeDays) : 0;
                commissionPart = (ratePct / 100) * baseValue * activeRatio;
                notes.push(
                    `Commission: (${ratePct}% ÷ 100) × ${baseLabel(base)} $${baseValue.toFixed(2)} × (${overlapDays} active days ÷ ${totalRangeDays} range days) = $${commissionPart.toFixed(2)}`
                );
            }
        }

        const total = retainerPart + commissionPart;
        if (total <= 0 && notes.length === 0) {
            continue;
        }

        lines.push({
            id: fee.id,
            agencyName: fee.agency_name,
            feeStartDate: feeStart,
            feeType,
            recurrence,
            retainerPart,
            commissionPart,
            total,
            notes,
        });
    }

    const total = lines.reduce((s, l) => s + l.total, 0);
    return { total, lines, summaryNotes };
}
