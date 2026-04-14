import { useState, useEffect, useMemo, useCallback } from 'react';
import { Account } from '../../lib/supabase';
import { apiFetch } from '../../lib/apiClient';
import { Search, FileText, CreditCard, ArrowDownCircle, AlertCircle, Database, RefreshCw, FileCode, Sigma, Copy, Check } from 'lucide-react';
import { DateRangePicker, DateRange } from '../DateRangePicker';
import { getShopDayStartTimestamp, toLocalDateString } from '../../utils/dateUtils';
import {
    filterStatementsByStatementTimeWindow,
    parseStatementTimeSeconds,
} from '../../utils/tiktokStatementTimeFilter';
import { loadPersistedFinancialDateRange, persistFinancialDateRange } from '../../utils/financialDateRangeStorage';
import {
    stripHeavyTabForLocalStorage,
    saveStatementTxEnvelopeHeavy,
    loadStatementTxEnvelopeHeavy,
} from '../../utils/financeDebugSnapshotStorage';
import { mergeStatementTransactionEnvelopePages, type MergedEnvelopeMeta } from '../../utils/mergeStatementTransactionEnvelopePages';
import { FinanceEnvelopeTotalsPanel } from '../FinanceEnvelopeTotalsPanel';

interface FinanceDebugViewProps {
    account: Account;
    shopId?: string;
    timezone?: string;
}

type TabType = 'statements' | 'payments' | 'withdrawals' | 'unsettled' | 'order_tx' | 'statement_tx' | 'statement_tx_envelope';

/** TikTok list rows for Focus dropdown; `in_master_range` set when statement_time ∈ master window. */
type TiktokStatementOption = {
    statement_id: string;
    statement_time: string;
    in_master_range?: boolean;
};

const FINANCE_DEBUG_STORAGE_V = 2;

function financeDebugStorageKey(accountId: string, shopId: string) {
    return `mamba:finance_debug:v${FINANCE_DEBUG_STORAGE_V}:${accountId}:${shopId}`;
}

function loadFinanceDebugBlob(key: string): string | null {
    try {
        return localStorage.getItem(key) ?? sessionStorage.getItem(key);
    } catch {
        try {
            return sessionStorage.getItem(key);
        } catch {
            return null;
        }
    }
}

function saveFinanceDebugBlob(key: string, payload: object) {
    const s = JSON.stringify(payload);
    try {
        localStorage.setItem(key, s);
        return;
    } catch (e) {
        console.warn('[FinanceDebug] localStorage persist failed, trying session', e);
    }
    try {
        sessionStorage.setItem(key, s);
    } catch (e2) {
        console.warn('[FinanceDebug] sessionStorage persist failed', e2);
    }
}

