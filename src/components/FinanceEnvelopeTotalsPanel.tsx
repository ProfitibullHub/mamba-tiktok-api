import { useMemo } from 'react';
import {
    AFFILIATE_COGS_FEE_FIELD_KEYS,
    TIKTOK_EST_COMMISSION_FEE_FIELD_KEYS,
    affiliateCogsFeeFieldLabels,
    aggregateEnvelopeResults,
    sumAffiliateFeeFieldAcrossStatements,
    sumBreakdownKey,
    type EnvelopeResultInput,
    type StatementSummaryRow,
} from '../utils/tiktokEnvelopeTotals';

const SECTION_ORDER = [
    'transaction (top-level amounts)',
    'fee_tax_breakdown › fee',
    'fee_tax_breakdown › tax',
    'revenue_breakdown',
    'shipping_cost_breakdown',
    'shipping_cost_breakdown › supplementary_component',
    'supplementary_component',
    'other nested',
];

function fmt(n: number) {
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatementIdCell({ row }: { row: StatementSummaryRow }) {
    if (!row.ok) {
        return (
            <div className="max-w-[220px]">
                <div className="font-mono text-xs text-gray-400 truncate" title={row.statement_id}>
                    {row.statement_id}
                </div>
                <span className="text-red-400 text-xs">{row.error || 'Error'}</span>
            </div>
        );
    }
    return (
        <div className="max-w-[240px]">
            <div className="font-mono text-xs truncate" title={row.statement_id}>
                {row.statement_id}
            </div>
            {row.tiktok_envelope_body_id && (
                <div className="text-[10px] text-amber-200/90 mt-1 leading-snug">
                    TikTok JSON <span className="font-mono">data.id</span> differs:{' '}
                    <span className="font-mono text-amber-100">{row.tiktok_envelope_body_id}</span>
                </div>
            )}
        </div>
    );
}

export function FinanceEnvelopeTotalsPanel({ results }: { results: EnvelopeResultInput[] | undefined }) {
    const agg = useMemo(() => aggregateEnvelopeResults(results), [results]);

    const breakdownKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const r of agg.statementRows) {
            if (r.ok) Object.keys(r.breakdown).forEach((k) => keys.add(k));
        }
        return Array.from(keys).sort();
    }, [agg.statementRows]);

    const sectionKeys = useMemo(() => {
        const g = agg.groupedTransactionSums;
        const ordered = SECTION_ORDER.filter((s) => g[s]?.length);
        const rest = Object.keys(g).filter((s) => !SECTION_ORDER.includes(s)).sort();
        return [...ordered, ...rest];
    }, [agg.groupedTransactionSums]);

    return (
        <div className="space-y-8 text-sm">
            <section>
                <h4 className="text-white font-semibold mb-3 text-base">Per-statement totals (TikTok API summary)</h4>
                <p className="text-gray-500 text-xs mb-2">
                    One row per fetched statement envelope (statement-level fields + TikTok{' '}
                    <span className="font-mono text-gray-400">total_settlement_breakdown</span>). Affiliate line items are in the table below.
                </p>
                <div className="overflow-x-auto border border-gray-800 rounded-lg">
                    <table className="w-full text-left text-gray-300">
                        <thead className="bg-gray-800 text-gray-200 text-xs uppercase">
                            <tr>
                                <th className="px-3 py-2 max-w-[240px]">
                                    Statement ID
                                    <span className="block text-[10px] font-normal text-gray-500 normal-case mt-0.5">
                                        Requested URL id; see note if JSON data.id differs
                                    </span>
                                </th>
                                <th className="px-3 py-2">CCY</th>
                                <th className="px-3 py-2 text-right">Payable</th>
                                <th className="px-3 py-2 text-right">Settlement</th>
                                <th className="px-3 py-2 text-right">Reserve</th>
                                <th className="px-3 py-2 text-right">total_count</th>
                                <th className="px-3 py-2 text-right">Tx rows</th>
                                {breakdownKeys.map((k) => (
                                    <th key={k} className="px-3 py-2 text-right whitespace-nowrap max-w-[140px] truncate" title={k}>
                                        {k.replace(/_/g, ' ')}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {agg.statementRows.map((row) => (
                                <tr key={row.statement_id + (row.error || '')} className={row.ok ? '' : 'bg-red-500/5'}>
                                    <td className="px-3 py-2 align-top">
                                        <StatementIdCell row={row} />
                                    </td>
                                    <td className="px-3 py-2">{row.ok ? row.currency ?? '—' : '—'}</td>
                                    <td className="px-3 py-2 text-right">{row.ok ? fmt(row.payable_amount) : '—'}</td>
                                    <td className="px-3 py-2 text-right">{row.ok ? fmt(row.total_settlement_amount) : '—'}</td>
                                    <td className="px-3 py-2 text-right">{row.ok ? fmt(row.total_reserve_amount) : '—'}</td>
                                    <td className="px-3 py-2 text-right">{row.ok ? row.total_count_api : '—'}</td>
                                    <td className="px-3 py-2 text-right">{row.ok ? row.transactions_in_payload : '—'}</td>
                                    {breakdownKeys.map((k) => (
                                        <td key={k} className="px-3 py-2 text-right whitespace-nowrap">
                                            {row.ok ? fmt(row.breakdown[k] || 0) : '—'}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            {agg.statementRows.some((r) => r.ok) && (
                                <tr className="bg-pink-500/10 font-medium text-white border-t border-pink-500/30">
                                    <td className="px-3 py-2" colSpan={2}>
                                        Grand total (statements)
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {fmt(agg.statementRows.filter((r) => r.ok).reduce((s, r) => s + r.payable_amount, 0))}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {fmt(agg.statementRows.filter((r) => r.ok).reduce((s, r) => s + r.total_settlement_amount, 0))}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {fmt(agg.statementRows.filter((r) => r.ok).reduce((s, r) => s + r.total_reserve_amount, 0))}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {agg.statementRows.filter((r) => r.ok).reduce((s, r) => s + r.total_count_api, 0)}
                                    </td>
                                    <td className="px-3 py-2 text-right">{agg.transactionObjectsCounted}</td>
                                    {breakdownKeys.map((k) => (
                                        <td key={k} className="px-3 py-2 text-right">
                                            {fmt(sumBreakdownKey(agg.statementRows, k))}
                                        </td>
                                    ))}
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            <section>
                <h4 className="text-white font-semibold mb-1 text-base">Affiliate commission breakdown</h4>
                <p className="text-gray-500 text-xs mb-3">
                    Each column is the sum of that field on <span className="font-mono text-gray-400">transactions[].fee_tax_breakdown.fee</span> across{' '}
                    <strong className="text-gray-300">all merged transaction pages</strong> for that statement.{' '}
                    <span className="text-emerald-200/90">Affiliate COGS total</span> = sum of the five fee columns.{' '}
                    <span className="text-sky-200/90">Est. commission</span> = sum of the three Seller Center fields (excludes ads + external marketing; before PIT omitted as duplicate of affiliate commission).
                </p>
                <div className="overflow-x-auto border border-emerald-900/40 rounded-lg">
                    <table className="w-full text-left text-gray-300">
                        <thead className="bg-gray-800 text-gray-200 text-xs">
                            <tr>
                                <th className="px-3 py-2 text-left uppercase max-w-[240px]">
                                    Statement ID
                                    <span className="block text-[10px] font-normal text-gray-500 normal-case mt-0.5">
                                        Same as API request
                                    </span>
                                </th>
                                {AFFILIATE_COGS_FEE_FIELD_KEYS.map((k) => (
                                    <th
                                        key={k}
                                        className="px-3 py-2 text-right whitespace-nowrap min-w-[120px] max-w-[200px]"
                                        title={k}
                                    >
                                        <span className="block normal-case text-[10px] text-gray-400 leading-tight">{k}</span>
                                        <span className="block text-gray-200 font-medium">{affiliateCogsFeeFieldLabels[k]}</span>
                                    </th>
                                ))}
                                <th className="px-3 py-2 text-right whitespace-nowrap bg-emerald-950/40 text-emerald-200">
                                    Affiliate COGS total
                                </th>
                                <th className="px-3 py-2 text-right whitespace-nowrap bg-sky-950/40 text-sky-200">Est. commission (SC)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {agg.statementRows.map((row) => (
                                <tr key={`aff-${row.statement_id}`} className={row.ok ? '' : 'bg-red-500/5'}>
                                    <td className="px-3 py-2 align-top">
                                        <StatementIdCell row={row} />
                                    </td>
                                    {AFFILIATE_COGS_FEE_FIELD_KEYS.map((k) => (
                                        <td key={k} className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
                                            {row.ok ? fmt(row.affiliate_fee_by_field[k] || 0) : '—'}
                                        </td>
                                    ))}
                                    <td className="px-3 py-2 text-right font-mono bg-emerald-950/20 text-emerald-100">
                                        {row.ok ? fmt(row.affiliate_commission_total) : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono bg-sky-950/20 text-sky-100">
                                        {row.ok ? fmt(row.est_commission_total) : '—'}
                                    </td>
                                </tr>
                            ))}
                            {agg.statementRows.some((r) => r.ok) && (
                                <tr className="bg-pink-500/10 font-medium text-white border-t border-pink-500/30">
                                    <td className="px-3 py-2">Grand total</td>
                                    {AFFILIATE_COGS_FEE_FIELD_KEYS.map((k) => (
                                        <td key={k} className="px-3 py-2 text-right font-mono">
                                            {fmt(sumAffiliateFeeFieldAcrossStatements(agg.statementRows, k))}
                                        </td>
                                    ))}
                                    <td className="px-3 py-2 text-right font-mono bg-emerald-950/30">
                                        {fmt(
                                            agg.statementRows.filter((r) => r.ok).reduce((s, r) => s + r.affiliate_commission_total, 0)
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono bg-sky-950/30">
                                        {fmt(
                                            agg.statementRows.filter((r) => r.ok).reduce((s, r) => s + r.est_commission_total, 0)
                                        )}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <p className="text-gray-600 text-[11px] mt-2">
                    Est. commission (Seller Center) sums only these API fields:{' '}
                    <span className="font-mono text-gray-500">{TIKTOK_EST_COMMISSION_FEE_FIELD_KEYS.join(', ')}</span>.
                </p>
            </section>

            <section>
                <h4 className="text-white font-semibold mb-1 text-base">Transaction line totals (sum of every line item)</h4>
                <p className="text-gray-500 text-xs mb-3">
                    Sums all numeric amount fields across <span className="text-gray-300">{agg.transactionObjectsCounted}</span> transaction
                    objects in the payload (grouped for comparison to P&amp;L / DB).
                </p>
                <div className="space-y-6">
                    {sectionKeys.map((section) => {
                        const rows = agg.groupedTransactionSums[section] || [];
                        if (rows.length === 0) return null;
                        const sectionSum = rows.reduce((s, x) => s + x.sum, 0);
                        return (
                            <div key={section} className="border border-gray-800 rounded-lg overflow-hidden">
                                <div className="bg-gray-800/80 px-3 py-2 flex justify-between items-center gap-2">
                                    <span className="text-pink-300 font-medium">{section}</span>
                                    <span className="text-gray-400 text-xs">
                                        Section sum: <span className="text-white font-mono">{fmt(sectionSum)}</span>
                                    </span>
                                </div>
                                <table className="w-full text-gray-300">
                                    <thead className="bg-gray-900 text-xs text-gray-500 uppercase">
                                        <tr>
                                            <th className="text-left px-3 py-2">Field path</th>
                                            <th className="text-right px-3 py-2 w-32">Sum</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800">
                                        {rows.map(({ path, sum }) => (
                                            <tr key={path} className="hover:bg-gray-800/40">
                                                <td className="px-3 py-1.5 font-mono text-xs break-all">{path}</td>
                                                <td className="px-3 py-1.5 text-right font-mono">{fmt(sum)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}
