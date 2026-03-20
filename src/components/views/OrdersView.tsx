import { useState, useMemo, useEffect } from 'react';
import { Search, Filter, RefreshCw, Box, Truck, BarChart3, ChevronDown, ChevronUp, XCircle, BadgeCheck, Users } from 'lucide-react';
import { useShopStore, Order } from '../../store/useShopStore';
import { Account } from '../../lib/supabase';
import { OrderCard } from '../OrderCard';
import { OrderDetails } from '../OrderDetails';
import { ViewToggle, ViewMode } from '../ViewToggle';
import { OrderListRow } from '../OrderListRow';
import { OrderKanbanBoard } from '../OrderKanbanBoard';
import { ComparisonCharts } from '../ComparisonCharts';
import { CalculationTooltip } from '../CalculationTooltip';
import { DateRangePicker, DateRange } from '../DateRangePicker';
import { toLocalDateString, getShopDayStartTimestamp, getDateRangeFromPreset } from '../../utils/dateUtils';

// Use paid_time for filtering (matches backend which loads by paid_time)
const getOrderTs = (o: Order): number => Number(o.paid_time || o.created_time);

// Helper function to detect cancelled or refunded orders
const isCancelledOrRefunded = (order: Order): boolean => {
    return (
        order.order_status === 'CANCELLED' ||
        !!order.cancel_reason ||
        !!order.cancellation_initiator
    );
};

// Effective timestamp for date-range filtering:
// Cancelled orders use update_time (when they were cancelled).
// Active orders use paid_time || created_time.
const getEffectiveOrderTs = (o: Order): number => {
    if (isCancelledOrRefunded(o)) {
        return Number(o.update_time || o.paid_time || o.created_time);
    }
    return Number(o.paid_time || o.created_time);
};

interface OrdersViewProps {
    account: Account;
    shopId?: string;
    timezone?: string; // Shop timezone for date calculations
}