export function FinanceDebugView({ account, shopId, timezone = 'America/Los_Angeles' }: FinanceDebugViewProps) {
    const [viewMode, setViewMode] = useState<'json' | 'table' | 'totals'>('table');
    const [activeTab, setActiveTab] = useState<TabType>('statements');
    /** Last fetched payload per debugger tab — survives sub-tab switches and navigation away. */
    const [dataByTab, setDataByTab] = useState<Partial<Record<TabType, any>>>({});
    const data = useMemo(() => dataByTab[activeTab] ?? null, [dataByTab, activeTab]);
    const [restored, setRestored] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

    // Configuration State — date range shared with P&L via localStorage (see financialDateRangeStorage)
    const [dateRange, setDateRange] = useState<DateRange>(() => {
        const p = loadPersistedFinancialDateRange(shopId);
        if (p) return p;
        return {
            startDate: toLocalDateString(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
            endDate: toLocalDateString(new Date()),
        };
    });

    const handleDateRangeChange = useCallback((r: DateRange) => {
        setDateRange(r);
        persistFinancialDateRange(shopId, r);
    }, [shopId]);

    useEffect(() => {
        const p = loadPersistedFinancialDateRange(shopId);
        if (p) setDateRange(p);
    }, [shopId]);
    const [pageSize, setPageSize] = useState(20);
    /** Statement IDs from TikTok GET /finance/202309/statements (no DB). */
    const [tiktokStatementOptions, setTiktokStatementOptions] = useState<TiktokStatementOption[]>([]);
    /** When set, only this statement gets a live envelope (optional). */
    const [envelopeFocusId, setEnvelopeFocusId] = useState('');
    const [statementEnvelopePageToken, setStatementEnvelopePageToken] = useState('');

    useEffect(() => {
        if (!shopId || !account?.id) {
            setRestored(false);
            return;
        }
        let cancelled = false;
        const storageKey = financeDebugStorageKey(account.id, shopId);

        (async () => {
            try {
                const raw = loadFinanceDebugBlob(storageKey);
                let p: {
                    dataByTab?: Partial<Record<TabType, any>>;
                    activeTab?: TabType;
                    pageSize?: number;
                    viewMode?: 'json' | 'table' | 'totals';
                    tiktokStatementOptions?: TiktokStatementOption[];
                    envelopeFocusId?: string;
                    statementEnvelopePageToken?: string;
                } | null = null;
                if (raw) {
                    p = JSON.parse(raw);
                }

                const envelopeHeavy = await loadStatementTxEnvelopeHeavy(account.id, shopId);
                if (cancelled) return;

                if (p) {
                    const base = (p.dataByTab && typeof p.dataByTab === 'object' ? p.dataByTab : {}) as Partial<
                        Record<TabType, any>
                    >;
                    const merged: Partial<Record<TabType, any>> = { ...base };
                    if (envelopeHeavy !== undefined) {
                        merged.statement_tx_envelope = envelopeHeavy as any;
                    }
                    setDataByTab(merged);
                    if (p.activeTab && typeof p.activeTab === 'string') setActiveTab(p.activeTab as TabType);
                    if (typeof p.pageSize === 'number') setPageSize(p.pageSize);
                    if (p.viewMode === 'json' || p.viewMode === 'table' || p.viewMode === 'totals') setViewMode(p.viewMode);
                    if (Array.isArray(p.tiktokStatementOptions)) setTiktokStatementOptions(p.tiktokStatementOptions);
                    if (typeof p.envelopeFocusId === 'string') setEnvelopeFocusId(p.envelopeFocusId);
                    if (typeof p.statementEnvelopePageToken === 'string') {
                        setStatementEnvelopePageToken(p.statementEnvelopePageToken);
                    }
                } else if (envelopeHeavy !== undefined) {
                    setDataByTab({ statement_tx_envelope: envelopeHeavy as any });
                }

                const shared = loadPersistedFinancialDateRange(shopId);
                if (shared) setDateRange(shared);
            } catch (e) {
                console.warn('[FinanceDebug] restore failed', e);
            } finally {
                if (!cancelled) setRestored(true);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [account.id, shopId]);

    useEffect(() => {
        if (!restored || !shopId || !account?.id) return;
        const storageKey = financeDebugStorageKey(account.id, shopId);
        const lightDataByTab = stripHeavyTabForLocalStorage(dataByTab as Record<string, unknown>) as Partial<
            Record<TabType, any>
        >;
        saveFinanceDebugBlob(storageKey, {
            v: FINANCE_DEBUG_STORAGE_V,
            dataByTab: lightDataByTab,
            activeTab,
            pageSize,
            viewMode,
            tiktokStatementOptions,
            envelopeFocusId,
            statementEnvelopePageToken,
        });
        void saveStatementTxEnvelopeHeavy(account.id, shopId, dataByTab.statement_tx_envelope);
    }, [
        restored,
        account.id,
        shopId,
        dataByTab,
        activeTab,
        pageSize,
        viewMode,
        tiktokStatementOptions,
        envelopeFocusId,
        statementEnvelopePageToken,
    ]);

    const tabs = [
        { id: 'statements', label: 'Statements', icon: FileText },
        { id: 'payments', label: 'Payments', icon: CreditCard },
        { id: 'withdrawals', label: 'Withdrawals', icon: ArrowDownCircle },
        { id: 'unsettled', label: 'Unsettled Orders', icon: AlertCircle },
        { id: 'order_tx', label: 'Order Transactions', icon: Search },
        { id: 'statement_tx', label: 'Statement Transactions', icon: Database },
        { id: 'statement_tx_envelope', label: 'Statement TX (TikTok direct · raw)', icon: FileCode },
    ];

    const copyRawResponse = useCallback(async () => {
        if (data == null) return;
        const text = JSON.stringify(data, null, 2);
        try {
            await navigator.clipboard.writeText(text);
            setCopyStatus('copied');
            window.setTimeout(() => setCopyStatus('idle'), 2000);
        } catch {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                setCopyStatus('copied');
                window.setTimeout(() => setCopyStatus('idle'), 2000);
            } catch {
                setCopyStatus('error');
                window.setTimeout(() => setCopyStatus('idle'), 3000);
            }
        }
    }, [data]);

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
        const tabSnapshot = activeTab;

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
                    url = `/api/tiktok-shop/finance/statements/${account.id}`;
                    const { start, end } = getRangeUnix();
                    params.append('start_time', start.toString());
                    params.append('end_time', end.toString());
                    break;

                case 'payments':
                    url = `/api/tiktok-shop/finance/payments/${account.id}`;
                    const { start: pStart, end: pEnd } = getRangeUnix();
                    params.append('create_time_ge', pStart.toString());
                    params.append('create_time_le', pEnd.toString());
                    break;

                case 'withdrawals':
                    url = `/api/tiktok-shop/finance/withdrawals/${account.id}`;
                    const { start: wStart, end: wEnd } = getRangeUnix();
                    // Some shops/APIs may ignore these filters, but we pass range consistently.
                    params.append('start_time', wStart.toString());
                    params.append('end_time', wEnd.toString());
                    break;

                case 'unsettled':
                    url = `/api/tiktok-shop/finance/unsettled/${account.id}`;
                    const { start: uStart, end: uEnd } = getRangeUnix();
                    params.append('order_create_time_ge', uStart.toString());
                    params.append('order_create_time_le', uEnd.toString());
                    break;

                case 'statement_tx_envelope': {
                    const { start, end } = getRangeUnix();
                    /** Same window as P&L: shop-local start day → end day inclusive, as Unix seconds for TikTok. */
                    const STATEMENT_LIST_MAX_PAGES = 100;
                    const statements: any[] = [];
                    let statementListPagesFetched = 0;
                    let listPageNum = 1;
                    let nextStatementPageToken: string | undefined;
                    for (let p = 0; p < STATEMENT_LIST_MAX_PAGES; p++) {
                        const qs = new URLSearchParams({
                            shopId,
                            page_size: '100',
                            start_time: String(start),
                            end_time: String(end),
                        });
                        if (nextStatementPageToken) {
                            qs.set('page_token', nextStatementPageToken);
                        } else {
                            qs.set('page_number', String(listPageNum));
                        }
                        const statementsUrl = `/api/tiktok-shop/finance/statements/${account.id}?${qs.toString()}`;
                        const statementsRes = await apiFetch(statementsUrl).then(r => r.json());
                        if (!statementsRes.success) throw new Error(statementsRes.error || 'Failed to load statements from TikTok');

                        const batch = statementsRes.data?.statements || statementsRes.data?.statement_list || [];
                        if (!Array.isArray(batch)) break;
                        if (batch.length === 0) break;
                        statements.push(...batch);
                        statementListPagesFetched += 1;

                        const nextTok = statementsRes.data?.next_page_token;
                        if (!nextTok) break;
                        nextStatementPageToken = nextTok;
                        listPageNum += 1;
                    }

                    const statementsListUnfiltered = statements.length;
                    const statementsInRange = filterStatementsByStatementTimeWindow(statements, start, end);

                    if (statementsListUnfiltered === 0) {
                        throw new Error(
                            'No statements returned from TikTok for this date range. Widen the range or verify dates in Seller Center.'
                        );
                    }

                    const mapRowToOption = (s: any): TiktokStatementOption | null => {
                        const statement_id = s.id || s.statement_id;
                        if (!statement_id) return null;
                        const st = s.statement_time;
                        let statement_time = '';
                        if (st != null && st !== '') {
                            const sec = parseStatementTimeSeconds(st);
                            statement_time =
                                sec != null && sec > 946684800 ? new Date(sec * 1000).toISOString() : String(st);
                        }
                        return { statement_id: String(statement_id), statement_time };
                    };

                    const inRangeIdSet = new Set(
                        statementsInRange.map((s: any) => String(s.id || s.statement_id)).filter(Boolean)
                    );

                    const dropdownOptions: TiktokStatementOption[] = statements
                        .map((s: any) => {
                            const o = mapRowToOption(s);
                            if (!o) return null;
                            return { ...o, in_master_range: inRangeIdSet.has(o.statement_id) };
                        })
                        .filter(Boolean) as TiktokStatementOption[];

                    setTiktokStatementOptions(dropdownOptions);

                    const orderedIdsInRange = statementsInRange
                        .map((s: any) => String(s.id || s.statement_id))
                        .filter(Boolean);

                    if (statementsInRange.length === 0 && !envelopeFocusId.trim()) {
                        throw new Error(
                            `TikTok returned ${statementsListUnfiltered} statement(s), but none have statement_time inside your master range (Unix ${start}–${end}, ${timezone}). ` +
                                'Use Focus to pick a statement ID from the full list (every ID TikTok returned), or widen the date range.'
                        );
                    }

                    let staleFocusCleared = false;
                    let effectiveFocus = envelopeFocusId.trim();
                    if (effectiveFocus) {
                        const found = dropdownOptions.some(
                            (o) => String(o.statement_id) === String(effectiveFocus)
                        );
                        if (!found) {
                            staleFocusCleared = true;
                            effectiveFocus = '';
                            setEnvelopeFocusId('');
                        }
                    }

                    let targetIds: string[];
                    if (effectiveFocus) {
                        targetIds = [effectiveFocus];
                    } else {
                        targetIds = orderedIdsInRange;
                    }

                    const pageToken = statementEnvelopePageToken.trim();
                    let truncatedForPageToken = false;
                    if (pageToken && targetIds.length > 1) {
                        targetIds = [targetIds[0]];
                        truncatedForPageToken = true;
                    }

                    const results: {
                        statement_id: string;
                        tiktok?: unknown;
                        error?: string;
                        merge_meta?: MergedEnvelopeMeta;
                    }[] = [];
                    const userTxPageToken = pageToken;
                    for (const statement_id of targetIds) {
                        try {
                            if (userTxPageToken) {
                                const envParams = new URLSearchParams({
                                    shopId,
                                    page_size: '100',
                                    page_token: userTxPageToken,
                                });
                                const envUrl = `/api/tiktok-shop/finance/transactions/${account.id}/${encodeURIComponent(statement_id)}/tiktok-envelope?${envParams.toString()}`;
                                const envRes = await apiFetch(envUrl).then(r => r.json());
                                if (!envRes.success) throw new Error(envRes.error || 'Request failed');
                                const txs = envRes.tiktok?.data?.transactions;
                                const n = Array.isArray(txs) ? txs.length : 0;
                                results.push({
                                    statement_id,
                                    tiktok: envRes.tiktok,
                                    merge_meta: { tx_pages_fetched: 1, merged_transaction_count: n, hit_page_cap: false },
                                });
                            } else {
                                const { tiktok, meta } = await mergeStatementTransactionEnvelopePages(
                                    (url) => apiFetch(url).then((r) => r.json()),
                                    (qs) => {
                                        qs.set('shopId', shopId);
                                        return `/api/tiktok-shop/finance/transactions/${account.id}/${encodeURIComponent(statement_id)}/tiktok-envelope?${qs.toString()}`;
                                    }
                                );
                                results.push({ statement_id, tiktok, merge_meta: meta });
                            }
                        } catch (e: unknown) {
                            const msg = e instanceof Error ? e.message : String(e);
                            results.push({ statement_id, error: msg });
                        }
                    }

                    setDataByTab((prev) => ({
                        ...prev,
                        [tabSnapshot]: {
                            mode: 'tiktok_direct_envelopes',
                            data_source: 'tiktok_api_only',
                            statements_list_api: '/finance/202309/statements',
                            statement_transactions_api: '/finance/202501/statements/{id}/statement_transactions',
                            date_range_unix: { start, end },
                            timezone,
                            master_range_starts_in_future: start > Math.floor(Date.now() / 1000),
                            audit_alignment:
                                'Master Date Range uses the shop timezone above. We send start_time/end_time to TikTok, but the statements list often returns extra rows—Mamba then keeps only statements whose statement_time (Unix) falls in [start, end), same window as P&L for those dates.',
                            tiktok_statements_in_response: statementsInRange.length,
                            tiktok_statements_list_unfiltered: statementsListUnfiltered,
                            statements_list_pages: statementListPagesFetched,
                            envelopes_fetched: targetIds.length,
                            stale_focus_cleared: staleFocusCleared,
                            truncated_for_page_token: truncatedForPageToken,
                            transaction_pages_note:
                                'Transaction lines are merged from every page of GET statement_transactions (up to 50 pages × 100 rows) so affiliate totals match P&amp;L sync and Seller Center. Set Page token to fetch a single page only (debug).',
                            envelope_merge_any_page_cap: results.some((r) => r.merge_meta?.hit_page_cap),
                            transaction_merge_pages_total: results.reduce((s, r) => s + (r.merge_meta?.tx_pages_fetched ?? 0), 0),
                            transaction_merge_tx_rows_total: results.reduce((s, r) => s + (r.merge_meta?.merged_transaction_count ?? 0), 0),
                            /** IDs we actually called GET statement_transactions for (matches Focus or “all in range”). */
                            envelope_target_ids: [...targetIds],
                            results,
                        },
                    }));
                    return;
                }

                case 'order_tx':
                case 'statement_tx': {
                    const { start: sStart, end: sEnd } = getRangeUnix();
                    const statementsUrl = `/api/tiktok-shop/finance/statements/${account.id}?shopId=${encodeURIComponent(shopId)}&page_size=${pageSize}&start_time=${sStart}&end_time=${sEnd}`;
                    const statementsRes = await apiFetch(statementsUrl).then(r => r.json());
                    if (!statementsRes.success) throw new Error(statementsRes.error || 'Failed to load statements');
                    const statementsRaw = statementsRes.data?.statements || statementsRes.data?.statement_list || [];
                    if (!Array.isArray(statementsRaw) || statementsRaw.length === 0) {
                        setDataByTab((prev) => ({
                            ...prev,
                            [tabSnapshot]: {
                                mode: 'auto',
                                statements: [],
                                transactions: [],
                                per_statement: [],
                                reconciliation: null,
                            },
                        }));
                        return;
                    }
                    const statements = filterStatementsByStatementTimeWindow(statementsRaw, sStart, sEnd);
                    if (statements.length === 0) {
                        setDataByTab((prev) => ({
                            ...prev,
                            [tabSnapshot]: {
                                mode: 'auto',
                                statements: [],
                                transactions: [],
                                per_statement: [],
                                reconciliation: null,
                                timezone_used: timezone,
                                statements_list_unfiltered: statementsRaw.length,
                                statement_time_filter_note:
                                    'No statements with statement_time in the master range; TikTok list may ignore start_time/end_time.',
                            },
                        }));
                        return;
                    }

                    const statementIds = statements
                        .map((s: any) => s.id || s.statement_id)
                        .filter(Boolean)
                        .slice(0, pageSize);

                    const perStatement: any[] = [];
                    const allTransactions: any[] = [];
                    for (const statementId of statementIds) {
                        const txUrl = `/api/tiktok-shop/finance/transactions/${account.id}/${statementId}?shopId=${encodeURIComponent(shopId)}&page_size=100`;
                        const txRes = await apiFetch(txUrl).then(r => r.json());
                        if (!txRes.success) continue;
                        const txRows = txRes.data?.transactions || txRes.data?.transaction_list || txRes.data?.statement_transactions || [];
                        perStatement.push({ statement_id: statementId, transaction_count: txRows.length, raw_response: txRes.data });
                        allTransactions.push(...txRows);
                    }

                    if (activeTab === 'statement_tx') {
                        setDataByTab((prev) => ({
                            ...prev,
                            [tabSnapshot]: {
                                mode: 'auto',
                                statements,
                                statement_ids: statementIds,
                                per_statement: perStatement,
                                transactions: allTransactions,
                                reconciliation: buildReconciliation(statements, allTransactions),
                                timezone_used: timezone,
                            },
                        }));
                        return;
                    }

                    // order_tx mode: auto-discover order IDs from statement transactions, then fetch each order transaction payload.
                    const orderIds = Array.from(new Set(allTransactions.map((tx: any) => tx.order_id).filter(Boolean))).slice(0, pageSize);
                    const perOrder: any[] = [];
                    const orderTransactions: any[] = [];
                    for (const orderId of orderIds) {
                        const orderUrl = `/api/tiktok-shop/finance/transactions/order/${account.id}/${orderId}?shopId=${encodeURIComponent(shopId)}&page_size=100`;
                        const orderRes = await apiFetch(orderUrl).then(r => r.json());
                        if (!orderRes.success) continue;
                        const txRows = orderRes.data?.transactions || orderRes.data?.transaction_list || [];
                        perOrder.push({ order_id: orderId, transaction_count: txRows.length, raw_response: orderRes.data });
                        orderTransactions.push(...txRows);
                    }

                    setDataByTab((prev) => ({
                        ...prev,
                        [tabSnapshot]: {
                            mode: 'auto',
                            source_statement_ids: statementIds,
                            order_ids: orderIds,
                            per_order: perOrder,
                            transactions: orderTransactions,
                            timezone_used: timezone,
                        },
                    }));
                    return;
                }
            }

            const response = await apiFetch(`${url}?${params.toString()}`);
            const result = await response.json();

            if (result.success) {
                let payload = result.data;
                if (tabSnapshot === 'statements' && payload && typeof payload === 'object') {
                    const { start: fs, end: fe } = getRangeUnix();
                    payload = { ...payload };
                    if (Array.isArray(payload.statements)) {
                        payload.statements = filterStatementsByStatementTimeWindow(payload.statements, fs, fe);
                    }
                    if (Array.isArray(payload.statement_list)) {
                        payload.statement_list = filterStatementsByStatementTimeWindow(payload.statement_list, fs, fe);
                    }
                }
                setDataByTab((prev) => ({ ...prev, [tabSnapshot]: payload }));
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
                    <p className="text-gray-400">
                        Explore raw financial data from TikTok Shop APIs. Fetched payloads and the master date range persist (localStorage + IndexedDB for large Statement TX raw JSON) so you can switch tabs and compare to P&amp;L.
                    </p>
                </div>
                <div className="flex gap-2">
                    <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700 flex-wrap gap-1">
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
                        <button
                            type="button"
                            onClick={() => setViewMode('totals')}
                            disabled={!data || (data as { mode?: string }).mode !== 'tiktok_direct_envelopes'}
                            title="Aggregated sums for Statement TX (TikTok direct) fetch"
                            className={`flex items-center gap-1.5 px-3 py-1 rounded text-sm font-medium transition-colors ${viewMode === 'totals'
                                ? 'bg-gray-700 text-white shadow-sm'
                                : 'text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed'
                                }`}
                        >
                            <Sigma size={16} />
                            Totals
                        </button>
                    </div>
                    <button
                        className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm border border-gray-700"
                        onClick={() => {
                            if (activeTab === 'statement_tx_envelope' && account?.id && shopId) {
                                void saveStatementTxEnvelopeHeavy(account.id, shopId, undefined);
                            }
                            setDataByTab((prev) => {
                                const next = { ...prev };
                                delete next[activeTab];
                                return next;
                            });
                            setError(null);
                        }}
                    >
                        Clear tab data
                    </button>
                </div>
            </div>

            {/* Master Date Range (shared by all tabs) */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="min-w-[320px]">
                        <label className="block text-xs font-medium text-gray-400 mb-2 uppercase">Master Date Range</label>
                        <DateRangePicker value={dateRange} onChange={handleDateRangeChange} timezone={timezone} />
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
                                Focus lists every statement ID TikTok returned for the list request; bulk fetch uses only IDs whose statement_time is in the master range unless you pick one in Focus.
                            </div>
                        </div>
                    )}

                    {activeTab === 'statement_tx_envelope' && (
                        <>
                            <div className="col-span-full">
                                <label className="block text-xs font-medium text-gray-400 mb-2 uppercase">Direct from TikTok (no Supabase)</label>
                                <div className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-300 text-sm space-y-2">
                                    <p>
                                        <strong className="text-gray-200">P&amp;L audit:</strong> Master Date Range is converted with{' '}
                                        <span className="font-mono text-pink-300">{timezone}</span> to <span className="font-mono">start_time</span> /{' '}
                                        <span className="font-mono">end_time</span> (Unix). That is the <strong>same window</strong> Profit &amp; Loss uses when you pick the same dates
                                        (P&amp;L reads synced <span className="font-mono">shop_settlements</span>; this calls TikTok live).
                                    </p>
                                    <p>
                                        TikTok <span className="font-mono text-gray-200">GET /finance/202309/statements</span> is paginated until all statements in that window are loaded,
                                        then each gets <span className="font-mono text-gray-200">/finance/202501/statements/&#123;id&#125;/statement_transactions</span>.
                                    </p>
                                    <p className="text-gray-500 text-xs">
                                        Pick a single day (e.g. Mar 16) or a range (e.g. Mar 16–19): totals cover every statement TikTok returns for that filter—not &quot;other timezones,&quot;
                                        because the range is fixed Unix seconds for your shop&apos;s local days.
                                    </p>
                                </div>
                            </div>
                            {tiktokStatementOptions.length > 0 && (
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-gray-400 mb-2 uppercase">Focus statement (optional)</label>
                                    <select
                                        value={envelopeFocusId}
                                        onChange={(e) => setEnvelopeFocusId(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-pink-500 text-sm"
                                    >
                                        <option value="">All statements in master range only (newest first)</option>
                                        {tiktokStatementOptions.map((s) => (
                                            <option key={s.statement_id} value={s.statement_id}>
                                                {s.statement_id}
                                                {s.statement_time ? ` — ${s.statement_time}` : ''}
                                                {s.in_master_range === true ? ' — in master range' : ''}
                                                {s.in_master_range === false ? ' — outside master range' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="col-span-2">
                                <label className="block text-xs font-medium text-gray-400 mb-2 uppercase">Page token (optional)</label>
                                <input
                                    type="text"
                                    value={statementEnvelopePageToken}
                                    onChange={(e) => setStatementEnvelopePageToken(e.target.value)}
                                    placeholder="Leave empty to merge all transaction pages. Set to next_page_token for one page only (totals incomplete)."
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-pink-500 font-mono text-sm"
                                />
                            </div>
                        </>
                    )}

                    {activeTab !== 'statement_tx_envelope' && (
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
                    )}

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
                        {data.mode === 'tiktok_direct_envelopes' && (
                            <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-4 text-sky-100 text-sm space-y-2">
                                <h4 className="font-semibold text-sky-200">TikTok direct (P&amp;L audit)</h4>
                                <p>
                                    Statements in range (after statement_time filter):{' '}
                                    <span className="font-mono text-white">{data.tiktok_statements_in_response}</span>
                                    {data.tiktok_statements_list_unfiltered != null &&
                                        data.tiktok_statements_list_unfiltered > data.tiktok_statements_in_response && (
                                            <>
                                                {' '}
                                                <span className="text-amber-200/90">
                                                    (list API returned {data.tiktok_statements_list_unfiltered} row
                                                    {data.tiktok_statements_list_unfiltered === 1 ? '' : 's'} before filter)
                                                </span>
                                            </>
                                        )}
                                    {data.statements_list_pages != null && (
                                        <>
                                            {' · '}
                                            List API pages: <span className="font-mono text-white">{data.statements_list_pages}</span>
                                        </>
                                    )}
                                    {' · '}Envelopes fetched: <span className="font-mono text-white">{data.envelopes_fetched}</span>
                                </p>
                                {data.master_range_starts_in_future && (
                                    <p className="text-amber-200/90 text-xs">
                                        Master range starts in the future—there are usually no settlements yet; the statement_time filter may drop every list row.
                                    </p>
                                )}
                                {data.stale_focus_cleared && (
                                    <p className="text-amber-200/90 text-xs">
                                        The previously focused statement is not in this range (often after changing dates). Focus was cleared; fetched all statements in range.
                                    </p>
                                )}
                                <p className="text-xs text-sky-200/80 font-mono">
                                    start_time={data.date_range_unix?.start} end_time={data.date_range_unix?.end} ({data.timezone})
                                </p>
                                {data.transaction_merge_pages_total != null && data.transaction_merge_pages_total > 0 && (
                                    <p className="text-xs text-sky-200/90">
                                        Merged TikTok transaction API pages:{' '}
                                        <span className="font-mono text-white">{data.transaction_merge_pages_total}</span>
                                        {data.transaction_merge_tx_rows_total != null && (
                                            <>
                                                {' · '}
                                                lines in merged payload:{' '}
                                                <span className="font-mono text-white">{data.transaction_merge_tx_rows_total}</span>
                                            </>
                                        )}
                                    </p>
                                )}
                                {Array.isArray(data.envelope_target_ids) && data.envelope_target_ids.length > 0 && (
                                    <p className="text-xs text-sky-200/90">
                                        This fetch called statement_transactions for:{' '}
                                        <span className="font-mono text-white break-all">{data.envelope_target_ids.join(', ')}</span>
                                        . Totals use this id (from Focus or “all in range”). If it doesn’t match your Focus selection, click{' '}
                                        <strong className="text-sky-100">Fetch Data</strong> again after changing Focus.
                                    </p>
                                )}
                                {data.audit_alignment && (
                                    <p className="text-xs text-sky-100/90 leading-relaxed">{data.audit_alignment}</p>
                                )}
                                {data.transaction_pages_note && (
                                    <p className="text-xs text-amber-200/90 leading-relaxed">{data.transaction_pages_note}</p>
                                )}
                                {data.envelope_merge_any_page_cap && (
                                    <p className="text-xs text-red-300/90 leading-relaxed">
                                        Transaction merge stopped at the safety cap (50 pages). Totals may be incomplete—run Finance sync or raise{' '}
                                        <span className="font-mono">STATEMENT_TX_MAX_PAGES</span> if needed.
                                    </p>
                                )}
                                {data.truncated_for_page_token && (
                                    <p className="text-amber-200/90 text-xs">Page token set with multiple statements: only the first statement in the list was requested. Use Focus to pick one statement.</p>
                                )}
                            </div>
                        )}
                        {data.statement_time_filter_note && (
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-amber-100 text-sm">
                                <p>{data.statement_time_filter_note}</p>
                                {data.statements_list_unfiltered != null && (
                                    <p className="text-xs text-amber-200/80 mt-1">
                                        TikTok list returned {data.statements_list_unfiltered} row(s); none had statement_time in your master range.
                                    </p>
                                )}
                            </div>
                        )}
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
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <h3 className="text-white font-medium">Response Data</h3>
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    type="button"
                                    onClick={() => void copyRawResponse()}
                                    disabled={data == null}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Copy full raw response as formatted JSON"
                                >
                                    {copyStatus === 'copied' ? (
                                        <Check size={16} className="text-emerald-400" />
                                    ) : (
                                        <Copy size={16} />
                                    )}
                                    {copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Copy failed' : 'Copy raw JSON'}
                                </button>
                                <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
                                    {data?.mode === 'tiktok_direct_envelopes'
                                        ? `${data.results?.length ?? 0} live envelope(s)`
                                        : Array.isArray(data)
                                            ? `${data.length} items`
                                            : (data?.data?.transactions?.length != null
                                                ? `${data.data.transactions.length} transactions (TikTok data)`
                                                : (data?.transactions?.length ? `${data.transactions.length} transactions` : 'Object'))}
                                </span>
                            </div>
                        </div>

                        {viewMode === 'totals' && data?.mode === 'tiktok_direct_envelopes' && Array.isArray(data.results) ? (
                            <div className="bg-black rounded-lg border border-gray-800 p-4 overflow-auto max-h-[800px]">
                                <FinanceEnvelopeTotalsPanel results={data.results} />
                            </div>
                        ) : viewMode === 'totals' ? (
                            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-gray-400 text-sm">
                                Switch to <span className="text-pink-400">Statement TX (TikTok direct · raw)</span>, fetch data, then open Totals.
                            </div>
                        ) : viewMode === 'table' ? (
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
        case 'statement_tx_envelope': return <FileCode className="text-pink-500" size={20} />;
        default: return <FileText className="text-pink-500" size={20} />;
    }
}
