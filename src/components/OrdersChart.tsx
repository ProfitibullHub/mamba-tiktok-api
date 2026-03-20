import React, { useMemo } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Order } from '../store/useShopStore';
import { parseUTCDate } from '../utils/dateUtils';

interface OrdersChartProps {
    orders: Order[];
    startDate: string; // YYYY-MM-DD
    endDate: string;   // YYYY-MM-DD
}

export function OrdersChart({ orders, startDate, endDate }: OrdersChartProps) {
    // Calculate daily order counts
    const chartData = useMemo(() => {
        const start = parseUTCDate(startDate);
        const end = parseUTCDate(endDate);

        const startTs = start.getTime() / 1000;
        const endTs = end.getTime() / 1000 + 86400; // End of day

        // Filter orders in date range
        const filteredOrders = orders.filter(o => o.created_time >= startTs && o.created_time <= endTs);

        // Generate daily buckets (UTC to match filtering)
        const dailyMap: Record<string, number> = {};
        const currentDate = new Date(start);

        while (currentDate <= end) {
            const dateKey = currentDate.toISOString().split('T')[0];
            dailyMap[dateKey] = 0;
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        }

        // Count orders per day (UTC date keys)
        filteredOrders.forEach(order => {
            const orderDate = new Date(order.created_time * 1000);
            const dateKey = orderDate.toISOString().split('T')[0];
            if (dailyMap[dateKey] !== undefined) {
                dailyMap[dateKey]++;
            }
        });

        // Convert to array
        return Object.entries(dailyMap).map(([date, count]) => {
            const d = new Date(date + 'T00:00:00Z');
            return {
                date,
                label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
                orders: count
            };
        });
    }, [orders, startDate, endDate]);

    // Custom Tooltip
    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-xl">
                    <p className="text-gray-300 text-sm">{payload[0].payload.label}</p>
                    <p className="text-white font-bold text-lg">{payload[0].value} orders</p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-medium text-gray-400">Orders</h3>
            </div>

            <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                        data={chartData}
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
                        <Tooltip content={<CustomTooltip />} />
                        <Line
                            type="linear"
                            dataKey="orders"
                            stroke="#06B6D4"
                            strokeWidth={2}
                            dot={{ fill: '#06B6D4', strokeWidth: 0, r: 4 }}
                            activeDot={{ r: 6 }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
