/**
 * Sum TikTok statement_transactions envelope fields for Finance Debug comparison views.
 */

export type EnvelopeResultInput = {
    /** Statement ID from the request URL (always prefer this for display). */
    statement_id?: string;
    error?: string;
    tiktok?: {
        code?: number;
        data?: {
            id?: string | number;
            currency?: string;
            payable_amount?: string;
            total_settlement_amount?: string;
            total_reserve_amount?: string;
            total_count?: number;
            total_settlement_breakdown?: Record<string, string | number>;
            transactions?: any[];
            [key: string]: unknown;
        };
    };
};

const SKIP_TRANSACTION_KEYS = new Set([
    'id',
    'type',
    'status',
    'order_id',
    'order_create_time',
    'adjustment_id',
    'adjustment_order_id',
    'associated_order_id',
    'reserve_id',
    'reserve_status',
    'estimated_release_time',
]);

export function parseAmountField(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const t = String(v).trim();
    if (t === '') return 0;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : 0;
}

function looksLikeAmountString(s: string): boolean {
    const t = s.trim();
    if (t === '') return false;
    if (!/^-?\d+(\.\d+)?$/.test(t)) return false;
    const digits = t.replace(/^-/, '').replace(/\./g, '');
    if (!t.includes('.') && digits.length >= 16) return false;
    return true;
}

/** Recursively sum amount-like string/number leaves on a single transaction object. */
export function sumTransactionLeaves(tx: any, acc: Record<string, number>, prefix = ''): void {
    if (tx === null || tx === undefined) return;
    if (Array.isArray(tx)) {
        tx.forEach((item, i) => sumTransactionLeaves(item, acc, `${prefix}[${i}]`));
        return;
    }
    if (typeof tx !== 'object') return;

    for (const [key, val] of Object.entries(tx)) {
        if (SKIP_TRANSACTION_KEYS.has(key)) continue;
        const path = prefix ? `${prefix}.${key}` : key;

        if (val === null || val === undefined) continue;

        if (typeof val === 'string') {
            if (looksLikeAmountString(val)) {
                acc[path] = (acc[path] || 0) + parseFloat(val.trim());
            }
            continue;
        }
        if (typeof val === 'number') {
            if (Number.isFinite(val)) acc[path] = (acc[path] || 0) + val;
            continue;
        }
        if (typeof val === 'object') {
            sumTransactionLeaves(val, acc, path);
        }
    }
}

/** Same affiliate-related fee leaves as Finance Debug reconciliation / P&amp;L fee aggregation. */
export const AFFILIATE_COGS_FEE_FIELD_KEYS = [
    'affiliate_commission_amount',
    'affiliate_partner_commission_amount',
    'affiliate_ads_commission_amount',
    'external_affiliate_marketing_fee_amount',
    'cofunded_creator_bonus_amount',
] as const;

/**
 * TikTok Seller Center "Est. commission" scope (see plFeeAggregation.tiktokEstCommissionFeeKeys).
 * Excludes affiliate ads commission and external marketing fee.
 * Excludes affiliate_commission_amount_before_pit (same economic amount as affiliate_commission_amount).
 */
export const TIKTOK_EST_COMMISSION_FEE_FIELD_KEYS = [
    'affiliate_commission_amount',
    'affiliate_partner_commission_amount',
    'cofunded_creator_bonus_amount',
] as const;

/** Short labels for table headers (API field names on `fee_tax_breakdown.fee`). */
export const affiliateCogsFeeFieldLabels: Record<(typeof AFFILIATE_COGS_FEE_FIELD_KEYS)[number], string> = {
    affiliate_commission_amount: 'Affiliate commission',
    affiliate_partner_commission_amount: 'Partner commission',
    affiliate_ads_commission_amount: 'Affiliate ads commission',
    external_affiliate_marketing_fee_amount: 'External affiliate marketing',
    cofunded_creator_bonus_amount: 'Co-funded creator bonus',
};

