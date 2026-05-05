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
import { useSellerBranding } from '../contexts/SellerBrandingContext';
import {
    getShopDayStartTimestamp,
    getShopDayEndExclusiveTimestamp,
    getPreviousPeriodRange,
    nextCalendarDayISO,
    previousCalendarDayISO,
    formatShopDate,
    formatShopDateISO,
} from '../utils/dateUtils';
import { calculateOrderGMV } from '../utils/gmvCalculations';
import { isCancelledOrRefunded } from '../utils/orderFinancials';

// Use paid_time for filtering/bucketing (matches backend which loads by paid_time)
// Falls back to created_time for orders without paid_time
const getOrderTs = (o: Order): number => Number(o.paid_time || o.created_time);

interface ComparisonChartsProps {
    orders: Order[];
    startDate?: string; // Optional: YYYY-MM-DD format
    endDate?: string;   // Optional: YYYY-MM-DD format
    timezone?: string;  // Shop timezone for date calculations
    /** Matches OverviewView Key Metrics trends & previous-period fetch extension (LA hybrid offset when true). */
    useHybridTimezone?: boolean;
    includeCancelledInTotal?: boolean;
    includeCancelledFinancials?: boolean;
}

type MetricType = 'gmv' | 'orders' | 'avgOrder';
type ChartType = 'line' | 'bar' | 'pie';

interface DailyData {
    date: string;
    dayLabel: string;
    previousDateLabel: string;
    /** Full heading for tooltip when hourly buckets would duplicate short axis labels */
    tooltipHeading?: string;
    current: number;
    previous: number;
}

