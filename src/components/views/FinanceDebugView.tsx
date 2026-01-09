import { useState } from 'react';
import { Account } from '../../lib/supabase';
import { Search, FileText, CreditCard, ArrowDownCircle, AlertCircle, Database, RefreshCw } from 'lucide-react';
import { DateRangePicker, DateRange } from '../DateRangePicker';

interface FinanceDebugViewProps {
    account: Account;
    shopId?: string;
}

type TabType = 'statements' | 'payments' | 'withdrawals' | 'unsettled' | 'order_tx' | 'statement_tx';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export function FinanceDebugView({ account, shopId }: FinanceDebugViewProps) {
    const [viewMode, setViewMode] = useState<'json' | 'table'>('table');
    const [activeTab, setActiveTab] = useState<TabType>('statements');
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Configuration State
    const [dateRange, setDateRange] = useState<DateRange>({
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
    });
    const [pageSize, setPageSize] = useState(20);
    const [targetId, setTargetId] = useState(''); // For Order ID or Statement ID

    const tabs = [
        { id: 'statements', label: 'Statements', icon: FileText },
        { id: 'payments', label: 'Payments', icon: CreditCard },
        { id: 'withdrawals', label: 'Withdrawals', icon: ArrowDownCircle },
        { id: 'unsettled', label: 'Unsettled Orders', icon: AlertCircle },
        { id: 'order_tx', label: 'Order Transactions', icon: Search },
        { id: 'statement_tx', label: 'Statement Transactions', icon: Database },
    ];

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
                    // Statements usually take start_time/end_time or similar. 
                    // Let's pass our date range and let the backend/API handle it.
                    // Based on tiktok-shop-finance.routes.ts, it passes query params through.
                    // TikTok API usually expects unix timestamp in seconds or milliseconds.
                    // Let's try passing standard start_time/end_time in seconds.
                    const start = Math.floor(new Date(dateRange.startDate).getTime() / 1000);
                    const end = Math.floor(new Date(dateRange.endDate).getTime() / 1000) + 86400;
                    params.append('start_time', start.toString());
                    params.append('end_time', end.toString());
                    break;

                case 'payments':
                    url = `${API_BASE_URL}/api/tiktok-shop/finance/payments/${account.id}`;
                    const pStart = Math.floor(new Date(dateRange.startDate).getTime() / 1000);
                    const pEnd = Math.floor(new Date(dateRange.endDate).getTime() / 1000) + 86400;
                    params.append('create_time_ge', pStart.toString());
                    params.append('create_time_le', pEnd.toString());
                    break;

                case 'withdrawals':
                    url = `${API_BASE_URL}/api/tiktok-shop/finance/withdrawals/${account.id}`;
                    // Withdrawals might not support time filtering in the same way, but we'll try
                    break;

                case 'unsettled':
                    url = `${API_BASE_URL}/api/tiktok-shop/finance/unsettled/${account.id}`;
                    break;

                case 'order_tx':
                    if (!targetId) {
                        throw new Error('Order ID is required');
                    }
                    url = `${API_BASE_URL}/api/tiktok-shop/finance/transactions/order/${account.id}/${targetId}`;
                    break;

                case 'statement_tx':
                    if (!targetId) {
                        throw new Error('Statement ID is required');
                    }
                    url = `${API_BASE_URL}/api/tiktok-shop/finance/transactions/${account.id}/${targetId}`;
                    break;
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
                    {['statements', 'payments', 'withdrawals', 'unsettled'].includes(activeTab) && (
                        <div className="col-span-2">
                            <label className="block text-xs font-medium text-gray-400 mb-2 uppercase">Date Range</label>
                            <DateRangePicker value={dateRange} onChange={setDateRange} />
                        </div>
                    )}

                    {['order_tx', 'statement_tx'].includes(activeTab) && (
                        <div className="col-span-2">
                            <label className="block text-xs font-medium text-gray-400 mb-2 uppercase">
                                {activeTab === 'order_tx' ? 'Order ID' : 'Statement ID'}
                            </label>
                            <input
                                type="text"
                                value={targetId}
                                onChange={(e) => setTargetId(e.target.value)}
                                placeholder={activeTab === 'order_tx' ? 'Enter Order ID...' : 'Enter Statement ID...'}
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-pink-500"
                            />
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
                        <div className="flex items-center justify-between">
                            <h3 className="text-white font-medium">Response Data</h3>
                            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
                                {Array.isArray(data) ? `${data.length} items` : 'Object'}
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
