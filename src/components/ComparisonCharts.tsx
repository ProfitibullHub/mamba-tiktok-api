import React, { useMemo, useState } from 'react';
import {
    TrendingUp, TrendingDown, Minus, ChevronDown,
    DollarSign, ShoppingCart, Package, Info,
    LineChart as LineChartIcon, BarChart2, PieChart as PieChartIcon
} from 'lucide-react';
import { CalculationTooltip } from './CalculationTooltip';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';
import { Order } from '../store/useShopStore';
import { getShopDayStartTimestamp, formatShopDate, formatShopDateISO } from '../utils/dateUtils';
import { calculateOrderGMV } from '../utils/gmvCalculations';

// Use paid_time for filtering/bucketing (matches backend which loads by paid_time)
// Falls back to created_time for orders without paid_time
const getOrderTs = (o: Order): number => Number(o.paid_time || o.created_time);

// Helper function to detect cancelled or refunded orders
const isCancelledOrRefunded = (order: Order): boolean => {
    return (
        order.order_status === 'CANCELLED' ||
        !!order.cancel_reason ||
        !!order.cancellation_initiator
    );
};


interface ComparisonChartsProps {
    orders: Order[];
    startDate?: string; // Optional: YYYY-MM-DD format
    endDate?: string;   // Optional: YYYY-MM-DD format
    timezone?: string;  // Shop timezone for date calculations
    includeCancelledInTotal?: boolean;
    includeCancelledFinancials?: boolean;
}

type MetricType = 'gmv' | 'orders' | 'avgOrder';
type ChartType = 'line' | 'bar' | 'pie';

interface DailyData {
    date: string;
    dayLabel: string;
    previousDateLabel: string;
    current: number;
    previous: number;
}

