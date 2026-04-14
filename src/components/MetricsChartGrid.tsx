import { useMemo, useState, memo, useCallback } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Order, Statement } from '../store/useShopStore';
import { parseUTCDate, getShopDayStartTimestamp } from '../utils/dateUtils';
import { calculateOrderGMV } from '../utils/gmvCalculations';
import { isCancelledOrRefunded } from '../utils/orderFinancials';

// Use paid_time for filtering/bucketing (matches backend which loads by paid_time)
const getOrderTs = (o: Order): number => Number(o.paid_time || o.created_time);

interface MetricsChartGridProps {
    orders: Order[];
    statements: Statement[];
    startDate: string;
    endDate: string;
    timezone?: string; // Shop timezone for date calculations
}

type MetricType = 'gmv' | 'orders' | 'customers' | 'items';

interface MetricCardProps {
    title: string;
    value: string;
    percentChange: number;
    isSelected: boolean;
    onSelect: () => void;
}

const MetricCard = memo(function MetricCard({ title, value, percentChange, isSelected, onSelect }: MetricCardProps) {
    return (
        <div
            className={`relative rounded-lg p-4 cursor-pointer transition-all ${isSelected
                ? 'bg-cyan-500/10 border-2 border-cyan-500'
                : 'bg-gray-800/50 border border-gray-700 hover:border-gray-600'
                }`}
            onClick={onSelect}
        >
            <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-medium text-gray-400">{title}</h4>
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="10" strokeWidth="2" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 16v-4m0-4h.01" />
                        </svg>
                    </div>
                    <p className="text-2xl font-bold text-white">{value}</p>
                    <p className={`text-sm mt-1 flex items-center gap-1 ${percentChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        <span>{percentChange >= 0 ? '▲' : '▼'}</span>
                        <span>{Math.abs(percentChange).toFixed(2)}%</span>
                    </p>
                </div>
                <div className="flex items-center">
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isSelected
                        ? 'bg-cyan-500 border-cyan-500'
                        : 'border-gray-600'
                        }`}>
                        {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                            </svg>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

// Memoized CustomTooltip outside component to prevent re-creation
const CustomTooltip = memo(({ active, payload, label, selectedMetric }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-xl">
                <p className="text-gray-300 text-sm">{label}</p>
                <p className="text-white font-bold text-lg">
                    {selectedMetric === 'gmv'
                        ? `$${payload[0].value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : payload[0].value.toLocaleString()
                    }
                </p>
            </div>
        );
    }
    return null;
});

export function MetricsChartGrid({ orders, statements, startDate, endDate, timezone = 'America/Los_Angeles' }: MetricsChartGridProps) {
    const [selectedMetric, setSelectedMetric] = useState<MetricType>('orders');

    const data = useMemo(() => {
        // Shop Timezone Filtering
        const startTs = getShopDayStartTimestamp(startDate, timezone);
        const endTs = getShopDayStartTimestamp(endDate, timezone) + 86400;

        const filteredOrders = orders.filter(o =>
            getOrderTs(o) >= startTs && getOrderTs(o) < endTs && o.is_sample_order !== true && !isCancelledOrRefunded(o)
        );

        // Previous Period Calculation
        const startAbstract = parseUTCDate(startDate);
        const endAbstract = parseUTCDate(endDate);
        // Calculate days strictly based on abstract dates
        const diffTime = endAbstract.getTime() - startAbstract.getTime();
        const daysCount = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

        const prevStartAbstract = new Date(startAbstract);
        prevStartAbstract.setUTCDate(prevStartAbstract.getUTCDate() - daysCount);
        const prevEndAbstract = new Date(startAbstract);
        prevEndAbstract.setUTCDate(prevEndAbstract.getUTCDate() - 1);

        const prevStartStr = prevStartAbstract.toISOString().split('T')[0];
        const prevEndStr = prevEndAbstract.toISOString().split('T')[0];

        const prevStartTs = getShopDayStartTimestamp(prevStartStr, timezone);
        const prevEndTs = getShopDayStartTimestamp(prevEndStr, timezone) + 86400;

        const prevOrders = orders.filter(o =>
            getOrderTs(o) >= prevStartTs && getOrderTs(o) < prevEndTs && o.is_sample_order !== true && !isCancelledOrRefunded(o)
        );

        // Daily Buckets Generation
        const dailyData: Record<string, {
            date: string;
            label: string;
            orders: number;
            gmv: number;
            customers: Set<string>;
            items: number
        }> = {};

        const currentDate = new Date(startAbstract);
        // endDate is inclusive in our logic
        while (currentDate.getTime() <= endAbstract.getTime()) {
            const key = currentDate.toISOString().split('T')[0];
            dailyData[key] = {
                date: key,
                label: currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
                orders: 0,
                gmv: 0,
                customers: new Set<string>(),
                items: 0
            };
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        }

        // Populate Data (using Shop Timezone keys)
        const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });

        filteredOrders.forEach(order => {
            const d = new Date(getOrderTs(order) * 1000);
            const key = dateFormatter.format(d);

            if (dailyData[key]) {
                dailyData[key].orders++;
                dailyData[key].gmv += calculateOrderGMV(order);
                dailyData[key].items += order.line_items.reduce((sum, item) => sum + (item.quantity || 0), 0);

                const customerId = order.buyer_info?.buyer_email || order.order_id;
                dailyData[key].customers.add(customerId);
            }
        });

        // Calculate totals
        const totalOrders = filteredOrders.length;
        // GMV calculated as: (Price × Items Sold) + Shipping Fees - Seller Discounts - Platform Discounts
        const totalGMV = filteredOrders.reduce((sum, o) => sum + calculateOrderGMV(o), 0);

        // Debug GMV calculation (Updated for new formula)
        // const debugInfo = debugGMVCalculation(filteredOrders);
        // console.log('Total GMV:', totalGMV.toFixed(2));

        const uniqueCustomers = new Set(filteredOrders.map(o => o.buyer_info?.buyer_email || o.order_id)).size;
        const totalItems = filteredOrders.reduce((sum, o) =>
            sum + o.line_items.reduce((s, item) => s + (item.quantity || 0), 0), 0
        );

        // Previous period totals
        const prevTotalOrders = prevOrders.length;
        // GMV calculated as: (Price × Items Sold) + Shipping Fees - Seller Discounts - Platform Discounts
        const prevTotalGMV = prevOrders.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
        const prevUniqueCustomers = new Set(prevOrders.map(o => o.buyer_info?.buyer_email || o.order_id)).size;
        const prevTotalItems = prevOrders.reduce((sum, o) =>
            sum + o.line_items.reduce((s, item) => s + (item.quantity || 0), 0), 0
        );

        // Calculate percent changes
        const ordersChange = prevTotalOrders > 0 ? ((totalOrders - prevTotalOrders) / prevTotalOrders) * 100 : 0;
        const gmvChange = prevTotalGMV > 0 ? ((totalGMV - prevTotalGMV) / prevTotalGMV) * 100 : 0;
        const customersChange = prevUniqueCustomers > 0 ? ((uniqueCustomers - prevUniqueCustomers) / prevUniqueCustomers) * 100 : 0;
        const itemsChange = prevTotalItems > 0 ? ((totalItems - prevTotalItems) / prevTotalItems) * 100 : 0;

        return {
            metrics: {
                gmv: {
                    value: `$${totalGMV.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    percentChange: gmvChange,
                    chartData: Object.values(dailyData).map(d => ({ label: d.label, value: parseFloat(d.gmv.toFixed(2)) }))
                },
                orders: {
                    value: totalOrders.toLocaleString(),
                    percentChange: ordersChange,
                    chartData: Object.values(dailyData).map(d => ({ label: d.label, value: d.orders }))
                },
                customers: {
                    value: uniqueCustomers.toLocaleString(),
                    percentChange: customersChange,
                    chartData: Object.values(dailyData).map(d => ({ label: d.label, value: d.customers.size }))
                },
                items: {
                    value: totalItems.toLocaleString(),
                    percentChange: itemsChange,
                    chartData: Object.values(dailyData).map(d => ({ label: d.label, value: d.items }))
                }
            }
        };
    }, [orders, statements, startDate, endDate]);

    const selectedData = data.metrics[selectedMetric];

    // Prepare callbacks for selections to prevent re-renders
    const handleSelectGmv = useCallback(() => setSelectedMetric('gmv'), []);
    const handleSelectOrders = useCallback(() => setSelectedMetric('orders'), []);
    const handleSelectCustomers = useCallback(() => setSelectedMetric('customers'), []);
    const handleSelectItems = useCallback(() => setSelectedMetric('items'), []);

    const getMetricTitle = () => {
        switch (selectedMetric) {
            case 'gmv': return 'GMV';
            case 'orders': return 'Orders';
            case 'customers': return 'Customers';
            case 'items': return 'Items sold';
        }
    };

    return (
        <div>
            {/* Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <MetricCard
                    title="GMV"
                    value={data.metrics.gmv.value}
                    percentChange={data.metrics.gmv.percentChange}
                    isSelected={selectedMetric === 'gmv'}
                    onSelect={handleSelectGmv}
                />
                <MetricCard
                    title="Orders"
                    value={data.metrics.orders.value}
                    percentChange={data.metrics.orders.percentChange}
                    isSelected={selectedMetric === 'orders'}
                    onSelect={handleSelectOrders}
                />
                <MetricCard
                    title="Customers"
                    value={data.metrics.customers.value}
                    percentChange={data.metrics.customers.percentChange}
                    isSelected={selectedMetric === 'customers'}
                    onSelect={handleSelectCustomers}
                />
                <MetricCard
                    title="Items sold"
                    value={data.metrics.items.value}
                    percentChange={data.metrics.items.percentChange}
                    isSelected={selectedMetric === 'items'}
                    onSelect={handleSelectItems}
                />
            </div>

            {/* Single Chart for Selected Metric */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                <div className="flex items-center gap-2 mb-4">
                    <span className="text-sm text-gray-400">−</span>
                    <h4 className="text-sm font-medium text-gray-400">{getMetricTitle()}</h4>
                </div>

                <div className="h-[500px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                            data={selectedData.chartData}
                            margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                        >
                            <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="#374151"
                                vertical={false}
                            />
                            <XAxis
                                dataKey="label"
                                tick={{ fill: '#9CA3AF', fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                dy={10}
                            />
                            <YAxis
                                tick={{ fill: '#9CA3AF', fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                dx={-10}
                            />
                            <Tooltip content={<CustomTooltip selectedMetric={selectedMetric} />} />
                            <Line
                                type="linear"
                                dataKey="value"
                                stroke="#06B6D4"
                                strokeWidth={2}
                                dot={{ fill: '#06B6D4', strokeWidth: 0, r: 4 }}
                                activeDot={{ r: 6 }}
                                isAnimationActive={false} // Disable animation to prevent redraws/flicker
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