export function OrdersView({ account, shopId, timezone = 'America/Los_Angeles' }: OrdersViewProps) {
    const { orders, isLoading, syncData, cacheMetadata, dataVersion, fetchShopData } = useShopStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [fulfillmentFilter, setFulfillmentFilter] = useState('all');
    const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid'>('all'); // NEW: Payment filter
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('cards');
    const [showCharts, setShowCharts] = useState(true);
    const [dateRange, setDateRange] = useState<DateRange>(() => {
        try {
            const preset = localStorage.getItem(`mamba:default_date_preset:${shopId || 'default'}`) || 'today';
            return getDateRangeFromPreset(preset, timezone);
        } catch {
            return getDateRangeFromPreset('today', timezone);
        }
    });

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = viewMode === 'list' ? 25 : 50;

    // Load any missing data when the date range changes, including the previous period
    // so the comparison chart has data for both the current and preceding window.
    // fetchShopData's smart cache only fetches what isn't already in the store.
    useEffect(() => {
        if (!shopId) return;
        fetchShopData(account.id, shopId, { skipSyncCheck: true, includePreviousPeriod: true }, dateRange.startDate, dateRange.endDate);
    }, [account.id, shopId, dateRange.startDate, dateRange.endDate]);

    // Shared toggles — synced with OverviewView via localStorage + custom events
    const [includeCancelledInTotal, setIncludeCancelledInTotal] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem(`mamba:view_settings:cancelled_total:${shopId || 'default'}`);
            return saved !== null ? saved === 'true' : true;
        } catch { return true; }
    });

    const [includeCancelledFinancials, setIncludeCancelledFinancials] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem(`mamba:view_settings:cancelled_financials:${shopId || 'default'}`);
            return saved !== null ? saved === 'true' : true;
        } catch { return true; }
    });

    useEffect(() => {
        const handleTotal = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail.shopId === (shopId || 'default')) setIncludeCancelledInTotal(detail.value);
        };
        const handleFinancials = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail.shopId === (shopId || 'default')) setIncludeCancelledFinancials(detail.value);
        };
        window.addEventListener('mamba:cancelled_total_changed', handleTotal);
        window.addEventListener('mamba:cancelled_financials_changed', handleFinancials);
        return () => {
            window.removeEventListener('mamba:cancelled_total_changed', handleTotal);
            window.removeEventListener('mamba:cancelled_financials_changed', handleFinancials);
        };
    }, [shopId]);

    const handleSync = async () => {
        if (!shopId) return;
        await syncData(account.id, shopId, 'orders');
    };

    // Check if filtering "on hold" orders - force list view
    const isOnHoldFilter = statusFilter === 'ON_HOLD' || statusFilter === 'PARTIALLY_SHIPPING';
    const effectiveViewMode = isOnHoldFilter ? 'list' : viewMode;

    // Date-only filtered orders (for Kanban and status breakdown - no other filters)
    // Exclude sample orders AND cancelled/refunded orders from display
    const dateFilteredOrders = useMemo(() => {
        const startTs = getShopDayStartTimestamp(dateRange.startDate, timezone);
        const endTs = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;
        return orders.filter(o =>
            getOrderTs(o) >= startTs &&
            getOrderTs(o) < endTs &&
            o.is_sample_order !== true &&
            !isCancelledOrRefunded(o)
        );
    }, [orders, dateRange, dataVersion]);

    // All non-sample orders in date range including cancelled — used for customer counting
    const allDateOrders = useMemo(() => {
        const startTs = getShopDayStartTimestamp(dateRange.startDate, timezone);
        const endTs = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;
        return orders.filter(o =>
            getOrderTs(o) >= startTs &&
            getOrderTs(o) < endTs &&
            o.is_sample_order !== true
        );
    }, [orders, dateRange, timezone, dataVersion]);

    // Total Orders count: always use paid_time || created_time for ALL orders
    // (same as ComparisonCharts) so the stat card and chart always agree.
    const totalOrdersCount = useMemo(() => {
        const startTs = getShopDayStartTimestamp(dateRange.startDate, timezone);
        const endTs = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;
        return orders.filter(o => {
            if (o.is_sample_order === true) return false;
            if (isCancelledOrRefunded(o) && !includeCancelledInTotal) return false;
            const ts = getOrderTs(o); // always paid_time || created_time — matches chart
            return ts >= startTs && ts < endTs;
        }).length;
    }, [orders, dateRange, timezone, includeCancelledInTotal, dataVersion]);

    const filteredOrders = useMemo(() => {
        // Use Shop Timezone for filtering
        const startTs = getShopDayStartTimestamp(dateRange.startDate, timezone);
        const endTs = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;

        return orders.filter(order => {
            // Special handling for sample orders
            const isSample = order.is_sample_order;
            if (statusFilter === 'SAMPLE') {
                return isSample;
            } else if (isSample) {
                return false; // Exclude sample orders from other views
            }

            // Special handling for cancelled/refunded orders
            const isCancelled = isCancelledOrRefunded(order);
            if (statusFilter === 'CANCELLED_REFUNDED') {
                if (!isCancelled) return false;
                // Use update_time for date filtering: show orders cancelled within the range
                const cancelTs = getEffectiveOrderTs(order);
                return cancelTs >= startTs && cancelTs < endTs;
            } else if (isCancelled) {
                return false; // Exclude cancelled/refunded orders from other views
            }

            // Payment filter (NEW)
            if (paymentFilter === 'paid' && !order.paid_time) {
                return false; // Exclude unpaid orders when filtering for paid
            }
            if (paymentFilter === 'unpaid' && order.paid_time) {
                return false; // Exclude paid orders when filtering for unpaid
            }

            // Date range filter: Use paid_time if available, otherwise fall back to create_time
            const timeToFilter = order.paid_time || order.created_time;
            const matchesDateRange = Number(timeToFilter) >= startTs && Number(timeToFilter) < endTs;

            const matchesSearch =
                order.order_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                order.line_items.some(item => item.product_name.toLowerCase().includes(searchTerm.toLowerCase()));

            const matchesStatus = statusFilter === 'all' || order.order_status === statusFilter;

            // FBT filter
            let matchesFulfillment = true;
            if (fulfillmentFilter === 'fbt') {
                matchesFulfillment = order.is_fbt === true || order.fulfillment_type === 'FULFILLMENT_BY_TIKTOK';
            } else if (fulfillmentFilter === 'seller') {
                matchesFulfillment = order.is_fbt !== true && order.fulfillment_type !== 'FULFILLMENT_BY_TIKTOK';
            }

            return matchesDateRange && matchesSearch && matchesStatus && matchesFulfillment;
        }).sort((a, b) => {
            // Cancelled view: sort by update_time descending (most recently cancelled first)
            if (statusFilter === 'CANCELLED_REFUNDED') {
                const aTs = Number(a.update_time || a.paid_time || a.created_time);
                const bTs = Number(b.update_time || b.paid_time || b.created_time);
                return bTs - aTs;
            }
            // Default: most recently paid/created first
            const aTs = Number(a.paid_time || a.created_time);
            const bTs = Number(b.paid_time || b.created_time);
            return bTs - aTs;
        });
    }, [orders, searchTerm, statusFilter, fulfillmentFilter, paymentFilter, dateRange, dataVersion]);

    // All counts filtered by the selected date range
    // dateFilteredOrders already excludes samples & cancelled — reuse for FBT/Seller/All
    const fbtOrdersCount = dateFilteredOrders.filter(o => o.is_fbt === true || o.fulfillment_type === 'FULFILLMENT_BY_TIKTOK').length;
    const sellerOrdersCount = dateFilteredOrders.filter(o => o.is_fbt !== true && o.fulfillment_type !== 'FULFILLMENT_BY_TIKTOK').length;
    const onHoldCount = filteredOrders.filter(o => o.order_status?.toUpperCase() === 'ON_HOLD' || o.order_status?.toUpperCase() === 'PARTIALLY_SHIPPING').length;

    const sampleOrdersCount = useMemo(() => {
        const startTs = getShopDayStartTimestamp(dateRange.startDate, timezone);
        const endTs = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;
        return orders.filter(o => o.is_sample_order === true && getOrderTs(o) >= startTs && getOrderTs(o) < endTs).length;
    }, [orders, dateRange, timezone, dataVersion]);

    const cancelledRefundedCount = useMemo(() => {
        const startTs = getShopDayStartTimestamp(dateRange.startDate, timezone);
        const endTs = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;
        return orders.filter(o =>
            isCancelledOrRefunded(o) && !o.is_sample_order &&
            getEffectiveOrderTs(o) >= startTs && getEffectiveOrderTs(o) < endTs
        ).length;
    }, [orders, dateRange, timezone, dataVersion]);

    const paidOrdersCount = useMemo(() => {
        const startTs = getShopDayStartTimestamp(dateRange.startDate, timezone);
        const endTs = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;
        return orders.filter(o =>
            o.paid_time && !o.is_sample_order && !isCancelledOrRefunded(o) &&
            Number(o.paid_time) >= startTs && Number(o.paid_time) < endTs
        ).length;
    }, [orders, dateRange, timezone, dataVersion]);

    const unpaidOrdersCount = useMemo(() => {
        const startTs = getShopDayStartTimestamp(dateRange.startDate, timezone);
        const endTs = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;
        return orders.filter(o =>
            !o.paid_time && !o.is_sample_order && !isCancelledOrRefunded(o) &&
            Number(o.created_time) >= startTs && Number(o.created_time) < endTs
        ).length;
    }, [orders, dateRange, timezone, dataVersion]);

    // Daily-sum customer count: a buyer who purchases on two separate days counts as 2
    // (matches TikTok Seller Center behavior)
    const totalCustomers = useMemo(() => {
        const getBuyerId = (o: Order): string =>
            (o.buyer_info as any)?.buyer_user_id || (o.buyer_info as any)?.buyer_email || o.order_id;
        const dayMap = new Map<string, Set<string>>();
        for (const o of allDateOrders) {
            const day = toLocalDateString(new Date(getOrderTs(o) * 1000));
            if (!dayMap.has(day)) dayMap.set(day, new Set());
            dayMap.get(day)!.add(getBuyerId(o));
        }
        return Array.from(dayMap.values()).reduce((sum, s) => sum + s.size, 0);
    }, [allDateOrders]);

    // Status breakdown (using date-only filtered orders to match Kanban)
    const unpaidStatusCount = dateFilteredOrders.filter(o => o.order_status?.toUpperCase() === 'UNPAID').length;
    const cancelledStatusCount = dateFilteredOrders.filter(o => o.order_status?.toUpperCase() === 'CANCELLED').length;
    const onHoldStatusCount = dateFilteredOrders.filter(o => {
        const status = o.order_status?.toUpperCase();
        return status === 'ON_HOLD' || status === 'PARTIALLY_SHIPPING';
    }).length;
    // Match Kanban groupings
    const awaitingShipmentStatusCount = dateFilteredOrders.filter(o => {
        const status = o.order_status?.toUpperCase();
        return status === 'AWAITING_SHIPMENT' || status === 'AWAITING_COLLECTION';
    }).length;
    const inTransitStatusCount = dateFilteredOrders.filter(o => {
        const status = o.order_status?.toUpperCase();
        return status === 'SHIPPED' || status === 'IN_TRANSIT';
    }).length;
    const deliveredStatusCount = dateFilteredOrders.filter(o => o.order_status?.toUpperCase() === 'DELIVERED').length;
    const completedStatusCount = dateFilteredOrders.filter(o => o.order_status?.toUpperCase() === 'COMPLETED').length;

    // Reset page when filters change
    if (currentPage > 1 && filteredOrders.length < (currentPage - 1) * itemsPerPage) {
        setCurrentPage(1);
    }

    const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
    const paginatedOrders = filteredOrders.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-white">Orders</h2>
                    <p className="text-gray-400">Manage and track your shop orders</p>
                </div>
                <div className="flex items-center gap-3">
                    <DateRangePicker value={dateRange} onChange={setDateRange} />
                    <ViewToggle
                        currentView={effectiveViewMode}
                        onViewChange={setViewMode}
                        showKanban={true}
                    />
                    <button
                        onClick={handleSync}
                        disabled={cacheMetadata.isSyncing || isLoading}
                        className="flex items-center space-x-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={20} className={cacheMetadata.isSyncing ? "animate-spin" : ""} />
                        <span className="hidden sm:inline">{cacheMetadata.isSyncing ? 'Syncing...' : 'Sync'}</span>
                    </button>
                </div>
            </div>

            {/* Comparison Charts (Collapsible) */}
            <div className="space-y-2">
                <button
                    onClick={() => setShowCharts(!showCharts)}
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
                >
                    <BarChart3 size={16} />
                    <span>Performance Charts</span>
                    {showCharts ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {showCharts && (
                    <ComparisonCharts
                        orders={orders}
                        startDate={dateRange.startDate}
                        endDate={dateRange.endDate}
                        timezone={timezone}
                        includeCancelledInTotal={includeCancelledInTotal}
                        includeCancelledFinancials={includeCancelledFinancials}
                    />
                )}
            </div>

            {/* Stats Bar - Row 1 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${fulfillmentFilter === 'all' && statusFilter === 'all'
                        ? 'bg-pink-500/20 border-pink-500'
                        : 'bg-gray-800/50 border-gray-700 hover:border-pink-500/50'
                        }`}
                    onClick={() => { setFulfillmentFilter('all'); setStatusFilter('all'); }}
                >
                    <div className="flex items-center gap-1">
                        <p className="text-sm text-gray-400">Total Orders</p>
                        <CalculationTooltip
                            source="TikTok Shop"
                            calculation="Count(orders) - Excludes Sample Orders"
                            api="GET /orders/search"
                        />
                    </div>
                    <p className={`text-2xl font-bold ${fulfillmentFilter === 'all' && statusFilter === 'all' ? 'text-pink-400' : 'text-white'}`}>
                        {totalOrdersCount.toLocaleString()}
                    </p>
                </div>
                <div
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${fulfillmentFilter === 'fbt'
                        ? 'bg-cyan-500/20 border-cyan-500'
                        : 'bg-gray-800/50 border-gray-700 hover:border-cyan-500/50'
                        }`}
                    onClick={() => setFulfillmentFilter(fulfillmentFilter === 'fbt' ? 'all' : 'fbt')}
                >
                    <div className="flex items-center gap-2">
                        <Box size={16} className="text-cyan-400" />
                        <p className="text-sm text-gray-400">FBT Orders</p>
                        <CalculationTooltip
                            source="TikTok Shop"
                            calculation="is_fbt=true OR fulfillment_type=FBT"
                            api="GET /orders/search"
                        />
                    </div>
                    <p className={`text-2xl font-bold ${fulfillmentFilter === 'fbt' ? 'text-cyan-400' : 'text-white'}`}>
                        {fbtOrdersCount.toLocaleString()}
                    </p>
                </div>
                <div
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${fulfillmentFilter === 'seller'
                        ? 'bg-purple-500/20 border-purple-500'
                        : 'bg-gray-800/50 border-gray-700 hover:border-purple-500/50'
                        }`}
                    onClick={() => setFulfillmentFilter(fulfillmentFilter === 'seller' ? 'all' : 'seller')}
                >
                    <div className="flex items-center gap-2">
                        <Truck size={16} className="text-purple-400" />
                        <p className="text-sm text-gray-400">Seller Fulfilled</p>
                        <CalculationTooltip
                            source="TikTok Shop"
                            calculation="is_fbt=false"
                            api="GET /orders/search"
                        />
                    </div>
                    <p className={`text-2xl font-bold ${fulfillmentFilter === 'seller' ? 'text-purple-400' : 'text-white'}`}>
                        {sellerOrdersCount.toLocaleString()}
                    </p>
                </div>

                {/* Total Customers Card */}
                <div className="p-4 rounded-xl border bg-gray-800/50 border-gray-700">
                    <div className="flex items-center gap-2">
                        <Users size={16} className="text-pink-400" />
                        <p className="text-sm text-gray-400">Total Customers</p>
                    </div>
                    <p className="text-2xl font-bold text-white">{totalCustomers.toLocaleString()}</p>
                </div>
            </div>

            {/* Payment Status Filter Row (NEW) */}
            <div className="grid grid-cols-3 gap-4">
                <div
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${paymentFilter === 'paid'
                        ? 'bg-green-500/20 border-green-500'
                        : 'bg-gray-800/50 border-gray-700 hover:border-green-500/50'
                        }`}
                    onClick={() => setPaymentFilter(paymentFilter === 'paid' ? 'all' : 'paid')}
                >
                    <div className="flex items-center gap-2">
                        <BadgeCheck size={16} className="text-green-400" />
                        <p className="text-sm text-gray-400">Paid Orders</p>
                        <CalculationTooltip
                            source="TikTok Shop"
                            calculation="paid_time IS NOT NULL"
                            api="GET /orders/search"
                        />
                    </div>
                    <p className={`text-2xl font-bold ${paymentFilter === 'paid' ? 'text-green-400' : 'text-white'}`}>
                        {paidOrdersCount.toLocaleString()}
                    </p>
                </div>
                <div
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${paymentFilter === 'unpaid'
                        ? 'bg-red-500/20 border-red-500'
                        : 'bg-gray-800/50 border-gray-700 hover:border-red-500/50'
                        }`}
                    onClick={() => setPaymentFilter(paymentFilter === 'unpaid' ? 'all' : 'unpaid')}
                >
                    <div className="flex items-center gap-2">
                        <XCircle size={16} className="text-red-400" />
                        <p className="text-sm text-gray-400">Unpaid Orders</p>
                        <CalculationTooltip
                            source="TikTok Shop"
                            calculation="paid_time IS NULL"
                            api="GET /orders/search"
                        />
                    </div>
                    <p className={`text-2xl font-bold ${paymentFilter === 'unpaid' ? 'text-red-400' : 'text-white'}`}>
                        {unpaidOrdersCount.toLocaleString()}
                    </p>
                </div>
                <div
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${paymentFilter === 'all'
                        ? 'bg-blue-500/20 border-blue-500'
                        : 'bg-gray-800/50 border-gray-700 hover:border-blue-500/50'
                        }`}
                    onClick={() => setPaymentFilter('all')}
                >
                    <div className="flex items-center gap-2">
                        <Filter size={16} className="text-blue-400" />
                        <p className="text-sm text-gray-400">All Orders</p>
                    </div>
                    <p className={`text-2xl font-bold ${paymentFilter === 'all' ? 'text-blue-400' : 'text-white'}`}>
                        {dateFilteredOrders.length.toLocaleString()}
                    </p>
                </div>
            </div>


            {/* Stats Bar - Row 2 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${statusFilter === 'ON_HOLD'
                        ? 'bg-orange-500/20 border-orange-500'
                        : 'bg-gray-800/50 border-gray-700 hover:border-orange-500/50'
                        }`}
                    onClick={() => setStatusFilter(statusFilter === 'ON_HOLD' ? 'all' : 'ON_HOLD')}
                >
                    <div className="flex items-center gap-1">
                        <p className="text-sm text-gray-400">On Hold</p>
                        <CalculationTooltip
                            source="TikTok Shop"
                            calculation="status=ON_HOLD or PARTIALLY_SHIPPING"
                            api="GET /orders/search"
                        />
                    </div>
                    <p className={`text-2xl font-bold ${statusFilter === 'ON_HOLD' ? 'text-orange-400' : onHoldCount > 0 ? 'text-orange-400' : 'text-white'}`}>
                        {onHoldCount.toLocaleString()}
                    </p>
                    {onHoldCount > 0 && statusFilter !== 'ON_HOLD' && (
                        <p className="text-xs text-orange-400 mt-1">Needs attention</p>
                    )}
                </div>



                {/* Sample Orders Card */}
                <div
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${statusFilter === 'SAMPLE'
                        ? 'bg-purple-500/20 border-purple-500'
                        : 'bg-gray-800/50 border-gray-700 hover:border-purple-500/50'
                        }`}
                    onClick={() => { setFulfillmentFilter('all'); setStatusFilter('SAMPLE'); }}
                >
                    <div className="flex items-center gap-2">
                        <Box size={16} className="text-purple-400" />
                        <p className="text-sm text-gray-400">Sample Orders</p>
                        <CalculationTooltip
                            source="TikTok Shop"
                            calculation="is_sample_order=true"
                            api="GET /orders/search"
                        />
                    </div>
                    <p className={`text-2xl font-bold ${statusFilter === 'SAMPLE' ? 'text-purple-400' : 'text-white'}`}>
                        {sampleOrdersCount}
                    </p>
                </div>

                {/* Cancelled/Refunded Orders Card */}
                <div
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${statusFilter === 'CANCELLED_REFUNDED'
                        ? 'bg-red-500/20 border-red-500'
                        : 'bg-gray-800/50 border-gray-700 hover:border-red-500/50'
                        }`}
                    onClick={() => { setFulfillmentFilter('all'); setStatusFilter('CANCELLED_REFUNDED'); }}
                >
                    <div className="flex items-center gap-2">
                        <XCircle size={16} className="text-red-400" />
                        <p className="text-sm text-gray-400">Cancelled/Refunded</p>
                        <CalculationTooltip
                            source="TikTok Shop"
                            calculation="CANCELLED status, cancel_reason, or cancellation_initiator"
                            api="GET /orders/search"
                        />
                    </div>
                    <p className={`text-2xl font-bold ${statusFilter === 'CANCELLED_REFUNDED' ? 'text-red-400' : 'text-white'}`}>
                        {cancelledRefundedCount}
                    </p>
                </div>
            </div>

            {/* Status Investigation Section */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
                    <BarChart3 size={16} />
                    Status Breakdown (for date range selected above)
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                    <div className="p-3 rounded-lg bg-gray-800/50 border border-red-700/50">
                        <p className="text-xs text-gray-400">UNPAID</p>
                        <p className="text-xl font-bold text-red-400">{unpaidStatusCount.toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-800/50 border border-yellow-700/50">
                        <p className="text-xs text-gray-400">ON_HOLD</p>
                        <p className="text-xl font-bold text-yellow-400">{onHoldStatusCount.toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-800/50 border border-blue-700/50">
                        <p className="text-xs text-gray-400">AWAITING_SHIPMENT</p>
                        <p className="text-xl font-bold text-blue-400">{awaitingShipmentStatusCount.toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-800/50 border border-purple-700/50">
                        <p className="text-xs text-gray-400">IN_TRANSIT</p>
                        <p className="text-xl font-bold text-purple-400">{inTransitStatusCount.toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-800/50 border border-cyan-700/50">
                        <p className="text-xs text-gray-400">DELIVERED</p>
                        <p className="text-xl font-bold text-cyan-400">{deliveredStatusCount.toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-800/50 border border-green-700/50">
                        <p className="text-xs text-gray-400">COMPLETED</p>
                        <p className="text-xl font-bold text-green-400">{completedStatusCount.toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-800/50 border border-orange-700/50">
                        <p className="text-xs text-gray-400">CANCELLED</p>
                        <p className="text-xl font-bold text-orange-400">{cancelledStatusCount.toLocaleString()}</p>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search by Order ID or Product..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 text-white pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:border-pink-500"
                    />
                </div>
                <div className="flex gap-4">
                    {/* Status Filter */}
                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-gray-900 border border-gray-700 text-white pl-10 pr-8 py-2 rounded-lg focus:outline-none focus:border-pink-500 appearance-none cursor-pointer"
                        >
                            <option value="all">All Status</option>
                            <option value="UNPAID">Unpaid</option>
                            <option value="ON_HOLD">On Hold</option>
                            <option value="AWAITING_SHIPMENT">Awaiting Shipment</option>
                            <option value="AWAITING_COLLECTION">Awaiting Collection</option>
                            <option value="IN_TRANSIT">In Transit</option>
                            <option value="SHIPPED">Shipped</option>
                            <option value="DELIVERED">Delivered</option>
                            <option value="COMPLETED">Completed</option>
                            <option value="CANCELLED">Cancelled</option>
                        </select>
                    </div>

                    {/* Fulfillment Filter */}
                    <div className="relative">
                        <Box className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <select
                            value={fulfillmentFilter}
                            onChange={(e) => setFulfillmentFilter(e.target.value)}
                            className="bg-gray-900 border border-gray-700 text-white pl-10 pr-8 py-2 rounded-lg focus:outline-none focus:border-pink-500 appearance-none cursor-pointer"
                        >
                            <option value="all">All Fulfillment</option>
                            <option value="fbt">FBT (TikTok)</option>
                            <option value="seller">Seller Fulfilled</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Active Filter Badges */}
            {
                (fulfillmentFilter !== 'all' || statusFilter !== 'all') && (
                    <div className="flex flex-wrap items-center gap-2">
                        {statusFilter !== 'all' && (
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusFilter === 'ON_HOLD'
                                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                                : 'bg-gray-700 text-gray-300 border border-gray-600'
                                }`}>
                                Status: {statusFilter.replace(/_/g, ' ')}
                                {isOnHoldFilter && (
                                    <span className="ml-2 text-xs opacity-75">(List view)</span>
                                )}
                            </span>
                        )}
                        {fulfillmentFilter !== 'all' && (
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${fulfillmentFilter === 'fbt'
                                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                                : 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                }`}>
                                {fulfillmentFilter === 'fbt' ? 'FBT Orders Only' : 'Seller Fulfilled Only'}
                            </span>
                        )}
                        <button
                            onClick={() => { setFulfillmentFilter('all'); setStatusFilter('all'); }}
                            className="text-gray-400 hover:text-white text-sm"
                        >
                            Clear all filters
                        </button>
                    </div>
                )
            }

            {/* Orders Display */}
            {
                isLoading && orders.length === 0 ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
                    </div>
                ) : filteredOrders.length > 0 ? (
                    <>
                        {/* Kanban View */}
                        {effectiveViewMode === 'kanban' && (
                            <OrderKanbanBoard
                                orders={filteredOrders}
                                onOrderClick={setSelectedOrder}
                            />
                        )}

                        {/* List View */}
                        {effectiveViewMode === 'list' && (
                            <div className="bg-gray-800/30 rounded-xl border border-gray-700 overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead className="bg-gray-900/50">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Order</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Customer</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Products</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Fulfillment</th>
                                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {paginatedOrders.map((order) => (
                                                <OrderListRow
                                                    key={order.order_id}
                                                    order={order}
                                                    onClick={() => setSelectedOrder(order)}
                                                />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Cards View */}
                        {effectiveViewMode === 'cards' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {paginatedOrders.map((order) => (
                                    <OrderCard
                                        key={order.order_id}
                                        order={order}
                                        onClick={() => setSelectedOrder(order)}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Pagination Controls (not shown for Kanban) */}
                        {effectiveViewMode !== 'kanban' && totalPages > 1 && (
                            <div className="flex justify-center items-center space-x-4 mt-8">
                                <button
                                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                    disabled={currentPage === 1}
                                    className="px-4 py-2 bg-gray-800 text-white rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors"
                                >
                                    Previous
                                </button>
                                <span className="text-gray-400">
                                    Page {currentPage} of {totalPages} ({filteredOrders.length} orders)
                                </span>
                                <button
                                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                    disabled={currentPage === totalPages}
                                    className="px-4 py-2 bg-gray-800 text-white rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors"
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-center py-12 bg-gray-800/30 rounded-xl border border-gray-700 border-dashed">
                        <p className="text-gray-400 text-lg">
                            {fulfillmentFilter === 'fbt'
                                ? 'No FBT orders found. Only orders fulfilled by TikTok will appear here.'
                                : fulfillmentFilter === 'seller'
                                    ? 'No seller-fulfilled orders found matching your criteria.'
                                    : statusFilter === 'ON_HOLD'
                                        ? 'No orders on hold. Great job!'
                                        : 'No orders found matching your criteria'
                            }
                        </p>
                    </div>
                )
            }


            {/* Order Details Modal */}
            {
                selectedOrder && (
                    <OrderDetails
                        order={selectedOrder}
                        onClose={() => setSelectedOrder(null)}
                    />
                )
            }
        </div >
    );
}