export function sumAffiliateFeeFieldsByKey(transactions: any[] | undefined): Record<string, number> {
    const out: Record<string, number> = {};
    for (const k of AFFILIATE_COGS_FEE_FIELD_KEYS) out[k] = 0;
    if (!Array.isArray(transactions)) return out;
    for (const tx of transactions) {
        const fee = tx?.fee_tax_breakdown?.fee;
        if (!fee || typeof fee !== 'object') continue;
        for (const k of AFFILIATE_COGS_FEE_FIELD_KEYS) {
            out[k] += parseAmountField((fee as Record<string, unknown>)[k]);
        }
    }
    return out;
}

export function sumAffiliateCommissionFromTransactions(transactions: any[] | undefined): number {
    const byKey = sumAffiliateFeeFieldsByKey(transactions);
    return AFFILIATE_COGS_FEE_FIELD_KEYS.reduce((s, k) => s + (byKey[k] || 0), 0);
}

export function sumTiktokEstCommissionFromTransactions(transactions: any[] | undefined): number {
    const byKey = sumAffiliateFeeFieldsByKey(transactions);
    return TIKTOK_EST_COMMISSION_FEE_FIELD_KEYS.reduce((s, k) => s + (byKey[k] || 0), 0);
}

/** Compare TikTok snowflake IDs (string or JSON number; avoids conflating different IDs). */
export function snowflakeIdsDiffer(a: string, b: string): boolean {
    if (!a || !b) return false;
    if (a === b) return false;
    try {
        return BigInt(a.trim()) !== BigInt(b.trim());
    } catch {
        return a.trim() !== b.trim();
    }
}

function pickRequestedStatementId(r: EnvelopeResultInput): string {
    const v = r.statement_id;
    if (v == null) return '';
    return String(v).trim();
}

function pickEnvelopeBodyId(data: { id?: string | number } | undefined): string {
    if (!data || data.id == null) return '';
    return String(data.id).trim();
}

export type StatementSummaryRow = {
    /** ID we requested in the API path — never replaced by envelope body id. */
    statement_id: string;
    /** Present when TikTok JSON `data.id` differs from the requested id (rare; also note JSON number precision). */
    tiktok_envelope_body_id?: string;
    ok: boolean;
    error?: string;
    currency?: string;
    payable_amount: number;
    total_settlement_amount: number;
    total_reserve_amount: number;
    total_count_api: number;
    transactions_in_payload: number;
    /** Sum of affiliate-related amounts on each transaction line (fee_tax_breakdown.fee), for the rows returned in this envelope. */
    affiliate_commission_total: number;
    /** Seller Center "Est. commission" scope (excludes affiliate ads + external affiliate marketing lines). */
    est_commission_total: number;
    /** Per-field sums on `fee_tax_breakdown.fee` across merged transaction lines. */
    affiliate_fee_by_field: Record<string, number>;
    breakdown: Record<string, number>;
};

export function sectionForTransactionPath(path: string): string {
    if (path.startsWith('fee_tax_breakdown.fee')) return 'fee_tax_breakdown › fee';
    if (path.startsWith('fee_tax_breakdown.tax')) return 'fee_tax_breakdown › tax';
    if (path.startsWith('revenue_breakdown')) return 'revenue_breakdown';
    if (path.startsWith('shipping_cost_breakdown.supplementary_component')) {
        return 'shipping_cost_breakdown › supplementary_component';
    }
    if (path.startsWith('shipping_cost_breakdown')) return 'shipping_cost_breakdown';
    if (path.startsWith('supplementary_component')) return 'supplementary_component';
    if (!path.includes('.')) return 'transaction (top-level amounts)';
    return 'other nested';
}

