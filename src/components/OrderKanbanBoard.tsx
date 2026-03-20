import { Clock, Package, TruckIcon, CheckCircle, XCircle, AlertTriangle, ShoppingBag, User, RotateCcw } from 'lucide-react';
import { Order } from '../store/useShopStore';
import { formatShopDate } from '../utils/dateUtils';

interface OrderKanbanBoardProps {
    orders: Order[];
    onOrderClick: (order: Order) => void;
}

interface KanbanColumn {
    id: string;
    title: string;
    statuses: string[];
    color: string;
    bgColor: string;
    borderColor: string;
    icon: React.ReactNode;
}

const KANBAN_COLUMNS: KanbanColumn[] = [
    {
        id: 'unpaid',
        title: 'Unpaid',
        statuses: ['UNPAID'],
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-500/10',
        borderColor: 'border-yellow-500/30',
        icon: <Clock size={16} className="text-yellow-400" />
    },
    {
        id: 'on_hold',
        title: 'On Hold',
        statuses: ['ON_HOLD', 'PARTIALLY_SHIPPING'],
        color: 'text-orange-400',
        bgColor: 'bg-orange-500/10',
        borderColor: 'border-orange-500/30',
        icon: <AlertTriangle size={16} className="text-orange-400" />
    },
    {
        id: 'awaiting',
        title: 'Awaiting Shipment',
        statuses: ['AWAITING_SHIPMENT', 'AWAITING_COLLECTION'],
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/10',
        borderColor: 'border-blue-500/30',
        icon: <Package size={16} className="text-blue-400" />
    },
    {
        id: 'shipped',
        title: 'In Transit',
        statuses: ['SHIPPED', 'IN_TRANSIT'],
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/10',
        borderColor: 'border-purple-500/30',
        icon: <TruckIcon size={16} className="text-purple-400" />
    },
    {
        id: 'delivered',
        title: 'Delivered',
        statuses: ['DELIVERED'],
        color: 'text-cyan-400',
        bgColor: 'bg-cyan-500/10',
        borderColor: 'border-cyan-500/30',
        icon: <CheckCircle size={16} className="text-cyan-400" />
    },
    {
        id: 'completed',
        title: 'Completed',
        statuses: ['COMPLETED'],
        color: 'text-green-400',
        bgColor: 'bg-green-500/10',
        borderColor: 'border-green-500/30',
        icon: <CheckCircle size={16} className="text-green-400" />
    },
    {
        id: 'cancelled',
        title: 'Cancelled',
        statuses: ['CANCELLED'],
        color: 'text-red-400',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/30',
        icon: <XCircle size={16} className="text-red-400" />
    },
    {
        id: 'returned',
        title: 'Returned',
        statuses: ['RETURNED'],
        color: 'text-red-400',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/30',
        icon: <RotateCcw size={16} className="text-red-400" />
    }
];

function KanbanCard({ order, onClick }: { order: Order; onClick: () => void }) {
    const mainItem = order.line_items?.[0];
    const itemsCount = order.line_items?.length || 0;

    const formatCurrency = (value: string | number | undefined) => {
        const num = typeof value === 'string' ? parseFloat(value || '0') : (value || 0);
        return `$${num.toFixed(2)}`;
    };

    return (
        <div
            onClick={onClick}
            className="bg-gray-800 rounded-lg p-3 border border-gray-700 hover:border-pink-500/50 cursor-pointer transition-all group"
        >
            {/* Header */}
            <div className="flex justify-between items-start mb-2">
                <span className="text-xs text-gray-400">#{order.order_id.slice(-6)}</span>
                <span className="text-sm font-semibold text-white">{formatCurrency(order.order_amount)}</span>
            </div>

            {/* Customer */}
            <div className="flex items-center gap-2 mb-2">
                {order.buyer_info?.buyer_avatar ? (
                    <img
                        src={order.buyer_info.buyer_avatar}
                        alt="Buyer"
                        className="w-5 h-5 rounded-full border border-gray-600"
                    />
                ) : (
                    <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center">
                        <User size={10} className="text-gray-300" />
                    </div>
                )}
                <span className="text-xs text-gray-300 truncate">
                    {order.buyer_info?.buyer_nickname || order.shipping_info?.name || 'Guest'}
                </span>
            </div>

            {/* Product Preview */}
            <div className="flex items-center gap-2">
                {mainItem?.sku_image ? (
                    <img
                        src={mainItem.sku_image}
                        alt={mainItem.product_name}
                        className="w-8 h-8 rounded object-cover border border-gray-700"
                    />
                ) : (
                    <div className="w-8 h-8 rounded bg-gray-700 flex items-center justify-center">
                        <ShoppingBag size={12} className="text-gray-500" />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-400 truncate">{mainItem?.product_name || 'Unknown'}</p>
                    {itemsCount > 1 && (
                        <p className="text-xs text-pink-400">+{itemsCount - 1} more</p>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700">
                <span className="text-xs text-gray-500">
                    {formatShopDate(Number(order.created_time) * 1000)}
                </span>
                {order.is_fbt && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        FBT
                    </span>
                )}
            </div>
        </div>
    );
}

export function OrderKanbanBoard({ orders, onOrderClick }: OrderKanbanBoardProps) {
    // Group orders by column
    const ordersByColumn = KANBAN_COLUMNS.reduce((acc, column) => {
        acc[column.id] = orders.filter(order => {
            const isReturned = order.order_status === 'RETURNED' || (!!order.return_status && order.return_status !== 'None');

            if (column.id === 'returned') {
                return isReturned;
            }

            if (isReturned) return false;

            return column.statuses.includes(order.order_status?.toUpperCase());
        });
        return acc;
    }, {} as Record<string, Order[]>);

    return (
        <div className="flex gap-4 overflow-x-auto pb-4">
            {KANBAN_COLUMNS.map((column) => {
                const columnOrders = ordersByColumn[column.id] || [];
                const totalAmount = columnOrders.reduce((sum, order) => {
                    const amount = typeof order.order_amount === 'string'
                        ? parseFloat(order.order_amount || '0')
                        : (order.order_amount || 0);
                    return sum + amount;
                }, 0);

                return (
                    <div
                        key={column.id}
                        className={`flex-shrink-0 w-72 rounded-xl border ${column.borderColor} ${column.bgColor}`}
                    >
                        {/* Column Header */}
                        <div className="p-3 border-b border-gray-700/50">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {column.icon}
                                    <span className={`font-medium ${column.color}`}>{column.title}</span>
                                </div>
                                <span className="text-xs bg-gray-800 px-2 py-1 rounded-full text-gray-300">
                                    {columnOrders.length}
                                </span>
                            </div>
                            {columnOrders.length > 0 && (
                                <p className="text-xs text-gray-500 mt-1">
                                    Total: ${totalAmount.toFixed(2)}
                                </p>
                            )}
                        </div>

                        {/* Column Content */}
                        <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                            {columnOrders.length > 0 ? (
                                columnOrders.slice(0, 20).map((order) => (
                                    <KanbanCard
                                        key={order.order_id}
                                        order={order}
                                        onClick={() => onOrderClick(order)}
                                    />
                                ))
                            ) : (
                                <div className="text-center py-8 text-gray-500 text-sm">
                                    No orders
                                </div>
                            )}
                            {columnOrders.length > 20 && (
                                <p className="text-center text-xs text-gray-500 py-2">
                                    +{columnOrders.length - 20} more orders
                                </p>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
