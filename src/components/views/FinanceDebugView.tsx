import { useState } from 'react';
import { Account } from '../../lib/supabase';
import { Search, FileText, CreditCard, ArrowDownCircle, AlertCircle, Database, RefreshCw } from 'lucide-react';
import { DateRangePicker, DateRange } from '../DateRangePicker';
import { getShopDayStartTimestamp, toLocalDateString } from '../../utils/dateUtils';

interface FinanceDebugViewProps {
    account: Account;
    shopId?: string;
    timezone?: string;
}

type TabType = 'statements' | 'payments' | 'withdrawals' | 'unsettled' | 'order_tx' | 'statement_tx';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export function FinanceDebugView({ account, shopId, timezone = 'America/Los_Angeles' }: FinanceDebugViewProps) {
    const [viewMode, setViewMode] = useState<'json' | 'table'>('table');
    const [activeTab, setActiveTab] = useState<TabType>('statements');
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Configuration State
    const [dateRange, setDateRange] = useState<DateRange>({
        startDate: toLocalDateString(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        endDate: toLocalDateString(new Date())
    });
    const [pageSize, setPageSize] = useState(20);
    const tabs = [
        { id: 'statements', label: 'Statements', icon: FileText },
        { id: 'payments', label: 'Payments', icon: CreditCard },
        { id: 'withdrawals', label: 'Withdrawals', icon: ArrowDownCircle },
        { id: 'unsettled', label: 'Unsettled Orders', icon: AlertCircle },
        { id: 'order_tx', label: 'Order Transactions', icon: Search },
        { id: 'statement_tx', label: 'Statement Transactions', icon: Database },
    ];

    const getRangeUnix = () => {
        const start = getShopDayStartTimestamp(dateRange.startDate, timezone);
        const end = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;
        return { start, end };
    };

    const parseAmount = (value: any): number => {
        const n = parseFloat(String(value ?? '0'));
        return Number.isFinite(n) ? n : 0;
    };

    const buildReconciliation = (statements: any[], transactions: any[]) => {
        const statementTotals = {
            revenue_amount_sum: statements.reduce((sum, s) => sum + parseAmount(s.revenue_amount), 0),
            settlement_amount_sum: statements.reduce((sum, s) => sum + parseAmount(s.settlement_amount), 0),
            fee_amount_sum: statements.reduce((sum, s) => sum + parseAmount(s.fee_amount), 0),
            shipping_cost_amount_sum: statements.reduce((sum, s) => sum + parseAmount(s.shipping_cost_amount), 0),
            statement_count: statements.length,
        };

        let platformFeeSum = 0;
        let affiliateFeeSum = 0;
        const transactionTotals = transactions.reduce((acc, tx) => {
            acc.revenue_amount_sum += parseAmount(tx.revenue_amount);
            acc.settlement_amount_sum += parseAmount(tx.settlement_amount);
            acc.shipping_cost_amount_sum += parseAmount(tx.shipping_cost_amount);
            acc.fee_tax_amount_sum += parseAmount(tx.fee_tax_amount);
            return acc;
        }, {
            revenue_amount_sum: 0,
            settlement_amount_sum: 0,
            shipping_cost_amount_sum: 0,
            fee_tax_amount_sum: 0,
            transaction_count: transactions.length,
        });

        for (const tx of transactions) {
            const fee = tx?.fee_tax_breakdown?.fee || {};
            platformFeeSum +=
                parseAmount(fee.platform_commission_amount) +
                parseAmount(fee.referral_fee_amount) +
                parseAmount(fee.transaction_fee_amount) +
                parseAmount(fee.refund_administration_fee_amount) +
                parseAmount(fee.credit_card_handling_fee_amount);
            affiliateFeeSum +=
                parseAmount(fee.affiliate_commission_amount) +
                parseAmount(fee.affiliate_partner_commission_amount) +
                parseAmount(fee.affiliate_ads_commission_amount) +
                parseAmount(fee.external_affiliate_marketing_fee_amount) +
                parseAmount(fee.cofunded_creator_bonus_amount);
        }

        return {
            statement_totals: statementTotals,
            transaction_totals: { ...transactionTotals, platform_fee_sum: platformFeeSum, affiliate_fee_sum: affiliateFeeSum },
            deltas: {
                shipping_delta: transactionTotals.shipping_cost_amount_sum - statementTotals.shipping_cost_amount_sum,
                fee_tax_minus_statement_fee_delta: transactionTotals.fee_tax_amount_sum - statementTotals.fee_amount_sum,
                settlement_delta: transactionTotals.settlement_amount_sum - statementTotals.settlement_amount_sum,
                revenue_delta: transactionTotals.revenue_amount_sum - statementTotals.revenue_amount_sum,
            },
            buckets: {
                affiliate_fee_sum: affiliateFeeSum,
                platform_fee_sum: platformFeeSum,
            }
        };
    };

    const fetchData = async () => {
        if (!shopId) {
            setError('No shop selected');
            return;
        }

        setLoading(true);
        setError(null);
        setData(null);

        try {
            let url = '';
            const params = new URLSearchParams({
                shopId,
                page_size: pageSize.toString()
            });

            // Add date range for relevant endpoints
            if (['statements', 'payments', 'withdrawals', 'unsettled'].includes(activeTab)) {
                // Convert to unix timestamp (seconds)
                // Note: Different endpoints might expect different time formats. 
                // Based on existing code, some use timestamps.
                // Let's check the service implementation or assume standard params.
                // The existing service methods take `params` object.
                // We'll pass them as query params to our backend proxy.

                // Common params for list endpoints
                // params.append('start_time', ...); // Depends on endpoint requirements
            }

            switch (activeTab) {
                case 'statements':
                    url = `${API_BASE_URL}/api/tiktok-shop/finance/statements/${account.id}`;
                    const { start, end } = getRangeUnix();
                    params.append('start_time', start.toString());
                    params.append('end_time', end.toString());
                    break;

                case 'payments':
                    url = `${API_BASE_URL}/api/tiktok-shop/finance/payments/${account.id}`;
                    const { start: pStart, end: pEnd } = getRangeUnix();
                    params.append('create_time_ge', pStart.toString());
                    params.append('create_time_le', pEnd.toString());
                    break;

                case 'withdrawals':
                    url = `${API_BASE_URL}/api/tiktok-shop/finance/withdrawals/${account.id}`;
                    const { start: wStart, end: wEnd } = getRangeUnix();
                    // Some shops/APIs may ignore these filters, but we pass range consistently.
                    params.append('start_time', wStart.toString());
                    params.append('end_time', wEnd.toString());
                    break;

                case 'unsettled':
                    url = `${API_BASE_URL}/api/tiktok-shop/finance/unsettled/${account.id}`;
                    const { start: uStart, end: uEnd } = getRangeUnix();
                    params.append('order_create_time_ge', uStart.toString());
                    params.append('order_create_time_le', uEnd.toString());
                    break;

                case 'order_tx':
                case 'statement_tx': {
                    const { start: sStart, end: sEnd } = getRangeUnix();
                    const statementsUrl = `${API_BASE_URL}/api/tiktok-shop/finance/statements/${account.id}?shopId=${encodeURIComponent(shopId)}&page_size=${pageSize}&start_time=${sStart}&end_time=${sEnd}`;
                    const statementsRes = await fetch(statementsUrl).then(r => r.json());
                    if (!statementsRes.success) throw new Error(statementsRes.error || 'Failed to load statements');
                    const statements = statementsRes.data?.statements || statementsRes.data?.statement_list || [];
                    if (!Array.isArray(statements) || statements.length === 0) {
                        setData({ mode: 'auto', statements: [], transactions: [], per_statement: [], reconciliation: null });
                        return;
                    }

                    const statementIds = statements
                        .map((s: any) => s.id || s.statement_id)
                        .filter(Boolean)
                        .slice(0, pageSize);

                    const perStatement: any[] = [];
                    const allTransactions: any[] = [];
                    for (const statementId of statementIds) {
                        const txUrl = `${API_BASE_URL}/api/tiktok-shop/finance/transactions/${account.id}/${statementId}?shopId=${encodeURIComponent(shopId)}&page_size=100`;
                        const txRes = await fetch(txUrl).then(r => r.json());
                        if (!txRes.success) continue;
                        const txRows = txRes.data?.transactions || txRes.data?.transaction_list || txRes.data?.statement_transactions || [];
                        perStatement.push({ statement_id: statementId, transaction_count: txRows.length, raw_response: txRes.data });
                        allTransactions.push(...txRows);
                    }

                    if (activeTab === 'statement_tx') {
                        setData({
                            mode: 'auto',
                            statements,
                            statement_ids: statementIds,
                            per_statement: perStatement,
                            transactions: allTransactions,
                            reconciliation: buildReconciliation(statements, allTransactions),
                            timezone_used: timezone
                        });
                        return;
                    }

                    // order_tx mode: auto-discover order IDs from statement transactions, then fetch each order transaction payload.
                    const orderIds = Array.from(new Set(allTransactions.map((tx: any) => tx.order_id).filter(Boolean))).slice(0, pageSize);
                    const perOrder: any[] = [];
                    const orderTransactions: any[] = [];
                    for (const orderId of orderIds) {
                        const orderUrl = `${API_BASE_URL}/api/tiktok-shop/finance/transactions/order/${account.id}/${orderId}?shopId=${encodeURIComponent(shopId)}&page_size=100`;
                        const orderRes = await fetch(orderUrl).then(r => r.json());
                        if (!orderRes.success) continue;
                        const txRows = orderRes.data?.transactions || orderRes.data?.transaction_list || [];
                        perOrder.push({ order_id: orderId, transaction_count: txRows.length, raw_response: orderRes.data });
                        orderTransactions.push(...txRows);
                    }

                    setData({
                        mode: 'auto',
                        source_statement_ids: statementIds,
                        order_ids: orderIds,
                        per_order: perOrder,
                        transactions: orderTransactions,
                        timezone_used: timezone
                    });
                    return;
                }
            }

            const response = await fetch(`${url}?${params.toString()}`);
            const result = await response.json();

            if (result.success) {
                setData(result.data);
            } else {
                throw new Error(result.error || 'Failed to fetch data');
            }
        } catch (err: any) {
            console.error('Error fetching debug data:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Helper to flatten object for table display (simple version)
    const flattenObject = (obj: any, prefix = ''): any => {
        return Object.keys(obj).reduce((acc: any, k) => {
            const pre = prefix.length ? prefix + '.' : '';
            if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
                Object.assign(acc, flattenObject(obj[k], pre + k));
            } else {
                acc[pre + k] = obj[k];
            }
            return acc;
        }, {});
    };

    const formatCellValue = (key: string, value: any) => {
        if (value === undefined || value === null) return '-';

        // Check if key implies a timestamp and value is a number (likely seconds for TikTok API)
        // TikTok API typically uses seconds for timestamps (10 digits)
        if (typeof value === 'number' && (key.endsWith('_time') || key.endsWith('Time') || key === 'time')) {
            // Check if it looks like a valid recent/future timestamp (e.g., > year 2000)
            // 946684800 is 2000-01-01
            if (value > 946684800) {
                try {
                    return new Date(value * 1000).toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true
                    });
                } catch (e) {
                    return String(value);
                }
            }
        }

        return String(value);
    };

    const renderTable = (data: any) => {
        if (!data) return null;

        // Handle array data
        let rows = [];
        if (Array.isArray(data)) {
            rows = data;
        } else if (data.list && Array.isArray(data.list)) {
            rows = data.list;
        } else if (data.payments && Array.isArray(data.payments)) {
            rows = data.payments;
        } else if (data.statement_list && Array.isArray(data.statement_list)) {
            rows = data.statement_list;
        } else if (data.statements && Array.isArray(data.statements)) {
            rows = data.statements;
        } else if (data.withdrawals && Array.isArray(data.withdrawals)) {
            rows = data.withdrawals;
        } else if (data.withdrawal_list && Array.isArray(data.withdrawal_list)) {
            rows = data.withdrawal_list;
        } else if (data.orders && Array.isArray(data.orders)) {
            rows = data.orders;
        } else if (data.order_list && Array.isArray(data.order_list)) {
            rows = data.order_list;
        } else if (data.transactions && Array.isArray(data.transactions)) {
            rows = data.transactions;
        } else if (data.transaction_list && Array.isArray(data.transaction_list)) {
            rows = data.transaction_list;
        } else if (data.statement_transactions && Array.isArray(data.statement_transactions)) {
            rows = data.statement_transactions;
        } else if (data.transactions && Array.isArray(data.transactions)) {
            rows = data.transactions;
        } else {
            // Single object or unknown structure, fallback to JSON
            return (
                <div className="p-4 text-center text-gray-400">
                    <p>Data structure not suitable for table view (not an array).</p>
                    <button
                        onClick={() => setViewMode('json')}
                        className="text-pink-500 hover:underline mt-2"
                    >
                        Switch to JSON view
                    </button>
                </div>
            );
        }

        if (rows.length === 0) {
            return <div className="p-4 text-center text-gray-500">No data available</div>;
        }

        // Get all unique keys from all rows for columns
        // Flatten objects to handle nested data gracefully
        const flattenedRows = rows.map((row: any) => flattenObject(row));
        const allKeys = Array.from(new Set(flattenedRows.flatMap((row: any) => Object.keys(row)))) as string[];

        // Filter out complex objects/arrays from columns if any remain (though flatten handles objects)
        // We might want to limit columns or prioritize them, but for debug view, showing all is fine.
        // Let's sort keys to have id/name first if possible
        const sortedKeys = allKeys.sort((a: string, b: string) => {
            const isIdA = a.toLowerCase().includes('id');
            const isIdB = b.toLowerCase().includes('id');
            if (isIdA && !isIdB) return -1;
            if (!isIdA && isIdB) return 1;
            return a.localeCompare(b);
        });

        return (
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-400">
                    <thead className="bg-gray-800 text-gray-200 uppercase font-medium">
                        <tr>
                            {sortedKeys.map((key: string) => (
                                <th key={key} className="px-4 py-3 whitespace-nowrap border-b border-gray-700">
                                    {key.replace(/_/g, ' ')}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {flattenedRows.map((row: any, idx: number) => (
                            <tr key={idx} className="hover:bg-gray-800/50 transition-colors">
                                {sortedKeys.map((key: string) => (
                                    <td key={key} className="px-4 py-3 whitespace-nowrap max-w-xs truncate" title={String(row[key])}>
                                        {formatCellValue(key, row[key])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-white mb-2">Finance API Debugger</h2>
                    <p className="text-gray-400">Explore raw financial data from TikTok Shop APIs</p>
                </div>
                <div className="flex gap-2">
                    <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
                        <button
                            onClick={() => setViewMode('table')}
                            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${viewMode === 'table'
                                ? 'bg-gray-700 text-white shadow-sm'
                                : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            Table
                        </button>
                        <button
                            onClick={() => setViewMode('json')}
                            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${viewMode === 'json'
                                ? 'bg-gray-700 text-white shadow-sm'
                                : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            JSON
                        </button>
                    </div>
                    <button
                        className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm border border-gray-700"
                        onClick={() => setData(null)}
                    >
                        Clear Data
                    </button>
                </div>
            </div>

            {/* Master Date Range (shared by all tabs) */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="min-w-[320px]">
                        <label className="block text-xs font-medium text-gray-400 mb-2 uppercase">Master Date Range</label>
                        <DateRangePicker value={dateRange} onChange={setDateRange} timezone={timezone} />
                    </div>
                    <div className="text-xs text-gray-400">
                        Applied to all tabs using timezone: <span className="text-gray-200">{timezone}</span>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex space-x-2 overflow-x-auto pb-2">
                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveTab(tab.id as TabType);
                                setData(null);
                                setError(null);
                            }}
                            className={`flex items-center space-x-2 px-4 py-3 rounded-lg transition-colors whitespace-nowrap ${isActive
                                ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700'
                                }`}
                        >
                            <Icon size={18} />
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* Configuration Panel */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
                <div className="flex items-center gap-2 mb-4">
                    <IconForTab tab={activeTab} />
                    <h3 className="text-lg font-semibold text-white uppercase tracking-wider text-sm">
                        {tabs.find(t => t.id === activeTab)?.label} Configuration
                    </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-end">
                    {['order_tx', 'statement_tx'].includes(activeTab) && (
                        <div className="col-span-2">
                            <label className="block text-xs font-medium text-gray-400 mb-2 uppercase">Auto Discovery</label>
                            <div className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-gray-300 text-sm">
                                IDs are auto-detected from statements/transactions filtered by selected date range + timezone.
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-medium text-gray-400 mb-2 uppercase">Page Size</label>
                        <select
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-pink-500"
                        >
                            <option value={10}>10 items</option>
                            <option value={20}>20 items</option>
                            <option value={50}>50 items</option>
                            <option value={100}>100 items</option>
                        </select>
                    </div>

                    <div>
                        <button
                            onClick={fetchData}
                            disabled={loading || !shopId}
                            className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                        >
                            {loading ? <RefreshCw className="animate-spin" size={20} /> : <Search size={20} />}
                            <span>{loading ? 'Fetching...' : 'Fetch Data'}</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Results Area */}
            <div className="min-h-[400px] bg-gray-900 rounded-xl border border-gray-800 p-6 overflow-hidden">
                {error && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                        <div>
                            <h4 className="font-semibold">Error Fetching Data</h4>
                            <p className="text-sm mt-1">{error}</p>
                        </div>
                    </div>
                )}

                {!data && !loading && !error && (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500 py-20">
                        <Search className="w-16 h-16 mb-4 opacity-20" />
                        <p className="text-lg font-medium">Ready to fetch data</p>
                        <p className="text-sm">Click the button above to call the TikTok Shop API</p>
                    </div>
                )}

                {data && (
                    <div className="space-y-4">
                        {data.reconciliation && (
                            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-emerald-200">
                                <h4 className="font-semibold mb-2">Finance Reconciliation Report</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p>Statement Count: {data.reconciliation.statement_totals.statement_count}</p>
                                        <p>Statement Shipping: ${data.reconciliation.statement_totals.shipping_cost_amount_sum.toFixed(2)}</p>
                                        <p>Statement Fees: ${data.reconciliation.statement_totals.fee_amount_sum.toFixed(2)}</p>
                                    </div>
                                    <div>
                                        <p>Tx Shipping: ${data.reconciliation.transaction_totals.shipping_cost_amount_sum.toFixed(2)}</p>
                                        <p>Tx Fee+Tax: ${data.reconciliation.transaction_totals.fee_tax_amount_sum.toFixed(2)}</p>
                                        <p>Affiliate Bucket: ${data.reconciliation.buckets.affiliate_fee_sum.toFixed(2)}</p>
                                    </div>
                                </div>
                                <div className="mt-3 text-xs text-emerald-100/80">
                                    <p>Shipping Delta: ${data.reconciliation.deltas.shipping_delta.toFixed(2)}</p>
                                    <p>Fee/Tax vs Statement Fee Delta: ${data.reconciliation.deltas.fee_tax_minus_statement_fee_delta.toFixed(2)}</p>
                                    <p>Settlement Delta: ${data.reconciliation.deltas.settlement_delta.toFixed(2)}</p>
                                    <p>Revenue Delta: ${data.reconciliation.deltas.revenue_delta.toFixed(2)}</p>
                                </div>
                            </div>
                        )}
                        <div className="flex items-center justify-between">
                            <h3 className="text-white font-medium">Response Data</h3>
                            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
                                {Array.isArray(data) ? `${data.length} items` : (data?.transactions?.length ? `${data.transactions.length} transactions` : 'Object')}
                            </span>
                        </div>

                        {viewMode === 'table' ? (
                            <div className="bg-black rounded-lg border border-gray-800 overflow-hidden">
                                {renderTable(data)}
                            </div>
                        ) : (
                            <div className="bg-black rounded-lg border border-gray-800 p-4 overflow-auto max-h-[600px]">
                                <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                                    {JSON.stringify(data, null, 2)}
                                </pre>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function IconForTab({ tab }: { tab: string }) {
    switch (tab) {
        case 'statements': return <FileText className="text-pink-500" size={20} />;
        case 'payments': return <CreditCard className="text-pink-500" size={20} />;
        case 'withdrawals': return <ArrowDownCircle className="text-pink-500" size={20} />;
        case 'unsettled': return <AlertCircle className="text-pink-500" size={20} />;
        case 'order_tx': return <Search className="text-pink-500" size={20} />;
        case 'statement_tx': return <Database className="text-pink-500" size={20} />;
        default: return <FileText className="text-pink-500" size={20} />;
    }
}
