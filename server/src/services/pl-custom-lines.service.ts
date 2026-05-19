/**
 * Custom P&L line items (per TikTok shop) + date-scoped values.
 * Dates are UTC calendar YYYY-MM-DD, aligned with settlement P&L filtering (see getUtcCalendarRangeExclusiveUnix).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const PL_CUSTOM_LINE_CATEGORIES = ['revenue', 'cogs', 'expenses', 'supplementary'] as const;
export type PLCustomLineCategory = (typeof PL_CUSTOM_LINE_CATEGORIES)[number];

export type PLCustomLineItemRow = {
    id: string;
    seller_tenant_id: string;
    tiktok_shop_id: string;
    category: string;
    name: string;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    created_by: string | null;
};

export type PLCustomLineValueRow = {
    id: string;
    line_item_id: string;
    amount: string | number;
    start_date: string;
    end_date: string | null;
    created_at: string;
    created_by: string | null;
    replaced_by?: string | null;
};

export type PLCustomEmptyValueDisplay = 'zero' | 'null';

export type PLCustomLineItemsPayload = {
    /** PRD §5.3: how to represent lines with no overlapping value in the selected range. */
    empty_amount_in_range_display: PLCustomEmptyValueDisplay;
    lines: Array<{
        id: string;
        name: string;
        category: string;
        sort_order: number;
        is_active: boolean;
        /** Null only when `empty_amount_in_range_display` is `null` and no segment overlaps the report range. */
        amount_in_range: number | null;
        value_segments: Array<{
            id: string;
            amount: number;
            amount_in_report: number;
            start_date: string;
            end_date: string | null;
        }>;
    }>;
    by_category: Record<string, number>;
};

function num(v: string | number | null | undefined): number {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
    return Number.isFinite(n) ? n : 0;
}

/** Inclusive UTC calendar bounds matching unix settlement window (endExclusive = start of day after last inclusive day). */
export function utcInclusiveReportRangeFromSettlementQuery(
    startUnix: number,
    endExclusiveUnix: number,
): { startYmd: string; endYmd: string } | null {
    if (!Number.isFinite(startUnix) || !Number.isFinite(endExclusiveUnix) || endExclusiveUnix <= startUnix) {
        return null;
    }
    const startYmd = new Date(startUnix * 1000).toISOString().slice(0, 10);
    const endYmd = new Date(endExclusiveUnix * 1000 - 1).toISOString().slice(0, 10);
    if (startYmd > endYmd) return null;
    return { startYmd, endYmd };
}

export function customValueOverlapsReportRange(
    startDate: string,
    endDate: string | null,
    reportStartYmd: string,
    reportEndYmd: string,
): boolean {
    const vEnd = endDate || '9999-12-31';
    return startDate <= reportEndYmd && vEnd >= reportStartYmd;
}

function utcEpochDayFromYmd(ymd: string): number {
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || !m || !d) return NaN;
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function daysInclusiveYmd(startYmd: string, endYmd: string): number {
    const a = utcEpochDayFromYmd(startYmd);
    const b = utcEpochDayFromYmd(endYmd);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
    return b - a + 1;
}

function minYmd(a: string, b: string): string {
    return a <= b ? a : b;
}

function maxYmd(a: string, b: string): string {
    return a >= b ? a : b;
}

/**
 * Portion of `amount` attributed to [reportStartYmd, reportEndYmd] when the value is spread
 * uniformly over its segment [segStart, segEnd]. Ongoing segments (null end) are treated as
 * running through `reportEndYmd` for the denominator so amounts entered mid-range count fully
 * in that window; long closed segments only contribute the overlapping day share.
 */
export function proratedValueAmountInReport(
    amount: number,
    segStart: string,
    segEnd: string | null,
    reportStartYmd: string,
    reportEndYmd: string,
): number {
    if (!Number.isFinite(amount) || Math.abs(amount) < 1e-12) return 0;

    const overlapStart = maxYmd(segStart, reportStartYmd);
    const overlapEnd = minYmd(segEnd ?? reportEndYmd, reportEndYmd);
    const overlapDays = daysInclusiveYmd(overlapStart, overlapEnd);
    if (overlapDays <= 0) return 0;

    const denomStart = segStart;
    const denomEnd = segEnd ?? reportEndYmd;
    const denomDays = daysInclusiveYmd(denomStart, denomEnd);
    if (denomDays <= 0) return 0;

    return (amount * overlapDays) / denomDays;
}

