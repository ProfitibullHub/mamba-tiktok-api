import React, { useMemo, useState } from 'react';
import {
    ChevronDown,
    DollarSign, ShoppingCart, Package, Box,
    PieChart as PieChartIcon, LineChart as LineChartIcon, BarChart2, Info
} from 'lucide-react';
import {
    AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Product, useShopStore } from '../store/useShopStore';
import { DateRangePicker, DateRange } from './DateRangePicker';
import { parseLocalDate, parseUTCDate, toLocalDateString } from '../utils/dateUtils';
import { calculateOrderGMV } from '../utils/gmvCalculations';

interface ProductPerformanceChartsProps {
    products: Product[];
}

type MetricType = 'gmv' | 'sales' | 'inventory';
type ChartType = 'line' | 'bar' | 'pie';

const getDefaultDateRange = (): DateRange => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return {
        startDate: toLocalDateString(start),
        endDate: toLocalDateString(end)
    };
};

export function ProductPerformanceCharts({ products }: ProductPerformanceChartsProps) {
    const orders = useShopStore(state => state.orders);


    const [selectedMetric, setSelectedMetric] = useState<MetricType>('gmv');
    const [chartType, setChartType] = useState<ChartType>('bar');
    const [showDropdown, setShowDropdown] = useState(false);
    const [showTopCount, setShowTopCount] = useState<10 | 20 | 50>(10);
    const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange());

    const metrics: { id: MetricType; label: string; icon: React.ReactNode }[] = [
        { id: 'gmv', label: 'GMV', icon: <DollarSign size={16} /> },
        { id: 'sales', label: 'Units Sold', icon: <ShoppingCart size={16} /> },
        { id: 'inventory', label: 'Stock Level', icon: <Box size={16} /> }
    ];

    // Calculate chart data using orders (consistent with other views)
    const chartData = useMemo(() => {
        // Filter orders by date range using UTC (consistent across timezones)
        const start = parseUTCDate(dateRange.startDate).getTime() / 1000;
        const end = parseUTCDate(dateRange.endDate).getTime() / 1000 + 86400; // End of day

        const filteredOrders = orders.filter(o => o.created_time >= start && o.created_time <= end && o.is_sample_order !== true);

        // Build product performance from orders (single source of truth)
        const productPerformance: Record<string, {
            product_id: string;
            name: string;
            gmv: number;
            sales: number;
            inventory: number;
            cogs: number | null;
            hasCogs: boolean;
        }> = {};

        // Initialize with all products
        products.forEach(p => {
            const stock = p.skus?.reduce((sum, sku) =>
                sum + (sku.inventory?.reduce((s, inv) => s + inv.quantity, 0) || 0), 0
            ) || 0;

            productPerformance[p.product_id] = {
                product_id: p.product_id,
                name: p.name,
                gmv: 0,
                sales: 0,
                inventory: stock,
                cogs: p.cogs ?? null,
                hasCogs: p.cogs !== null && p.cogs !== undefined
            };
        });

        // Calculate sales and GMV from orders - use order-level GMV for totals, line-item GMV for products
        let totalSales = 0;
        let totalGMV = 0;

        filteredOrders.forEach(order => {
            // Calculate order-level GMV using formula: (Price × Items Sold) + Shipping Fees - Seller Discounts - Platform Discounts
            const orderGMV = calculateOrderGMV(order);
            totalGMV += orderGMV;

            order.line_items.forEach(item => {
                const qty = item.quantity;
                // Line-item GMV for product attribution (sale_price * quantity)
                const itemGMV = parseFloat(item.sale_price || '0') * qty;

                // Add to grand totals (all line items, matched or not)
                totalSales += qty;

                // Try multiple matching strategies to find the product
                let matchedProduct = null;

                // Strategy 1: Match by SKU ID (item.id is typically the SKU ID from TikTok)
                matchedProduct = products.find(p => p.skus?.some(s => s.id === item.id));

                // Strategy 2: Match by seller_sku if available
                if (!matchedProduct && item.seller_sku) {
                    matchedProduct = products.find(p =>
                        p.skus?.some(s => s.seller_sku === item.seller_sku)
                    );
                }

                // Strategy 3: Match by product name (fallback, less reliable)
                if (!matchedProduct && item.product_name) {
                    matchedProduct = products.find(p =>
                        p.name.toLowerCase() === item.product_name.toLowerCase()
                    );
                }

                if (matchedProduct && productPerformance[matchedProduct.product_id]) {
                    productPerformance[matchedProduct.product_id].sales += qty;
                    productPerformance[matchedProduct.product_id].gmv += itemGMV;
                }
            });
        });

        // Convert to array and sort
        const performanceArray = Object.values(productPerformance);

        // Sort by selected metric
        performanceArray.sort((a, b) => {
            switch (selectedMetric) {
                case 'gmv':
                    return b.gmv - a.gmv;
                case 'sales':
                    return b.sales - a.sales;
                case 'inventory':
                    return b.inventory - a.inventory;
                default:
                    return 0;
            }
        });

        // Top products for charts
        const topProducts = performanceArray.slice(0, showTopCount).map(p => ({
            name: p.name.length > 25 ? p.name.slice(0, 25) + '...' : p.name,
            fullName: p.name,
            gmv: p.gmv,
            sales: p.sales,
            inventory: p.inventory,
            cogs: p.cogs || 0,
            hasCogs: p.hasCogs
        }));
        const totalInventory = products.reduce((sum, p) => {
            const stock = p.skus?.reduce((s, sku) =>
                s + (sku.inventory?.reduce((inv, i) => inv + i.quantity, 0) || 0), 0
            ) || 0;
            return sum + stock;
        }, 0);
        const productsWithSales = performanceArray.filter(p => p.sales > 0).length;

        // Pie data for distribution
        const pieData = topProducts.map(p => ({
            name: p.name,
            value: selectedMetric === 'gmv' ? p.gmv :
                selectedMetric === 'sales' ? p.sales : p.inventory
        })).filter(p => p.value > 0);

        // Inventory distribution
        const inventoryDistribution = [
            {
                name: 'Out of Stock', value: products.filter(p => {
                    const qty = p.skus?.[0]?.inventory?.[0]?.quantity ?? 0;
                    return qty === 0;
                }).length
            },
            {
                name: 'Low Stock (<10)', value: products.filter(p => {
                    const qty = p.skus?.[0]?.inventory?.[0]?.quantity ?? 0;
                    return qty > 0 && qty < 10;
                }).length
            },
            {
                name: 'Good Stock (10-50)', value: products.filter(p => {
                    const qty = p.skus?.[0]?.inventory?.[0]?.quantity ?? 0;
                    return qty >= 10 && qty <= 50;
                }).length
            },
            {
                name: 'High Stock (>50)', value: products.filter(p => {
                    const qty = p.skus?.[0]?.inventory?.[0]?.quantity ?? 0;
                    return qty > 50;
                }).length
            }
        ];

        return {
            topProducts,
            totals: {
                gmv: totalGMV,
                sales: totalSales,
                inventory: totalInventory,
                productsWithSales
            },
            pieData,
            inventoryDistribution
        };
    }, [products, orders, selectedMetric, showTopCount, dateRange]);

    // Format helpers
    const formatValue = (value: number) => {
        if (selectedMetric === 'sales' || selectedMetric === 'inventory') {
            return Math.round(value).toLocaleString();
        }
        return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const formatShortValue = (value: number) => {
        if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
        if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
        return `$${value.toFixed(2)}`;
    };

    // Calculate date range for display
    const getDaysDifference = () => {
        const start = parseLocalDate(dateRange.startDate);
        const end = parseLocalDate(dateRange.endDate);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    };

    // Chart Colors
    const COLORS = ['#EC4899', '#06B6D4', '#A855F7', '#EAB308', '#22C55E', '#EF4444', '#F97316', '#8B5CF6', '#14B8A6', '#F43F5E'];
    const INVENTORY_COLORS = ['#EF4444', '#F59E0B', '#22C55E', '#3B82F6'];

    // Custom Tooltip
    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            if (chartType === 'pie') {
                return (
                    <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-xl z-50">
                        <p className="text-gray-300 text-sm mb-1">{payload[0].name}</p>
                        <p className="text-white font-medium">{formatValue(payload[0].value)}</p>
                    </div>
                );
            }

            const data = payload[0]?.payload;
            return (
                <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-xl z-50 max-w-xs">
                    <p className="text-gray-300 text-sm mb-2 font-semibold truncate">
                        {data?.fullName || data?.name}
                    </p>
                    <div className="space-y-1 text-sm">
                        <div className="flex justify-between gap-4">
                            <span className="text-gray-400">GMV:</span>
                            <span className="text-pink-400 font-medium">${data?.gmv?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-gray-400">Sales:</span>
                            <span className="text-cyan-400 font-medium">{data?.sales?.toLocaleString()} units</span>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-gray-400">Stock:</span>
                            <span className="text-green-400 font-medium">{data?.inventory?.toLocaleString()}</span>
                        </div>
                        {data?.hasCogs && (
                            <div className="flex justify-between gap-4 border-t border-gray-700 pt-1 mt-1">
                                <span className="text-gray-400">COGS:</span>
                                <span className="text-orange-400 font-medium">${data?.cogs?.toFixed(2)}</span>
                            </div>
                        )}
                    </div>
                </div>
            );
        }
        return null;
    };

    const getDataKey = () => {
        switch (selectedMetric) {
            case 'gmv': return 'gmv';
            case 'sales': return 'sales';
            case 'inventory': return 'inventory';
            default: return 'gmv';
        }
    };

    const getBarColor = () => {
        switch (selectedMetric) {
            case 'gmv': return '#EC4899';
            case 'sales': return '#06B6D4';
            case 'inventory': return '#22C55E';
            default: return '#EC4899';
        }
    };

    return (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
            {/* Header Controls */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
                <div>
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        {chartType === 'line' ? <LineChartIcon className="text-pink-500" size={20} /> :
                            chartType === 'bar' ? <BarChart2 className="text-cyan-500" size={20} /> :
                                <PieChartIcon className="text-purple-500" size={20} />}
                        Product Performance
                    </h3>
                    <p className="text-sm text-gray-400 mt-1">
                        Top {showTopCount} products by {metrics.find(m => m.id === selectedMetric)?.label.toLowerCase()} ({getDaysDifference()} days)
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Date Range Picker */}
                    <DateRangePicker value={dateRange} onChange={setDateRange} />

                    {/* Chart Type Toggle */}
                    <div className="bg-gray-700 p-1 rounded-lg flex">
                        <button
                            onClick={() => setChartType('bar')}
                            className={`p-2 rounded transition-colors ${chartType === 'bar' ? 'bg-gray-600 text-cyan-400' : 'text-gray-400 hover:text-white'}`}
                            title="Bar Chart"
                        >
                            <BarChart2 size={16} />
                        </button>
                        <button
                            onClick={() => setChartType('line')}
                            className={`p-2 rounded transition-colors ${chartType === 'line' ? 'bg-gray-600 text-pink-400' : 'text-gray-400 hover:text-white'}`}
                            title="Area Chart"
                        >
                            <LineChartIcon size={16} />
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
                            className="flex items-center gap-2 px-3 py-2 bg-gray-700 rounded-lg text-sm text-white hover:bg-gray-600 transition-colors min-w-[120px]"
                        >
                            {metrics.find(m => m.id === selectedMetric)?.icon}
                            <span>{metrics.find(m => m.id === selectedMetric)?.label}</span>
                            <ChevronDown size={14} className="ml-auto" />
                        </button>

                        {showDropdown && (
                            <div className="absolute right-0 mt-2 w-44 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
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

                    {/* Top Count Selector */}
                    <div className="flex bg-gray-700 rounded-lg p-1">
                        {[10, 20, 50].map(count => (
                            <button
                                key={count}
                                onClick={() => setShowTopCount(count as 10 | 20 | 50)}
                                className={`px-2 py-1 rounded text-xs transition-colors ${showTopCount === count
                                    ? 'bg-gray-600 text-white shadow-sm'
                                    : 'text-gray-400 hover:text-white'
                                    }`}
                            >
                                {count}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Summary Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-900/40 rounded-lg p-4 border border-gray-700/50">
                    <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                        <DollarSign size={14} />
                        GMV ({getDaysDifference()}d)
                    </div>
                    <p className="text-xl font-bold text-pink-400">
                        {formatShortValue(chartData.totals.gmv)}
                    </p>
                </div>
                <div className="bg-gray-900/40 rounded-lg p-4 border border-gray-700/50">
                    <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                        <ShoppingCart size={14} />
                        Units Sold ({getDaysDifference()}d)
                    </div>
                    <p className="text-xl font-bold text-cyan-400">
                        {chartData.totals.sales.toLocaleString()}
                    </p>
                </div>
                <div className="bg-gray-900/40 rounded-lg p-4 border border-gray-700/50">
                    <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                        <Box size={14} />
                        Total Inventory
                    </div>
                    <p className="text-xl font-bold text-green-400">
                        {chartData.totals.inventory.toLocaleString()}
                    </p>
                </div>
                <div className="bg-gray-900/40 rounded-lg p-4 border border-gray-700/50">
                    <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                        <Package size={14} />
                        Products with Sales
                    </div>
                    <p className="text-xl font-bold text-purple-400">
                        {chartData.totals.productsWithSales}
                    </p>
                </div>
            </div>

            {/* Info about data source */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-6 flex items-start gap-3">
                <Info size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-blue-200">
                    GMV = (Price × Items Sold) + Shipping Fees - Seller Discounts - Platform Discounts
                </p>
            </div>

            {/* Chart Area */}
            <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    {chartType === 'bar' ? (
                        <BarChart
                            data={chartData.topProducts}
                            layout="vertical"
                            margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={true} vertical={false} />
                            <XAxis
                                type="number"
                                tick={{ fill: '#9CA3AF', fontSize: 11 }}
                                tickFormatter={(val) => selectedMetric === 'gmv' ? `$${val}` : val.toString()}
                                axisLine={false}
                                tickLine={false}
                            />
                            <YAxis
                                type="category"
                                dataKey="name"
                                tick={{ fill: '#9CA3AF', fontSize: 11 }}
                                width={150}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#374151', opacity: 0.4 }} />
                            <Bar
                                dataKey={getDataKey()}
                                fill={getBarColor()}
                                radius={[0, 4, 4, 0]}
                            />
                        </BarChart>
                    ) : chartType === 'line' ? (
                        <AreaChart data={chartData.topProducts} margin={{ top: 10, right: 30, left: 10, bottom: 60 }}>
                            <defs>
                                <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={getBarColor()} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={getBarColor()} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                            <XAxis
                                dataKey="name"
                                tick={{ fill: '#9CA3AF', fontSize: 10 }}
                                axisLine={false}
                                tickLine={false}
                                angle={-45}
                                textAnchor="end"
                                height={60}
                            />
                            <YAxis
                                tick={{ fill: '#9CA3AF', fontSize: 11 }}
                                tickFormatter={(val) => selectedMetric === 'gmv' ? `$${val}` : val.toString()}
                                axisLine={false}
                                tickLine={false}
                                width={60}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                                type="linear"
                                dataKey={getDataKey()}
                                stroke={getBarColor()}
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorMetric)"
                                dot={{ fill: getBarColor(), strokeWidth: 0, r: 4 }}
                                activeDot={{ r: 6 }}
                            />
                        </AreaChart>
                    ) : (
                        <PieChart>
                            <Pie
                                data={chartData.pieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={70}
                                outerRadius={110}
                                paddingAngle={2}
                                dataKey="value"
                                label={({ name, percent }: { name?: string; percent?: number }) => `${(name || '').slice(0, 15)}${(name || '').length > 15 ? '...' : ''} (${((percent || 0) * 100).toFixed(0)}%)`}
                                labelLine={{ stroke: '#6B7280', strokeWidth: 1 }}
                            >
                                {chartData.pieData.map((_, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                    )}
                </ResponsiveContainer>
            </div>

            {/* Inventory Distribution (Secondary Chart) */}
            {selectedMetric === 'inventory' && chartType !== 'pie' && (
                <div className="mt-6 pt-6 border-t border-gray-700">
                    <h4 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
                        <Info size={14} className="text-gray-500" />
                        Inventory Distribution
                    </h4>
                    <div className="grid grid-cols-4 gap-3">
                        {chartData.inventoryDistribution.map((item, index) => (
                            <div
                                key={item.name}
                                className="bg-gray-900/40 rounded-lg p-3 border border-gray-700/50"
                            >
                                <div
                                    className="w-3 h-3 rounded-full mb-2"
                                    style={{ backgroundColor: INVENTORY_COLORS[index] }}
                                />
                                <p className="text-xs text-gray-400">{item.name}</p>
                                <p className="text-lg font-bold text-white">{item.value}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
