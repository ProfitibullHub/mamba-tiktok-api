import { useState } from 'react';
import { Account } from '../../lib/supabase';
import { toLocalDateString } from '../../utils/dateUtils';

interface DataAuditViewProps {
    account: Account;
    shopId?: string;
    timezone?: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

interface ApiResult {
    api_name: string;
    endpoint: string;
    method: string;
    description: string;
    how_we_use_it: string;
    request_params: Record<string, any>;
    raw_response: any;
    record_count: number;
    status: 'success' | 'error';
    error_message?: string;
    called_at: string;
    response_time_ms: number;
}

interface AuditData {
    success: boolean;
    audit: {
        title: string;
        description: string;
        disclaimer: string;
        audit_started_at: string;
        audit_completed_at: string;
        shop_name: string;
        shop_id: string;
        account_id: string;
        total_apis_called: number;
        successful: number;
        failed: number;
        tiktok_api_base: string;
        authentication_method: string;
        note: string;
        date_filter?: { startDate: string; endDate: string } | null;
        timezone_used?: string;
    };
    api_results: ApiResult[];
    finance_reconciliation?: {
        statement_totals: {
            revenue_amount_sum: number;
            settlement_amount_sum: number;
            fee_amount_sum: number;
            shipping_cost_amount_sum: number;
            statement_count: number;
        };
        transaction_totals: {
            revenue_amount_sum: number;
            settlement_amount_sum: number;
            shipping_cost_amount_sum: number;
            fee_tax_amount_sum: number;
            platform_fee_sum: number;
            affiliate_fee_sum: number;
            transaction_count: number;
        };
        deltas: {
            shipping_delta: number;
            fee_tax_minus_statement_fee_delta: number;
            settlement_delta: number;
            revenue_delta: number;
        };
        buckets: {
            affiliate_fee_sum: number;
            platform_fee_sum: number;
        };
    };
    smart_sync_explanation?: {
        title: string;
        overview: string;
        steps: { name: string; description: string }[];
        key_point: string;
    };
    token_refresh_explanation?: {
        title: string;
        overview: string;
        steps: { name: string; description: string }[];
        key_point: string;
    };
}

// Module-level cache so audit results persist across navigation
let cachedData: AuditData | null = null;
let cachedStartDate: string = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return toLocalDateString(d); })();
let cachedEndDate: string = toLocalDateString(new Date());
let cachedMaxPages: number = 20;
let cachedExpandedApis: Set<number> = new Set();
let cachedExpandedResponses: Set<number> = new Set();