export function aggregateEnvelopeResults(results: EnvelopeResultInput[] | undefined) {
    const transactionSums: Record<string, number> = {};
    const statementRows: StatementSummaryRow[] = [];
    let transactionObjectsCounted = 0;

    if (!Array.isArray(results)) {
        return { statementRows, transactionSums, transactionObjectsCounted, statementCount: 0 };
    }

    for (const r of results) {
        const requested = pickRequestedStatementId(r);

        if (r.error || !r.tiktok?.data) {
            const bodyFallback = pickEnvelopeBodyId(r.tiktok?.data);
            const displayId = requested || bodyFallback || '?';
            statementRows.push({
                statement_id: displayId,
                ok: false,
                error: r.error || 'No data',
                payable_amount: 0,
                total_settlement_amount: 0,
                total_reserve_amount: 0,
                total_count_api: 0,
                transactions_in_payload: 0,
                affiliate_commission_total: 0,
                est_commission_total: 0,
                affiliate_fee_by_field: sumAffiliateFeeFieldsByKey(undefined),
                breakdown: {},
            });
            continue;
        }

        const data = r.tiktok.data;
        const bodyId = pickEnvelopeBodyId(data);
        const displayId = requested || bodyId || '?';
        const tiktok_envelope_body_id =
            requested && bodyId && snowflakeIdsDiffer(requested, bodyId) ? bodyId : undefined;
        const breakdown: Record<string, number> = {};
        const tsb = data.total_settlement_breakdown;
        if (tsb && typeof tsb === 'object') {
            for (const [k, v] of Object.entries(tsb)) {
                breakdown[k] = parseAmountField(v);
            }
        }

        const txs = data.transactions;
        const txList = Array.isArray(txs) ? txs : [];
        transactionObjectsCounted += txList.length;

        for (const tx of txList) {
            sumTransactionLeaves(tx, transactionSums);
        }

        const affiliate_fee_by_field = sumAffiliateFeeFieldsByKey(txList);
        const affiliate_commission_total = sumAffiliateCommissionFromTransactions(txList);
        const est_commission_total = sumTiktokEstCommissionFromTransactions(txList);

        statementRows.push({
            statement_id: displayId,
            tiktok_envelope_body_id,
            ok: true,
            currency: typeof data.currency === 'string' ? data.currency : undefined,
            payable_amount: parseAmountField(data.payable_amount),
            total_settlement_amount: parseAmountField(data.total_settlement_amount),
            total_reserve_amount: parseAmountField(data.total_reserve_amount),
            total_count_api: typeof data.total_count === 'number' ? data.total_count : parseAmountField(data.total_count),
            transactions_in_payload: txList.length,
            affiliate_commission_total,
            est_commission_total,
            affiliate_fee_by_field,
            breakdown,
        });
    }

    const grouped = groupTransactionSumsBySection(transactionSums);

    return {
        statementRows,
        transactionSums,
        groupedTransactionSums: grouped,
        transactionObjectsCounted,
        statementCount: statementRows.filter((x) => x.ok).length,
    };
}

export function groupTransactionSumsBySection(
    sums: Record<string, number>
): Record<string, Array<{ path: string; sum: number }>> {
    const out: Record<string, Array<{ path: string; sum: number }>> = {};
    for (const [path, sum] of Object.entries(sums)) {
        if (!Number.isFinite(sum)) continue;
        const sec = sectionForTransactionPath(path);
        if (!out[sec]) out[sec] = [];
        out[sec].push({ path, sum });
    }
    for (const arr of Object.values(out)) {
        arr.sort((a, b) => a.path.localeCompare(b.path));
    }
    return out;
}

export function sumStatementColumn(rows: StatementSummaryRow[], pick: keyof StatementSummaryRow | 'breakdown'): number {
    if (pick === 'breakdown') return 0;
    return rows.filter((r) => r.ok).reduce((s, r) => s + (typeof r[pick] === 'number' ? (r[pick] as number) : 0), 0);
}

export function sumBreakdownKey(rows: StatementSummaryRow[], key: string): number {
    return rows.filter((r) => r.ok).reduce((s, r) => s + (r.breakdown[key] || 0), 0);
}

export function sumAffiliateFeeFieldAcrossStatements(rows: StatementSummaryRow[], fieldKey: string): number {
    return rows.filter((r) => r.ok).reduce((s, r) => s + (r.affiliate_fee_by_field[fieldKey] || 0), 0);
}