export function ComparisonCharts({
    orders,
    startDate = '',
    endDate = '',
    timezone = 'America/Los_Angeles',
    useHybridTimezone = false,
    includeCancelledInTotal = false,
    includeCancelledFinancials = false
}: ComparisonChartsProps) {
    const { data: sellerBrand } = useSellerBranding();
    const chartPrimary = sellerBrand.chartSeries1 || sellerBrand.primaryColor;
    const chartSecondary = sellerBrand.chartSeries2 || sellerBrand.secondaryColor;
    const chartMuted = sellerBrand.chartAxis || sellerBrand.textMutedColor || '#94a3b8';
    const chartPositive = sellerBrand.chartPositive || sellerBrand.profitColor || '#34d399';
    const chartNegative = sellerBrand.chartNegative || sellerBrand.lossColor || '#f87171';
    const chartGrid = sellerBrand.chartGrid || 'rgba(148,163,184,0.25)';
    const chartCursor = sellerBrand.interactiveHoverBg || 'rgba(148,163,184,0.15)';

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

    /** Same boundaries as OverviewView calculatedMetrics (current shop window + previous trend window). */
    const comparisonBounds = useMemo(() => {
        if (!startDate || !endDate) return null;
        const shopPeriodStart = getShopDayStartTimestamp(startDate, timezone);
        const shopPeriodEndExclusive = getShopDayEndExclusiveTimestamp(endDate, timezone);
        const { prevStart, prevEndExclusive } = getPreviousPeriodRange(startDate, endDate, timezone, useHybridTimezone);
        return { shopPeriodStart, shopPeriodEndExclusive, prevStart, prevEndExclusive };
    }, [startDate, endDate, timezone, useHybridTimezone]);

    // Check if the loaded orders cover the previous period
    const needsFetch = useMemo(() => {
        // SYSTEMATIC CHECK: Verify we have data coverage for the entire previous period
        // We need orders going back to at least the start of the previous period

        // Check 1: Do we have ANY orders?
        if (orders.length === 0) return false;

        // Check 2: Find the oldest order we have
        const oldestOrderTs = Math.min(...orders.map(o => getOrderTs(o)));

        // Check 3: Does our oldest order go back far enough to cover the previous period?
        if (!comparisonBounds) return false;

        const { prevStart } = comparisonBounds;
        const needsOlderData = oldestOrderTs > prevStart + 86400; // Allow 1 day tolerance

        if (needsOlderData) {
            // Just warn in console, don't fetch
            return true;
        }

        return false;
    }, [orders, comparisonBounds]);


    // Calculate comparison data
    // Note: orders prop now includes merged historical data from store
    const chartData = useMemo(() => {
        const empty = {
            current: { gmv: 0, orders: 0, avgOrder: 0 },
            previous: { gmv: 0, orders: 0, avgOrder: 0 },
            dailyData: [] as DailyData[],
            pieData: [] as { name: string; value: number }[],
            periodLabel: { current: '', previous: '' },
        };

        if (!comparisonBounds || !startDate || !endDate) return empty;

        const { shopPeriodStart, shopPeriodEndExclusive, prevStart, prevEndExclusive } = comparisonBounds;

        if (shopPeriodStart >= shopPeriodEndExclusive || prevStart >= prevEndExclusive) return empty;

        // Filter orders (excluding ONLY sample orders here - cancellation logic applied later)
        const baseValidOrder = (o: Order) => o.is_sample_order !== true;

        const currentOrders = orders.filter(o => {
            const ts = getOrderTs(o);
            return ts >= shopPeriodStart && ts < shopPeriodEndExclusive && baseValidOrder(o);
        });
        const previousOrders = orders.filter(o => {
            const ts = getOrderTs(o);
            return ts >= prevStart && ts < prevEndExclusive && baseValidOrder(o);
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
            const fullDate = formatShopDate(ts * 1000, timezone);
            const d = new Date(fullDate);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        };

        const formatHourTick = (ts: number) =>
            new Date(ts * 1000).toLocaleTimeString('en-US', {
                hour: 'numeric',
                timeZone: timezone,
            });

        const formatDateHourTooltip = (ts: number) =>
            new Date(ts * 1000).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                timeZone: timezone,
            });

        /** Single calendar day selected → hourly buckets so line charts aren't a single dot per series */
        const singleCalendarDayWindow = startDate === endDate;

        let currentBounds: { start: number; end: number }[] = [];
        let prevBounds: { start: number; end: number }[] = [];

        if (singleCalendarDayWindow) {
            for (let t = shopPeriodStart; t < shopPeriodEndExclusive; ) {
                const segEnd = Math.min(t + 3600, shopPeriodEndExclusive);
                currentBounds.push({ start: t, end: segEnd });
                t = segEnd;
            }
            const nHourly = Math.max(1, currentBounds.length);
            const prevDuration = prevEndExclusive - prevStart;
            for (let i = 0; i < nHourly; i++) {
                const segStart = prevStart + Math.floor((prevDuration * i) / nHourly);
                const segEnd = i === nHourly - 1 ? prevEndExclusive : prevStart + Math.floor((prevDuration * (i + 1)) / nHourly);
                prevBounds.push({ start: segStart, end: Math.max(segStart, segEnd) });
            }
        } else {
            // Daily buckets: calendar-aware current slices (DST-safe); partition previous trend window equally so totals match aggregates (including hybrid skew).
            for (let d = startDate; ; ) {
                const ds = getShopDayStartTimestamp(d, timezone);
                const de = getShopDayEndExclusiveTimestamp(d, timezone);
                const sliceStart = Math.max(ds, shopPeriodStart);
                const sliceEnd = Math.min(de, shopPeriodEndExclusive);
                if (sliceStart < sliceEnd) {
                    currentBounds.push({ start: sliceStart, end: sliceEnd });
                }
                if (d === endDate) break;
                d = nextCalendarDayISO(d, timezone);
            }

            const n = Math.max(1, currentBounds.length);
            const prevDuration = prevEndExclusive - prevStart;
            for (let i = 0; i < n; i++) {
                const segStart = prevStart + Math.floor((prevDuration * i) / n);
                const segEnd = i === n - 1 ? prevEndExclusive : prevStart + Math.floor((prevDuration * (i + 1)) / n);
                prevBounds.push({ start: segStart, end: Math.max(segStart, segEnd) });
            }
        }

        const nBuckets = Math.max(1, currentBounds.length);
        const dailyData: DailyData[] = [];

        for (let i = 0; i < nBuckets; i++) {
            const { start: currentDayStart, end: currentDayEnd } = currentBounds[i];
            const { start: previousDayStart, end: previousDayEnd } = prevBounds[i];

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

            const dayLabel = singleCalendarDayWindow ? formatHourTick(currentDayStart) : formatDateLabel(currentDayStart);

            let previousDateLabel: string;
            let tooltipHeading: string | undefined;
            if (singleCalendarDayWindow) {
                previousDateLabel = formatHourTick(previousDayStart);
                tooltipHeading = `${formatDateHourTooltip(currentDayStart)} vs ${formatDateHourTooltip(previousDayStart)}`;
            } else {
                const currentDayYmd = formatShopDateISO(currentDayStart * 1000, timezone);
                const prevCompanionYmd = previousCalendarDayISO(currentDayYmd, timezone);
                const previousLabelTs = getShopDayStartTimestamp(prevCompanionYmd, timezone);
                previousDateLabel = formatDateLabel(previousLabelTs);
                tooltipHeading = undefined;
            }

            dailyData.push({
                date: formatShopDate(currentDayStart * 1000, timezone),
                dayLabel,
                previousDateLabel,
                tooltipHeading,
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

        const shopTodayStr = formatShopDateISO(Date.now(), timezone);

        let periodLabel: { current: string; previous: string };

        // Hybrid trend windows span slightly more UTC than a calendar label; copy still reads "Today vs Yesterday".
        if (startDate === endDate && startDate === shopTodayStr) {
            periodLabel = { current: 'Today', previous: 'Yesterday' };
        } else if (startDate === endDate) {
            const curTs = getShopDayStartTimestamp(startDate, timezone);
            const prevDayStr = previousCalendarDayISO(startDate, timezone);
            const prevTs = getShopDayStartTimestamp(prevDayStr, timezone);
            periodLabel = {
                current: getSmartLabel(curTs, curTs),
                previous: getSmartLabel(prevTs, prevTs),
            };
        } else {
            const periodCurrentStart = getShopDayStartTimestamp(startDate, timezone);
            const periodCurrentEndDayStart = getShopDayStartTimestamp(endDate, timezone);
            periodLabel = {
                current: getSmartLabel(periodCurrentStart, periodCurrentEndDayStart),
                previous: getSmartLabel(prevStart, prevEndExclusive > prevStart ? prevEndExclusive - 1 : prevStart),
            };
        }

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
            periodLabel,
        };
    }, [orders, selectedMetric, startDate, endDate, timezone, includeCancelledInTotal, includeCancelledFinancials, comparisonBounds]);

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
        const dayWord = daysToCompare === 1 ? 'day' : 'days';
        return `Your ${metricName} shows a ${absChange}% ${trend} compared to the preceding ${daysToCompare} ${dayWord} (${chartData.periodLabel.previous}).`;
    };

    // Chart Colors — align pie slices with agency primary/secondary + accents
    const COLORS = useMemo(
        () => [
            chartPrimary,
            chartSecondary,
            sellerBrand.chartSeries3 || '#a855f7',
            sellerBrand.chartSeries4 || '#eab308',
            sellerBrand.chartSeries5 || chartPositive,
            sellerBrand.chartSeries6 || chartNegative,
        ],
        [
            chartPrimary,
            chartSecondary,
            sellerBrand.chartSeries3,
            sellerBrand.chartSeries4,
            sellerBrand.chartSeries5,
            sellerBrand.chartSeries6,
            chartPositive,
            chartNegative,
        ],
    );

    // Custom Tooltip
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            if (chartType === 'pie') {
                return (
                    <div className="brand-toolbar p-3 rounded-lg shadow-xl z-50">
                        <p className="brand-muted text-sm mb-1">{payload[0].name}</p>
                        <p className="brand-text font-medium">{formatValue(payload[0].value)}</p>
                    </div>
                );
            }

            return (
                <div className="brand-toolbar p-3 rounded-lg shadow-xl z-50">
                    <p className="brand-text text-sm mb-2 font-semibold">
                        {payload[0]?.payload?.tooltipHeading ?? (
                            <>
                                {label}{' '}
                                <span className="brand-muted font-normal">vs</span>{' '}
                                {payload[0]?.payload?.previousDateLabel}
                            </>
                        )}
                    </p>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex items-center gap-2 text-sm justify-between min-w-[180px]">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                <span className={entry.dataKey === 'current' ? 'brand-text' : 'brand-muted'}>
                                    {entry.name === 'Current Period' ? 'Current' :
                                        entry.name === 'Previous Period' ? 'Previous' :
                                            entry.name}
                                </span>
                            </div>
                            <span className="brand-text font-medium">
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
        <div className="brand-card rounded-xl p-6 animate-fade-in">
            {/* Header Controls */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
                <div>
                    <h3 className="text-lg font-semibold brand-text flex items-center gap-2">
                        {chartType === 'line' ? <LineChartIcon style={{ color: 'var(--brand-primary)' }} size={20} /> :
                            chartType === 'bar' ? <BarChart2 style={{ color: 'var(--brand-secondary)' }} size={20} /> :
                                <PieChartIcon style={{ color: 'color-mix(in srgb, var(--brand-primary) 70%, var(--brand-secondary))' }} size={20} />}
                        Performance {chartType === 'pie' ? 'Breakdown' : 'Comparison'}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                        <p className="text-sm brand-muted">
                            {chartType === 'pie'
                                ? `${chartData.periodLabel.current} `
                                : `${chartData.periodLabel.current} vs ${chartData.periodLabel.previous} `
                            }
                        </p>
                        <div className="group relative">
                            <Info size={14} className="brand-muted cursor-help opacity-80" />
                            <div className="absolute left-0 bottom-full mb-2 w-64 brand-toolbar p-3 rounded-lg text-xs brand-text shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                Compares the last {daysToCompare} {daysToCompare === 1 ? 'day' : 'days'} with the preceding {daysToCompare} {daysToCompare === 1 ? 'day' : 'days'}.
                                {needsFetch && ' Historical data might be incomplete.'}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Chart Type Toggle */}
                    <div className="bg-black/25 border border-white/10 p-1 rounded-lg flex">
                        <button
                            onClick={() => setChartType('line')}
                            className={`p-2 rounded transition-colors ${chartType === 'line' ? 'brand-on-primary' : 'brand-nav-idle'}`}
                            style={chartType === 'line' ? { backgroundColor: 'color-mix(in srgb, var(--brand-primary) 45%, transparent)' } : undefined}
                            title="Line Chart"
                        >
                            <LineChartIcon size={16} />
                        </button>
                        <button
                            onClick={() => setChartType('bar')}
                            className={`p-2 rounded transition-colors ${chartType === 'bar' ? 'brand-on-primary' : 'brand-nav-idle'}`}
                            style={chartType === 'bar' ? { backgroundColor: 'color-mix(in srgb, var(--brand-secondary) 45%, transparent)' } : undefined}
                            title="Bar Chart"
                        >
                            <BarChart2 size={16} />
                        </button>
                        <button
                            onClick={() => setChartType('pie')}
                            className={`p-2 rounded transition-colors ${chartType === 'pie' ? 'brand-on-primary' : 'brand-nav-idle'}`}
                            style={chartType === 'pie' ? { backgroundColor: 'color-mix(in srgb, var(--brand-primary) 35%, var(--brand-secondary) 35%)' } : undefined}
                            title="Pie Chart"
                        >
                            <PieChartIcon size={16} />
                        </button>
                    </div>

                    <div className="h-6 w-px bg-white/10 mx-1 hidden sm:block"></div>

                    {/* Metric Selector */}
                    <div className="relative z-20">
                        <button
                            onClick={() => setShowDropdown(!showDropdown)}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm brand-text border border-white/10 bg-black/20 hover:bg-black/30 transition-colors min-w-[140px]"
                        >
                            {metrics.find(m => m.id === selectedMetric)?.icon}
                            <span>{metrics.find(m => m.id === selectedMetric)?.label}</span>
                            <ChevronDown size={14} className="ml-auto" />
                        </button>

                        {showDropdown && (
                            <div className="absolute right-0 mt-2 w-48 brand-card rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200 z-50">
                                {metrics.map(metric => (
                                    <button
                                        key={metric.id}
                                        onClick={() => {
                                            setSelectedMetric(metric.id);
                                            setShowDropdown(false);
                                        }}
                                        className={`w-full flex items-center gap-2 px-4 py-3 text-sm text-left transition-colors ${selectedMetric === metric.id
                                            ? 'bg-white/5 brand-text border-l-2'
                                            : 'brand-muted hover:bg-white/5'
                                            }`}
                                        style={selectedMetric === metric.id ? { borderLeftColor: 'var(--brand-primary)' } : undefined}
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
                <div className="brand-card rounded-lg p-4 relative group">
                    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-lg pointer-events-none" />
                    <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs brand-muted font-medium">Current Period</p>
                        <CalculationTooltip
                            source="Orders / Statements"
                            calculation={`Sum of ${selectedMetric} for last ${daysToCompare} days`}
                            api="GET /orders/search or GET /finance/statements"
                        />
                    </div>
                    <p className="text-2xl font-bold brand-text tracking-tight">
                        {formatValue(currentValue)}
                    </p>
                </div>

                <div className="brand-card rounded-lg p-4 group">
                    <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs brand-muted font-medium opacity-90">Previous Period</p>
                        <CalculationTooltip
                            source="Orders / Statements"
                            calculation={`Sum of ${selectedMetric} for preceding ${daysToCompare} days`}
                            api="GET /orders/search or GET /finance/statements"
                        />
                    </div>
                    <p className="text-2xl font-bold brand-muted tracking-tight">
                        {formatValue(previousValue)}
                    </p>
                </div>

                <div className="brand-card rounded-lg p-4 flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-1 mb-1">
                            <p className="text-xs brand-muted font-medium">Growth</p>
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
                                    <stop offset="5%" stopColor={chartPrimary} stopOpacity={0.35} />
                                    <stop offset="95%" stopColor={chartPrimary} stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorPrevious" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={chartMuted} stopOpacity={0.12} />
                                    <stop offset="95%" stopColor={chartMuted} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
                            <XAxis
                                dataKey="dayLabel"
                                tick={{ fill: chartMuted, fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                minTickGap={30}
                            />
                            <YAxis
                                tick={{ fill: chartMuted, fontSize: 12 }}
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
                                stroke={chartMuted}
                                strokeDasharray="5 5"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorPrevious)"
                                dot={{ fill: chartMuted, strokeWidth: 0, r: 3 }}
                                activeDot={{ r: 5 }}
                                isAnimationActive={false}
                            />
                            <Area
                                type="linear"
                                dataKey="current"
                                name="Current Period"
                                stroke={chartPrimary}
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorCurrent)"
                                dot={{ fill: chartPrimary, strokeWidth: 0, r: 4 }}
                                activeDot={{ r: 6 }}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    ) : chartType === 'bar' ? (
                        <BarChart data={chartData.dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
                            <XAxis
                                dataKey="dayLabel"
                                tick={{ fill: chartMuted, fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <YAxis
                                tick={{ fill: chartMuted, fontSize: 12 }}
                                tickFormatter={(val) => selectedMetric === 'gmv' ? `$${val} ` : val}
                                axisLine={false}
                                tickLine={false}
                                width={60}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={{ fill: chartCursor, opacity: 0.5 }} />
                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                            <Bar
                                dataKey="previous"
                                name="Previous Period"
                                fill={chartMuted}
                                radius={[4, 4, 0, 0]}
                                opacity={0.45}
                                isAnimationActive={false}
                            />
                            <Bar
                                dataKey="current"
                                name="Current Period"
                                fill={chartSecondary}
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