export function DataAuditView({ account, shopId, timezone }: DataAuditViewProps) {
    const [data, setData] = useState<AuditData | null>(cachedData);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedApis, setExpandedApis] = useState<Set<number>>(cachedExpandedApis);
    const [expandedResponses, setExpandedResponses] = useState<Set<number>>(cachedExpandedResponses);
    const [expandedCancelledOrders, setExpandedCancelledOrders] = useState(false);
    const [visibleRawDataOrders, setVisibleRawDataOrders] = useState<Set<string>>(new Set());

    // Date range state
    const [startDate, setStartDate] = useState(cachedStartDate);
    const [endDate, setEndDate] = useState(cachedEndDate);
    const [maxPages, setMaxPages] = useState(cachedMaxPages);
    const [testOrderId, setTestOrderId] = useState('');

    // Sync helpers to keep module cache in sync with state
    const updateStartDate = (v: string) => { cachedStartDate = v; setStartDate(v); };
    const updateEndDate = (v: string) => { cachedEndDate = v; setEndDate(v); };
    const updateMaxPages = (v: number) => { cachedMaxPages = v; setMaxPages(v); };
    const updateExpandedApis = (updater: (prev: Set<number>) => Set<number>) => {
        setExpandedApis(prev => { const next = updater(prev); cachedExpandedApis = next; return next; });
    };
    const updateExpandedResponses = (updater: (prev: Set<number>) => Set<number>) => {
        setExpandedResponses(prev => { const next = updater(prev); cachedExpandedResponses = next; return next; });
    };

    const runAudit = async () => {
        setLoading(true);
        setError(null);
        setData(null);
        cachedData = null;
        setExpandedApis(new Set());
        setExpandedResponses(new Set());
        cachedExpandedApis = new Set();
        cachedExpandedResponses = new Set();

        try {
            const params = new URLSearchParams({ maxPages: String(maxPages) });
            if (shopId) params.set('shopId', shopId);
            if (startDate) params.set('startDate', startDate);
            if (endDate) params.set('endDate', endDate);
            if (timezone) params.set('timezone', timezone);
            if (testOrderId.trim()) params.set('testOrderId', testOrderId.trim());

            const url = `${API_BASE_URL}/api/tiktok-shop/debug/raw-data/${account.id}?${params.toString()}`;
            const response = await fetch(url);
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Audit failed');
            }

            cachedData = result;
            setData(result);
        } catch (err: any) {
            setError(err.message || 'Failed to run audit');
        } finally {
            setLoading(false);
        }
    };

    const toggleApi = (index: number) => {
        updateExpandedApis(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    };

    const toggleResponse = (index: number) => {
        updateExpandedResponses(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    };

    // Extract counts from api_results
    const getCounts = () => {
        if (!data) return null;
        const counts: { label: string; count: number; status: string }[] = [];
        for (const api of data.api_results) {
            counts.push({
                label: api.api_name,
                count: api.record_count,
                status: api.status,
            });
        }
        return counts;
    };

    const counts = data ? getCounts() : null;

    return (
        <div style={{ fontFamily: 'monospace', color: '#fff', maxWidth: 960 }}>
            <h1 style={{ borderBottom: '1px solid #555', paddingBottom: 8, marginBottom: 16 }}>
                DATA AUTHENTICITY AUDIT
            </h1>

            <div style={{ marginBottom: 24, lineHeight: 1.8 }}>
                <p><strong>Purpose:</strong> This page proves that the data shown on the Mamba dashboard is authentic. It calls TikTok's official APIs directly and shows the raw, unmodified JSON responses.</p>
                <p style={{ marginTop: 8 }}><strong>How it works:</strong></p>
                <p>1. We call each TikTok API endpoint directly from our server — NO data comes from our database.</p>
                <p>2. The ONLY database interaction is retrieving the OAuth access token (required by TikTok to authenticate).</p>
                <p>3. Every response below is exactly what TikTok's servers returned — nothing is modified, filtered, or fabricated.</p>
                <p>4. For each API, we explain: what it does, what we sent, what TikTok returned, and how we use that data on the dashboard.</p>
                <p>5. Results are limited to the first <strong>20 pages</strong> per API by default to avoid TikTok's rate limits. You can adjust max pages above. The full dashboard syncs all pages.</p>
            </div>

            {/* Date Range Selection */}
            <div style={{
                border: '1px solid #555',
                padding: 16,
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
            }}>
                <strong style={{ fontSize: 13 }}>DATE RANGE (Orders Filter):</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ color: '#aaa', fontSize: 12 }}>From:</label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => updateStartDate(e.target.value)}
                        style={{
                            background: '#111',
                            color: '#fff',
                            border: '1px solid #555',
                            padding: '6px 10px',
                            fontFamily: 'monospace',
                            fontSize: 13,
                        }}
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ color: '#aaa', fontSize: 12 }}>To:</label>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => updateEndDate(e.target.value)}
                        style={{
                            background: '#111',
                            color: '#fff',
                            border: '1px solid #555',
                            padding: '6px 10px',
                            fontFamily: 'monospace',
                            fontSize: 13,
                        }}
                    />
                </div>
                {/* Quick presets */}
                <div style={{ display: 'flex', gap: 6 }}>
                    {[
                        { label: '7d', days: 7 },
                        { label: '14d', days: 14 },
                        { label: '30d', days: 30 },
                    ].map(preset => (
                        <button
                            key={preset.label}
                            onClick={() => {
                                const end = new Date();
                                const start = new Date();
                                start.setDate(start.getDate() - preset.days);
                                updateStartDate(toLocalDateString(start));
                                updateEndDate(toLocalDateString(end));
                            }}
                            style={{
                                background: '#222',
                                color: '#ccc',
                                border: '1px solid #555',
                                padding: '4px 10px',
                                cursor: 'pointer',
                                fontFamily: 'monospace',
                                fontSize: 11,
                            }}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ color: '#aaa', fontSize: 12 }}>Max Pages:</label>
                    <input
                        type="number"
                        min={1}
                        value={maxPages}
                        onChange={(e) => updateMaxPages(Math.max(1, Number(e.target.value) || 20))}
                        style={{
                            background: '#111',
                            color: '#fff',
                            border: '1px solid #555',
                            padding: '6px 10px',
                            fontFamily: 'monospace',
                            fontSize: 13,
                            width: 70,
                        }}
                    />
                </div>
            </div>

            {/* Test Order ID Input */}
            <div style={{
                border: '1px solid #555',
                padding: 16,
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
            }}>
                <strong style={{ fontSize: 13 }}>TEST PRICE DETAIL API:</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <label style={{ color: '#aaa', fontSize: 12 }}>Order ID:</label>
                    <input
                        type="text"
                        value={testOrderId}
                        onChange={(e) => setTestOrderId(e.target.value)}
                        placeholder="Enter order_id (optional)"
                        style={{
                            background: '#111',
                            color: '#fff',
                            border: '1px solid #555',
                            padding: '6px 10px',
                            fontFamily: 'monospace',
                            fontSize: 13,
                            minWidth: 250,
                        }}
                    />
                    <span style={{ color: '#888', fontSize: 11 }}>
                        (Optional: Test the price_detail API with a specific order)
                    </span>
                </div>
            </div>

            <button
                onClick={runAudit}
                disabled={loading}
                style={{
                    padding: '10px 24px',
                    background: loading ? '#333' : '#fff',
                    color: loading ? '#888' : '#000',
                    border: '1px solid #888',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'monospace',
                    fontSize: 14,
                    fontWeight: 'bold',
                    marginBottom: 16,
                }}
            >
                {loading ? '[ LOADING... Calling TikTok APIs directly... ]' : '[ RUN DATA AUTHENTICITY AUDIT ]'}
            </button>

            {loading && (
                <p style={{ color: '#aaa' }}>
                    Please wait. We are calling 8 TikTok APIs and paginating through results. This can take 30-60 seconds...
                </p>
            )}

            {error && (
                <div style={{ border: '1px solid #888', padding: 12, marginBottom: 16 }}>
                    <p><strong>AUDIT FAILED:</strong> {error}</p>
                </div>
            )}

            {data && (
                <div>
                    {/* Summary */}
                    <div style={{ border: '1px solid #555', padding: 16, marginBottom: 24 }}>
                        <h2 style={{ marginTop: 0, marginBottom: 12, borderBottom: '1px solid #444', paddingBottom: 8 }}>AUDIT SUMMARY</h2>
                        <p>Shop: <strong>{data.audit.shop_name}</strong> (ID: {data.audit.shop_id})</p>
                        <p>TikTok API Server: <strong>{data.audit.tiktok_api_base}</strong></p>
                        <p>Authentication: {data.audit.authentication_method}</p>
                        <p>Timezone used for audit range: <strong>{data.audit.timezone_used || timezone || 'America/Los_Angeles'}</strong></p>
                        {data.audit.date_filter && (
                            <p>Date Filter: <strong>{data.audit.date_filter.startDate} to {data.audit.date_filter.endDate}</strong></p>
                        )}
                        <p>APIs Called: {data.audit.total_apis_called} | Successful: {data.audit.successful} | Failed: {data.audit.failed}</p>
                        <p>Audit started: {new Date(data.audit.audit_started_at).toLocaleString()}</p>
                        <p>Audit completed: {new Date(data.audit.audit_completed_at).toLocaleString()}</p>
                        <p style={{ marginTop: 8, color: '#aaa' }}><em>{data.audit.note}</em></p>
                    </div>

                    {/* Finance Reconciliation */}
                    {data.finance_reconciliation && (
                        <div style={{ border: '1px solid #22c55e', padding: 16, marginBottom: 24 }}>
                            <h2 style={{ marginTop: 0, marginBottom: 12, borderBottom: '1px solid #14532d', paddingBottom: 8 }}>
                                FINANCE RECONCILIATION REPORT
                            </h2>
                            <p style={{ color: '#a7f3d0', fontSize: 12, marginBottom: 12 }}>
                                One-click discrepancy summary: statement totals vs statement transaction sums.
                            </p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                <div style={{ border: '1px solid #334155', padding: 12 }}>
                                    <p><strong>Statement Totals</strong></p>
                                    <p>Statements: {data.finance_reconciliation.statement_totals.statement_count}</p>
                                    <p>Revenue: ${data.finance_reconciliation.statement_totals.revenue_amount_sum.toFixed(2)}</p>
                                    <p>Settlement: ${data.finance_reconciliation.statement_totals.settlement_amount_sum.toFixed(2)}</p>
                                    <p>Fees: ${data.finance_reconciliation.statement_totals.fee_amount_sum.toFixed(2)}</p>
                                    <p>Shipping: ${data.finance_reconciliation.statement_totals.shipping_cost_amount_sum.toFixed(2)}</p>
                                </div>
                                <div style={{ border: '1px solid #334155', padding: 12 }}>
                                    <p><strong>Transaction Sums</strong></p>
                                    <p>Transactions: {data.finance_reconciliation.transaction_totals.transaction_count}</p>
                                    <p>Revenue: ${data.finance_reconciliation.transaction_totals.revenue_amount_sum.toFixed(2)}</p>
                                    <p>Settlement: ${data.finance_reconciliation.transaction_totals.settlement_amount_sum.toFixed(2)}</p>
                                    <p>Fee+Tax: ${data.finance_reconciliation.transaction_totals.fee_tax_amount_sum.toFixed(2)}</p>
                                    <p>Shipping: ${data.finance_reconciliation.transaction_totals.shipping_cost_amount_sum.toFixed(2)}</p>
                                </div>
                            </div>
                            <div style={{ border: '1px solid #334155', padding: 12, marginTop: 12 }}>
                                <p><strong>Key Buckets (from transaction rows)</strong></p>
                                <p>Affiliate Fees: ${data.finance_reconciliation.buckets.affiliate_fee_sum.toFixed(2)}</p>
                                <p>Platform Fees: ${data.finance_reconciliation.buckets.platform_fee_sum.toFixed(2)}</p>
                            </div>
                            <div style={{ border: '1px solid #334155', padding: 12, marginTop: 12 }}>
                                <p><strong>Deltas (Tx - Statement)</strong></p>
                                <p>Shipping Delta: ${data.finance_reconciliation.deltas.shipping_delta.toFixed(2)}</p>
                                <p>Fee/Tax vs Statement Fee Delta: ${data.finance_reconciliation.deltas.fee_tax_minus_statement_fee_delta.toFixed(2)}</p>
                                <p>Settlement Delta: ${data.finance_reconciliation.deltas.settlement_delta.toFixed(2)}</p>
                                <p>Revenue Delta: ${data.finance_reconciliation.deltas.revenue_delta.toFixed(2)}</p>
                            </div>
                        </div>
                    )}

                    {/* Cancelled Orders Audit Section */}
                    {/* Cancelled Orders Audit Section */}
                    {(() => {
                        // FIX: Matches backend name 'Search Orders' and handles paginated array response
                        const orderApi = data.api_results.find(a => a.api_name === 'Search Orders');

                        let allOrders: any[] = [];
                        if (orderApi && Array.isArray(orderApi.raw_response)) {
                            // Extract orders from all pages
                            orderApi.raw_response.forEach((page: any) => {
                                if (page.response?.orders) {
                                    allOrders.push(...page.response.orders);
                                } else if (page.response?.data?.orders) {
                                    allOrders.push(...page.response.data.orders);
                                }
                            });
                        } else if (orderApi?.raw_response?.orders) {
                            allOrders = orderApi.raw_response.orders;
                        } else if (orderApi?.raw_response?.data?.orders) {
                            allOrders = orderApi.raw_response.data.orders;
                        }

                        if (allOrders.length === 0) return null;

                        const cancelledOrders = allOrders.filter((o: any) =>
                            o.order_status === 'CANCELLED' ||
                            o.cancel_reason ||
                            o.cancellation_initiator
                        );

                        if (cancelledOrders.length === 0) return null;

                        return (
                            <div style={{ border: '1px solid #ef4444', marginBottom: 24, background: 'rgba(239, 68, 68, 0.05)' }}>
                                <div
                                    onClick={() => setExpandedCancelledOrders(!expandedCancelledOrders)}
                                    style={{
                                        padding: '12px 16px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        borderBottom: expandedCancelledOrders ? '1px solid #ef4444' : 'none'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <h2 style={{ margin: 0, fontSize: 16, color: '#fca5a5' }}>
                                            CANCELLED ORDERS AUDIT
                                        </h2>
                                        <span style={{
                                            background: '#ef4444',
                                            color: 'white',
                                            padding: '2px 8px',
                                            borderRadius: 12,
                                            fontSize: 12,
                                            fontWeight: 'bold'
                                        }}>
                                            {cancelledOrders.length} Potential Issues
                                        </span>
                                    </div>
                                    <div style={{ color: '#fca5a5', fontSize: 13 }}>
                                        {expandedCancelledOrders ? '[-]' : '[+]'}
                                    </div>
                                </div>

                                {expandedCancelledOrders && (
                                    <div style={{ padding: 16 }}>
                                        <p style={{ fontSize: 13, color: '#ccc', marginBottom: 16, marginTop: 0 }}>
                                            These orders were found in the raw TikTok API response with a cancellation status or reason.
                                        </p>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                <thead>
                                                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #555', color: '#888' }}>
                                                        <th style={{ padding: 8 }}>Order ID</th>
                                                        <th style={{ padding: 8 }}>Status</th>
                                                        <th style={{ padding: 8 }}>Cancel Reason</th>
                                                        <th style={{ padding: 8 }}>Created Time</th>
                                                        <th style={{ padding: 8 }}>Paid Time</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {cancelledOrders.map((o: any) => (
                                                        <>
                                                            <tr key={o.id} style={{ borderBottom: visibleRawDataOrders.has(o.id) ? 'none' : '1px solid #333' }}>
                                                                <td style={{ padding: 8, fontFamily: 'monospace' }}>
                                                                    {o.id}
                                                                    <div
                                                                        onClick={() => {
                                                                            const next = new Set(visibleRawDataOrders);
                                                                            if (next.has(o.id)) next.delete(o.id);
                                                                            else next.add(o.id);
                                                                            setVisibleRawDataOrders(next);
                                                                        }}
                                                                        style={{
                                                                            fontSize: 10,
                                                                            color: '#60a5fa',
                                                                            cursor: 'pointer',
                                                                            marginTop: 4,
                                                                            textDecoration: 'underline'
                                                                        }}
                                                                    >
                                                                        {visibleRawDataOrders.has(o.id) ? 'Hide Raw Data' : 'View Raw Data'}
                                                                    </div>
                                                                </td>
                                                                <td style={{ padding: 8 }}>
                                                                    <span style={{
                                                                        padding: '2px 6px',
                                                                        borderRadius: 4,
                                                                        background: o.order_status === 'CANCELLED' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(100, 100, 100, 0.2)',
                                                                        color: o.order_status === 'CANCELLED' ? '#fca5a5' : '#ccc'
                                                                    }}>
                                                                        {o.order_status}
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: 8, color: '#fca5a5' }}>{o.cancel_reason || '-'}</td>
                                                                <td style={{ padding: 8 }}>{new Date(o.create_time * 1000).toLocaleString()}</td>
                                                                <td style={{ padding: 8 }}>{o.paid_time ? new Date(o.paid_time * 1000).toLocaleString() : '-'}</td>
                                                            </tr>
                                                            {visibleRawDataOrders.has(o.id) && (
                                                                <tr key={`${o.id}-raw`} style={{ borderBottom: '1px solid #333' }}>
                                                                    <td colSpan={5} style={{ padding: 0 }}>
                                                                        <pre style={{
                                                                            margin: 0,
                                                                            padding: 12,
                                                                            background: '#0f0f0f',
                                                                            color: '#aaa',
                                                                            fontSize: 11,
                                                                            overflowX: 'auto',
                                                                            borderTop: '1px dashed #333'
                                                                        }}>
                                                                            {JSON.stringify(o, null, 2)}
                                                                        </pre>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Record Counts */}
                    {counts && (
                        <div style={{ border: '1px solid #555', padding: 16, marginBottom: 24 }}>
                            <h2 style={{ marginTop: 0, marginBottom: 12, borderBottom: '1px solid #444', paddingBottom: 8 }}>
                                RECORD COUNTS {data.audit.date_filter ? `(${data.audit.date_filter.startDate} — ${data.audit.date_filter.endDate})` : '(All Time)'}
                            </h2>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                                {counts.map((c, i) => (
                                    <div key={i} style={{
                                        border: '1px solid #444',
                                        padding: 12,
                                        textAlign: 'center',
                                    }}>
                                        <div style={{ fontSize: 28, fontWeight: 'bold', color: c.status === 'success' ? '#4ade80' : '#f87171' }}>
                                            {c.count.toLocaleString()}
                                        </div>
                                        <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                                            {c.label}
                                        </div>
                                        <div style={{ fontSize: 10, color: c.status === 'success' ? '#4ade80' : '#f87171', marginTop: 2 }}>
                                            {c.status === 'success' ? 'OK' : 'FAILED'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p style={{ marginTop: 12, fontSize: 11, color: '#888' }}>
                                These are the EXACT counts TikTok's API returned. Orders are filtered by the selected date range. Products, statements, payments, and withdrawals show the most recent pages (up to {maxPages} pages per API).
                            </p>
                        </div>
                    )}

                    {/* Each API */}
                    {data.api_results.map((api, index) => (
                        <div key={index} style={{ border: '1px solid #555', marginBottom: 16 }}>
                            {/* Header row */}
                            <div
                                onClick={() => toggleApi(index)}
                                style={{
                                    padding: '12px 16px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    borderBottom: expandedApis.has(index) ? '1px solid #555' : 'none',
                                }}
                            >
                                <div>
                                    <span>{api.status === 'success' ? '[OK]' : '[FAIL]'} </span>
                                    <strong>{api.api_name}</strong>
                                    <span style={{ color: '#aaa' }}> — {api.endpoint}</span>
                                </div>
                                <div style={{ color: '#aaa', fontSize: 12 }}>
                                    {api.record_count} records | {api.response_time_ms}ms | {expandedApis.has(index) ? '[-]' : '[+]'}
                                </div>
                            </div>

                            {/* Expanded details */}
                            {expandedApis.has(index) && (
                                <div style={{ padding: 16 }}>
                                    <p style={{ marginBottom: 12 }}>
                                        <strong>WHAT THIS API DOES:</strong><br />
                                        {api.description}
                                    </p>

                                    <p style={{ marginBottom: 12, borderLeft: '3px solid #fff', paddingLeft: 12 }}>
                                        <strong>HOW WE USE THIS DATA ON THE DASHBOARD:</strong><br />
                                        {api.how_we_use_it}
                                    </p>

                                    <p style={{ marginBottom: 4 }}><strong>REQUEST PARAMETERS SENT TO TIKTOK:</strong></p>
                                    <pre style={{
                                        background: '#111',
                                        padding: 12,
                                        overflow: 'auto',
                                        maxHeight: 150,
                                        fontSize: 12,
                                        border: '1px solid #333',
                                        marginBottom: 12,
                                    }}>
                                        {JSON.stringify(api.request_params, null, 2)}
                                    </pre>

                                    {api.error_message && (
                                        <p style={{ marginBottom: 12 }}>
                                            <strong>ERROR FROM TIKTOK:</strong> {api.error_message}
                                        </p>
                                    )}

                                    {api.raw_response && (
                                        <div style={{ marginBottom: 12 }}>
                                            <p
                                                onClick={() => toggleResponse(index)}
                                                style={{ cursor: 'pointer', marginBottom: 4 }}
                                            >
                                                <strong>RAW JSON RESPONSE FROM TIKTOK</strong> — click to {expandedResponses.has(index) ? 'collapse' : 'expand'} {expandedResponses.has(index) ? '[-]' : '[+]'}
                                            </p>
                                            {expandedResponses.has(index) && (
                                                <pre style={{
                                                    background: '#111',
                                                    padding: 12,
                                                    overflow: 'auto',
                                                    maxHeight: 500,
                                                    fontSize: 11,
                                                    border: '1px solid #333',
                                                    whiteSpace: 'pre-wrap',
                                                    wordBreak: 'break-all',
                                                }}>
                                                    {JSON.stringify(api.raw_response, null, 2)}
                                                </pre>
                                            )}
                                        </div>
                                    )}

                                    <p style={{ color: '#888', fontSize: 11 }}>
                                        Called at: {new Date(api.called_at).toLocaleString()} | Response time: {api.response_time_ms}ms | Records returned: {api.record_count} | Method: {api.method}
                                    </p>
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Smart Sync Explanation */}
                    {data.smart_sync_explanation && (
                        <div style={{ border: '1px solid #555', padding: 16, marginTop: 24, lineHeight: 1.9 }}>
                            <h2 style={{ marginTop: 0, marginBottom: 12, borderBottom: '1px solid #444', paddingBottom: 8 }}>
                                {data.smart_sync_explanation.title}
                            </h2>
                            <p style={{ marginBottom: 16 }}>{data.smart_sync_explanation.overview}</p>

                            {data.smart_sync_explanation.steps.map((step, i) => (
                                <div key={i} style={{ marginBottom: 16 }}>
                                    <p><strong>Step {i + 1}: {step.name}</strong></p>
                                    <p style={{ color: '#ccc', paddingLeft: 16, borderLeft: '2px solid #555' }}>{step.description}</p>
                                </div>
                            ))}

                            <p style={{ marginTop: 16, borderTop: '1px solid #444', paddingTop: 12 }}>
                                <strong>KEY POINT:</strong> {data.smart_sync_explanation.key_point}
                            </p>
                        </div>
                    )}

                    {/* Token Refresh Explanation */}
                    {data.token_refresh_explanation && (
                        <div style={{ border: '1px solid #555', padding: 16, marginTop: 24, lineHeight: 1.9 }}>
                            <h2 style={{ marginTop: 0, marginBottom: 12, borderBottom: '1px solid #444', paddingBottom: 8 }}>
                                {data.token_refresh_explanation.title}
                            </h2>
                            <p style={{ marginBottom: 16 }}>{data.token_refresh_explanation.overview}</p>

                            {data.token_refresh_explanation.steps.map((step, i) => (
                                <div key={i} style={{ marginBottom: 16 }}>
                                    <p><strong>{step.name}</strong></p>
                                    <p style={{ color: '#ccc', paddingLeft: 16, borderLeft: '2px solid #555' }}>{step.description}</p>
                                </div>
                            ))}

                            <p style={{ marginTop: 16, borderTop: '1px solid #444', paddingTop: 12 }}>
                                <strong>KEY POINT:</strong> {data.token_refresh_explanation.key_point}
                            </p>
                        </div>
                    )}

                    {/* Footer */}
                    <div style={{ border: '1px solid #555', padding: 16, marginTop: 24, color: '#aaa', lineHeight: 1.8 }}>
                        <p><strong style={{ color: '#fff' }}>DISCLAIMER</strong></p>
                        <p>{data.audit.disclaimer}</p>
                        <p>All data shown above was fetched in real-time from TikTok's official API servers at {data.audit.tiktok_api_base}. No cached or database data is included in these results. The exact same API calls and data processing are used to populate every view on this dashboard.</p>
                    </div>
                </div>
            )}

            {!data && !loading && !error && (
                <div style={{ border: '1px solid #555', padding: 24, textAlign: 'center', color: '#aaa', marginTop: 24 }}>
                    <p>Select a date range above, then click the button to run the audit.</p>
                    <p>This will call all TikTok APIs directly and display the raw JSON responses so you can verify every piece of data on this dashboard comes from TikTok.</p>
                </div>
            )}
        </div>
    );
}
