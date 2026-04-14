import type { AgencyFee, AgencyCommissionBase, AgencyFeeRecurrence, AgencyFeeType } from '../lib/supabase';
import { nextCalendarDayISO } from './dateUtils';

export interface AgencyFeeLineDetail {
  id: string;
  agencyName: string;
  /** Fee record start date (YYYY-MM-DD) */
  feeStartDate: string;
  feeType: AgencyFeeType;
  recurrence: AgencyFeeRecurrence;
  retainerPart: number;
  commissionPart: number;
  total: number;
  /** Human-readable calculation steps */
  notes: string[];
}

function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Inclusive calendar days from start to end in shop timezone (walks with nextCalendarDayISO). */
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

function forEachYmdInclusive(
  fromYmd: string,
  toYmd: string,
  timezone: string,
  fn: (ymd: string) => void
): void {
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

/**
 * Prorates manual agency fees over the P&L date range using the shop calendar (IANA timezone).
 * Retainer: sum of (period amount ÷ months-in-period-per-month) ÷ daysInMonth for each day in overlap.
 * Commission: rate × base metric for full range × (active inclusive days ÷ total inclusive range days).
 */
export function computeAgencyFeesRollup(
  agencyFees: AgencyFee[],
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