export function ComparisonCharts({
    orders,
    startDate = '',
    endDate = '',
    timezone = 'America/Los_Angeles',
    includeCancelledInTotal = false,
    includeCancelledFinancials = false
}: ComparisonChartsProps) {
    const [selectedMetric, setSelectedMetric] = useState<MetricType>('orders');
    // Removed timeRange state - strictly controlled by props now
    const [chartType, setChartType] = useState<ChartType>('line');
    const [showDropdown, setShowDropdown] = useState(false);


    // Loading state for historical data fetch
    // const [loadingPrevious, setLoadingPrevious] = useState(false); // Removed unused state

    const metrics: { id: MetricType; label: string; icon: React.ReactNode }[] = [
        { id: 'gmv', label: 'GMV', icon: <DollarSign size={16} /> },
        { id: 'orders', label: 'Orders', icon: <ShoppingCart size={16} /> },
        { id: 'avgOrder', label: 'Avg Order Value', icon: <Package size={16} /> }
    ];

    // Determine the comparison window based on props
    const daysToCompare = useMemo(() => {
        const start = getShopDayStartTimestamp(startDate, timezone);
        const end = getShopDayStartTimestamp(endDate, timezone);
        // Add 1 day (86400) because ranges are inclusive (Jan 1 to Jan 1 is 1 day, not 0)
        // end timestamp from getShopDayStartTimestamp is the START of that day.
        // so difference in days is (end - start) / 86400 + 1
        const days = Math.round((end - start) / 86400) + 1;
        return Math.max(1, days);
    }, [startDate, endDate, timezone]);

    // Use endDate prop directly as reference
    const referenceEndDate = endDate;

    // Compute previous period date range for 30D fetch
    const previousPeriodRange = useMemo(() => {
        // Use Shop Timezone for accurate previous period calculation
        // Calculate timestamps first
        // Add 86400 to include the full end day (make it exclusive upper bound)
        const refEndTs = getShopDayStartTimestamp(referenceEndDate, timezone) + 86400;
        const currentStartTs = refEndTs - (daysToCompare * 86400); // Start of current period
        const prevEndTs = currentStartTs; // End of previous period (exclusive)
        const prevStartTs = prevEndTs - (daysToCompare * 86400); // Start of previous period

        // Convert back to YYYY-MM-DD strings for API
        // Use formatShopDateISO which returns YYYY-MM-DD format required by backend

        // Safety: ensure positive timestamps
        const safePrevStart = Math.max(0, prevStartTs);
        const safePrevEnd = Math.max(0, prevEndTs);

        // For API, endDate is usually exclusive, but let's check strict YYYY-MM-DD
        // The API filters as >= startDate AND < endDate (or <= if inclusive)
        // Let's use the explicit dates derived from timestamps

        return {
            startDate: formatShopDateISO(safePrevStart * 1000, timezone),
            // Subtract 1 second to get the actual last day of previous period for display/logic if needed,
            // but for API "endDate" is usually up to that date.
            // Let's stick to the boundary timestamp strategy.
            endDate: formatShopDateISO(safePrevEnd * 1000, timezone),

            // Helpful timestamps for logic
            startTs: safePrevStart,
            endTs: safePrevEnd
        };
    }, [referenceEndDate, daysToCompare, timezone]);

    // Check if the loaded orders cover the previous period
    const needsFetch = useMemo(() => {
        // SYSTEMATIC CHECK: Verify we have data coverage for the entire previous period
        // We need orders going back to at least the start of the previous period

        // Check 1: Do we have ANY orders?
        if (orders.length === 0) return false;

        // Check 2: Find the oldest order we have
        const oldestOrderTs = Math.min(...orders.map(o => getOrderTs(o)));

        // Check 3: Does our oldest order go back far enough to cover the previous period?
        const { startTs } = previousPeriodRange;
        const needsOlderData = oldestOrderTs > startTs + 86400; // Allow 1 day tolerance

        if (needsOlderData) {
            // Just warn in console, don't fetch
            return true;
        }

        return false;
    }, [orders, previousPeriodRange]);


    // Calculate comparison data
    // Note: orders prop now includes merged historical data from store
    const chartData = useMemo(() => {
        // Precise Timezone-based Bucketing

        // 1. Determine End Timestamp
        // For daily data generation, we need to work with full day boundaries
        // to ensure each day in the chart represents a complete calendar day
        const now = Math.floor(Date.now() / 1000);
        const refDayStart = getShopDayStartTimestamp(referenceEndDate, timezone);
        const refDayEnd = refDayStart + 86400;

        // Use current time if we're viewing today's data, otherwise use end of day
        const currentEndTs = (now >= refDayStart && now < refDayEnd) ? now : refDayEnd;

        // 2. Determine Intervals
        // CRITICAL: Calculate currentStartTs from the START of the reference day,
        // not from the current timestamp, to ensure we get full calendar days
        const currentStartTs = refDayStart - ((daysToCompare - 1) * 86400);
        const previousEndTs = currentStartTs;
        const previousStartTs = previousEndTs - (daysToCompare * 86400);

        // Filter orders (excluding ONLY sample orders here - cancellation logic applied later)
        const baseValidOrder = (o: Order) => o.is_sample_order !== true;

        const currentOrders = orders.filter(o => {
            const ts = getOrderTs(o);
            return ts >= currentStartTs && ts < currentEndTs && baseValidOrder(o);
        });
        const previousOrders = orders.filter(o => {
            const ts = getOrderTs(o);
            return ts >= previousStartTs && ts < previousEndTs && baseValidOrder(o);
        });



        // Helper to decide if an order should be included based on metric & toggle
        const shouldIncludeOrder = (o: Order) => {
            const isCancelled = isCancelledOrRefunded(o);
            if (!isCancelled) return true;

            if (selectedMetric === 'orders') return includeCancelledInTotal;
            if (selectedMetric === 'gmv' || selectedMetric === 'avgOrder') return includeCancelledFinancials;
            return false;
        };

        const currentOrdersFiltered = currentOrders.filter(shouldIncludeOrder);
        const previousOrdersFiltered = previousOrders.filter(shouldIncludeOrder);

        // Totals
        const currentGMV = currentOrdersFiltered.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
        const previousGMV = previousOrdersFiltered.reduce((sum, o) => sum + calculateOrderGMV(o), 0);

        const currentOrderCount = currentOrdersFiltered.length;
        const previousOrderCount = previousOrdersFiltered.length;

        const currentAvgOrder = currentOrderCount > 0 ? currentGMV / currentOrderCount : 0;
        const previousAvgOrder = previousOrderCount > 0 ? previousGMV / previousOrderCount : 0;

        // Helper to format dates for display (using shop timezone)
        const formatDateLabel = (ts: number) => {
            // formatShopDate returns MM/DD/YYYY, we can simplify for chart to MMM D
            // But let's reuse formatShopDate first to be safe
            const fullDate = formatShopDate(ts * 1000, timezone);
            const d = new Date(fullDate);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        };

        // Daily Data Generation
        const dailyData: DailyData[] = [];



        // We iterate day by day
        for (let i = 0; i < daysToCompare; i++) {
            // Day Start Timestamps
            const currentDayStart = currentStartTs + (i * 86400);
            const currentDayEnd = currentDayStart + 86400; // exclusive upper bound

            const previousDayStart = previousStartTs + (i * 86400);
            const previousDayEnd = previousDayStart + 86400; // exclusive upper bound

            // Filter by day AND by cancellation logic
            const currentDayOrders = currentOrders.filter(o => {
                const ts = getOrderTs(o);
                return ts >= currentDayStart && ts < currentDayEnd && shouldIncludeOrder(o);
            });

            const previousDayOrders = previousOrders.filter(o => {
                const ts = getOrderTs(o);
                return ts >= previousDayStart && ts < previousDayEnd && shouldIncludeOrder(o);
            });

            let currentValue = 0;
            let previousValue = 0;

            switch (selectedMetric) {
                case 'gmv':
                    currentValue = currentDayOrders.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
                    previousValue = previousDayOrders.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
                    break;
                case 'orders':
                    currentValue = currentDayOrders.length;
                    previousValue = previousDayOrders.length;
                    break;
                case 'avgOrder':
                    const cGMV = currentDayOrders.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
                    const pGMV = previousDayOrders.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
                    currentValue = currentDayOrders.length > 0 ? cGMV / currentDayOrders.length : 0;
                    previousValue = previousDayOrders.length > 0 ? pGMV / previousDayOrders.length : 0;
                    break;
            }

            const dayLabel = formatDateLabel(currentDayStart);


            dailyData.push({
                date: formatShopDate(currentDayStart * 1000, timezone), // Strict date string
                dayLabel,
                previousDateLabel: formatDateLabel(previousDayStart),
                current: Number(currentValue.toFixed(2)),
                previous: Number(previousValue.toFixed(2))
            });
        }

        // Pie Data
        const pieDataRaw: Record<string, number> = {};
        // For pie data, strict filtering based on 'shouldIncludeOrder' also makes sense?
        // Actually, if I select 'orders' and 'includeCancelled', I want to see them in pie.
        // If I select 'orders' and NOT 'includeCancelled', I DON'T want to see them.
        currentOrdersFiltered.forEach(o => {
            const key = o.order_status?.replace(/_/g, ' ') || 'Unknown';
            let value = 0;
            if (selectedMetric === 'gmv') {
                value = calculateOrderGMV(o);
            } else {
                value = 1;
            }
            pieDataRaw[key] = (pieDataRaw[key] || 0) + value;
        });

        const pieData = Object.entries(pieDataRaw)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);

        // Helper to determine if a range label should be Today or Yesterday
        const getSmartLabel = (startTs: number, endTs: number) => {
            const labelStart = formatDateLabel(startTs);
            const labelEnd = formatDateLabel(endTs);
            const rangeLabel = startTs === endTs ? labelStart : `${labelStart} - ${labelEnd}`;

            // Check against Today/Yesterday
            const todayTs = Date.now() / 1000; // approximation
            const labelToday = formatDateLabel(todayTs);
            const labelYesterday = formatDateLabel(todayTs - 86400);

            if (rangeLabel === labelToday) return "Today";
            if (rangeLabel === labelYesterday) return "Yesterday";
            return rangeLabel;
        };

        return {
            current: {
                gmv: currentGMV,
                orders: currentOrderCount,
                avgOrder: currentAvgOrder
            },
            previous: {
                gmv: previousGMV,
                orders: previousOrderCount,
                avgOrder: previousAvgOrder
            },
            dailyData,
            pieData,
            periodLabel: {
                current: getSmartLabel(currentStartTs, refDayStart),
                previous: getSmartLabel(previousStartTs, previousEndTs - 86400)
            }
        };
    }, [orders, selectedMetric, daysToCompare, referenceEndDate, timezone, includeCancelledInTotal, includeCancelledFinancials]);

    // Format helpers
    const formatValue = (value: number) => {
        if (selectedMetric === 'orders') return Math.round(value).toLocaleString();
        return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `;
    };

    const getPercentChange = (current: number, previous: number) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return ((current - previous) / previous) * 100;
    };

    const currentValue = chartData.current[selectedMetric];
    const previousValue = chartData.previous[selectedMetric];
    const percentChange = getPercentChange(currentValue, previousValue);

    // Insight generator
    const getInsight = () => {
        const trend = percentChange > 0 ? 'increase' : 'decrease';
        const absChange = Math.abs(percentChange).toFixed(2);
        const metricName = metrics.find(m => m.id === selectedMetric)?.label.toLowerCase();

        if (chartType === 'pie') return `Distribution of ${metricName} across different statuses for the current period.`;
        if (percentChange === 0) return `Your ${metricName} is stable compared to the previous period.`;
        return `Your ${metricName} shows a ${absChange}% ${trend} compared to the preceding ${daysToCompare} days(${chartData.periodLabel.previous}).`;
    };

    // Chart Colors
    const COLORS = ['#EC4899', '#06B6D4', '#A855F7', '#EAB308', '#22C55E', '#EF4444'];

    // Custom Tooltip
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            if (chartType === 'pie') {
                return (
                    <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-xl z-50">
                        <p className="text-gray-300 text-sm mb-1">{payload[0].name}</p>
                        <p className="text-white font-medium">{formatValue(payload[0].value)}</p>
                    </div>
                );
            }

            return (
                <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-xl z-50">
                    <p className="text-gray-300 text-sm mb-2 font-semibold">
                        {label} <span className="text-gray-500 font-normal">vs</span> {payload[0]?.payload?.previousDateLabel}
                    </p>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex items-center gap-2 text-sm justify-between min-w-[180px]">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                <span className={entry.dataKey === 'current' ? 'text-white' : 'text-gray-400'}>
                                    {entry.name === 'Current Period' ? 'Current' :
                                        entry.name === 'Previous Period' ? 'Previous' :
                                            entry.name}
                                </span>
                            </div>
                            <span className="text-white font-medium">
                                {formatValue(entry.value)}
                            </span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6 animate-fade-in">
            {/* Header Controls */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
                <div>
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        {chartType === 'line' ? <LineChartIcon className="text-pink-500" size={20} /> :
                            chartType === 'bar' ? <BarChart2 className="text-cyan-500" size={20} /> :
                                <PieChartIcon className="text-purple-500" size={20} />}
                        Performance {chartType === 'pie' ? 'Breakdown' : 'Comparison'}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                        <p className="text-sm text-gray-400">
                            {chartType === 'pie'
                                ? `${chartData.periodLabel.current} `
                                : `${chartData.periodLabel.current} vs ${chartData.periodLabel.previous} `
                            }
                        </p>
                        <div className="group relative">
                            <Info size={14} className="text-gray-500 cursor-help" />
                            <div className="absolute left-0 bottom-full mb-2 w-64 bg-gray-900 border border-gray-700 p-3 rounded-lg text-xs text-gray-300 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                Compares the last {daysToCompare} days with the preceding {daysToCompare} days.
                                {needsFetch && ' Historical data might be incomplete.'}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Chart Type Toggle */}
                    <div className="bg-gray-700 p-1 rounded-lg flex">
                        <button
                            onClick={() => setChartType('line')}
                            className={`p-2 rounded transition-colors ${chartType === 'line' ? 'bg-gray-600 text-pink-400' : 'text-gray-400 hover:text-white'}`}
                            title="Line Chart"
                        >
                            <LineChartIcon size={16} />
                        </button>
                        <button
                            onClick={() => setChartType('bar')}
                            className={`p-2 rounded transition-colors ${chartType === 'bar' ? 'bg-gray-600 text-cyan-400' : 'text-gray-400 hover:text-white'}`}
                            title="Bar Chart"
                        >
                            <BarChart2 size={16} />
                        </button>
                        <button
                            onClick={() => setChartType('pie')}
                            className={`p-2 rounded transition-colors ${chartType === 'pie' ? 'bg-gray-600 text-purple-400' : 'text-gray-400 hover:text-white'}`}
                            title="Pie Chart"
                        >
                            <PieChartIcon size={16} />
                        </button>
                    </div>

                    <div className="h-6 w-px bg-gray-700 mx-1 hidden sm:block"></div>

                    {/* Metric Selector */}
                    <div className="relative z-20">
                        <button
                            onClick={() => setShowDropdown(!showDropdown)}
                            className="flex items-center gap-2 px-3 py-2 bg-gray-700 rounded-lg text-sm text-white hover:bg-gray-600 transition-colors min-w-[140px]"
                        >
                            {metrics.find(m => m.id === selectedMetric)?.icon}
                            <span>{metrics.find(m => m.id === selectedMetric)?.label}</span>
                            <ChevronDown size={14} className="ml-auto" />
                        </button>

                        {showDropdown && (
                            <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200 z-50">
                                {metrics.map(metric => (
                                    <button
                                        key={metric.id}
                                        onClick={() => {
                                            setSelectedMetric(metric.id);
                                            setShowDropdown(false);
                                        }}
                                        className={`w-full flex items-center gap-2 px-4 py-3 text-sm text-left transition-colors ${selectedMetric === metric.id
                                            ? 'bg-pink-500/10 text-pink-400 border-l-2 border-pink-500'
                                            : 'text-gray-300 hover:bg-gray-700'
                                            }`}
                                    >
                                        {metric.icon}
                                        {metric.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Summary Stats Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 relative z-10">
                <div className="bg-gray-900/40 rounded-lg p-4 border border-gray-700/50 relative group">
                    <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-lg pointer-events-none" />
                    <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs text-gray-400 font-medium">Current Period</p>
                        <CalculationTooltip
                            source="Orders / Statements"
                            calculation={`Sum of ${selectedMetric} for last ${daysToCompare} days`}
                            api="GET /orders/search or GET /finance/statements"
                        />
                    </div>
                    <p className="text-2xl font-bold text-white tracking-tight">
                        {formatValue(currentValue)}
                    </p>
                </div>

                <div className="bg-gray-900/40 rounded-lg p-4 border border-gray-700/50 group">
                    <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs text-gray-500 font-medium">Previous Period</p>
                        <CalculationTooltip
                            source="Orders / Statements"
                            calculation={`Sum of ${selectedMetric} for preceding ${daysToCompare} days`}
                            api="GET /orders/search or GET /finance/statements"
                        />
                    </div>
                    <p className="text-2xl font-bold text-gray-400 tracking-tight">
                        {formatValue(previousValue)}
                    </p>
                </div>

                <div className="bg-gray-900/40 rounded-lg p-4 border border-gray-700/50 flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-1 mb-1">
                            <p className="text-xs text-gray-500 font-medium">Growth</p>
                            <CalculationTooltip
                                source="Calculated"
                                calculation="(Current - Previous) / Previous * 100"
                                api="Calculated"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            {percentChange > 0 ? (
                                <TrendingUp className="text-green-400" size={20} />
                            ) : percentChange < 0 ? (
                                <TrendingDown className="text-red-400" size={20} />
                            ) : (
                                <Minus className="text-gray-400" size={20} />
                            )}
                            <span className={`text - xl font - bold ${percentChange > 0 ? 'text-green-400' : percentChange < 0 ? 'text-red-400' : 'text-gray-400'} `}>
                                {Math.abs(percentChange).toFixed(2)}%
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Contextual Insight */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-6 flex items-start gap-3">
                <Info size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-blue-200">
                    {getInsight()}
                </p>
            </div>

            {/* Chart Area */}
            <div className="h-[300px] w-full" key={chartType}>
                <ResponsiveContainer width="100%" height="100%">
                    {chartType === 'line' ? (
                        <AreaChart data={chartData.dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#EC4899" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#EC4899" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorPrevious" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#9CA3AF" stopOpacity={0.1} />
                                    <stop offset="95%" stopColor="#9CA3AF" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                            <XAxis
                                dataKey="dayLabel"
                                tick={{ fill: '#9CA3AF', fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                minTickGap={30}
                            />
                            <YAxis
                                tick={{ fill: '#9CA3AF', fontSize: 12 }}
                                tickFormatter={(val) => selectedMetric === 'gmv' ? `$${val} ` : val}
                                axisLine={false}
                                tickLine={false}
                                width={60}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                            <Area
                                type="linear"
                                dataKey="previous"
                                name="Previous Period"
                                stroke="#9CA3AF"
                                strokeDasharray="5 5"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorPrevious)"
                                dot={{ fill: '#9CA3AF', strokeWidth: 0, r: 3 }}
                                activeDot={{ r: 5 }}
                                isAnimationActive={false}
                            />
                            <Area
                                type="linear"
                                dataKey="current"
                                name="Current Period"
                                stroke="#EC4899"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorCurrent)"
                                dot={{ fill: '#EC4899', strokeWidth: 0, r: 4 }}
                                activeDot={{ r: 6 }}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    ) : chartType === 'bar' ? (
                        <BarChart data={chartData.dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                            <XAxis
                                dataKey="dayLabel"
                                tick={{ fill: '#9CA3AF', fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <YAxis
                                tick={{ fill: '#9CA3AF', fontSize: 12 }}
                                tickFormatter={(val) => selectedMetric === 'gmv' ? `$${val} ` : val}
                                axisLine={false}
                                tickLine={false}
                                width={60}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#374151', opacity: 0.4 }} />
                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                            <Bar
                                dataKey="previous"
                                name="Previous Period"
                                fill="#4B5563"
                                radius={[4, 4, 0, 0]}
                                opacity={0.5}
                                isAnimationActive={false}
                            />
                            <Bar
                                dataKey="current"
                                name="Current Period"
                                fill="#06B6D4"
                                radius={[4, 4, 0, 0]}
                                isAnimationActive={false}
                            />
                        </BarChart>
                    ) : (
                        <PieChart>
                            <Pie
                                data={chartData.pieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                                isAnimationActive={false}
                            >
                                {chartData.pieData.map((_, index) => (
                                    <Cell key={`cell - ${index} `} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                            <Legend
                                layout="vertical"
                                verticalAlign="middle"
                                align="right"
                                formatter={(value) => (
                                    <span className="text-gray-300 text-sm ml-2">{value}</span>
                                )}
                            />
                        </PieChart>
                    )}
                </ResponsiveContainer>
            </div>
            {chartData.pieData.length === 0 && chartType === 'pie' && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm rounded-xl">
                    <p className="text-gray-400">No data available for breakdown</p>
                </div>
            )}
        </div>
    );
}