export async function resolveTiktokShopUuidForCustomPl(
    supabase: SupabaseClient,
    accountId: string,
    shopCipher: string | undefined,
): Promise<string | null> {
    let q = supabase.from('tiktok_shops').select('id').eq('account_id', accountId);
    if (shopCipher) {
        q = q.eq('shop_id', shopCipher);
    }
    const { data, error } = await q;
    if (error || !data?.length) return null;
    if (data.length > 1 && !shopCipher) return null;
    return data[0].id;
}

export async function buildCustomLineItemsPayload(
    supabase: SupabaseClient,
    opts: {
        tiktokShopUuid: string;
        reportStartYmd: string;
        reportEndYmd: string;
        /** Line item ids omitted from the payload (field-level restriction; no inference). */
        excludedLineItemIds?: ReadonlySet<string>;
        /** PRD §5.3: from `tiktok_shops.pl_custom_empty_value_display`. */
        emptyAmountInRangeDisplay?: PLCustomEmptyValueDisplay;
    },
): Promise<PLCustomLineItemsPayload> {
    const { tiktokShopUuid, reportStartYmd, reportEndYmd, excludedLineItemIds } = opts;
    const excluded = excludedLineItemIds ?? new Set<string>();
    const emptyDisplay: PLCustomEmptyValueDisplay =
        opts.emptyAmountInRangeDisplay === 'null' ? 'null' : 'zero';

    const { data: items, error: itemsErr } = await supabase
        .from('pl_custom_line_items')
        .select('id, seller_tenant_id, tiktok_shop_id, category, name, sort_order, is_active, created_at, created_by')
        .eq('tiktok_shop_id', tiktokShopUuid)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

    if (itemsErr) throw itemsErr;

    const lineRows = (items || []) as PLCustomLineItemRow[];
    if (lineRows.length === 0) {
        return { empty_amount_in_range_display: emptyDisplay, lines: [], by_category: {} };
    }

    const lineIds = lineRows.map((r) => r.id);
    const { data: values, error: valErr } = await supabase
        .from('pl_custom_line_item_values')
        .select('id, line_item_id, amount, start_date, end_date, created_at, created_by, replaced_by')
        .in('line_item_id', lineIds);

    if (valErr) throw valErr;
    const valueRows = (values || []) as PLCustomLineValueRow[];

    const byLine = new Map<string, PLCustomLineValueRow[]>();
    for (const v of valueRows) {
        const arr = byLine.get(v.line_item_id) || [];
        arr.push(v);
        byLine.set(v.line_item_id, arr);
    }

    const byCategory: Record<string, number> = {};
    const lines: PLCustomLineItemsPayload['lines'] = [];

    for (const item of lineRows) {
        if (excluded.has(item.id)) {
            continue;
        }

        const allActive = (byLine.get(item.id) || []).filter((v) => v.replaced_by == null || v.replaced_by === '');

        const hasOverlappingValue = allActive.some((v) =>
            customValueOverlapsReportRange(v.start_date, v.end_date, reportStartYmd, reportEndYmd),
        );

        let amountInRange = 0;
        const value_segments = allActive.map((v) => {
            const raw = num(v.amount);
            const overlaps = customValueOverlapsReportRange(v.start_date, v.end_date, reportStartYmd, reportEndYmd);
            const prorated = overlaps
                ? proratedValueAmountInReport(raw, v.start_date, v.end_date, reportStartYmd, reportEndYmd)
                : 0;
            if (overlaps) amountInRange += prorated;
            return {
                id: v.id,
                /** Full stored amount for the segment (for audit / modal detail). */
                amount: raw,
                /** Portion counted in the selected report window; 0 when the segment is outside that range. */
                amount_in_report: prorated,
                start_date: v.start_date,
                end_date: v.end_date,
            };
        });

        const rollupForCategory = amountInRange;
        const amountForApi: number | null =
            !hasOverlappingValue && emptyDisplay === 'null' ? null : !hasOverlappingValue ? 0 : amountInRange;

        if (item.is_active) {
            if (!byCategory[item.category]) byCategory[item.category] = 0;
            byCategory[item.category] += rollupForCategory;
        }

        lines.push({
            id: item.id,
            name: item.name,
            category: item.category,
            sort_order: item.sort_order,
            is_active: item.is_active,
            amount_in_range: amountForApi,
            value_segments,
        });
    }

    return { empty_amount_in_range_display: emptyDisplay, lines, by_category: byCategory };
}

export function isPlCustomCategory(v: string): v is PLCustomLineCategory {
    return (PL_CUSTOM_LINE_CATEGORIES as readonly string[]).includes(v);
}
