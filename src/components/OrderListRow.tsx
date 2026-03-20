import { Clock, Package, TruckIcon, CheckCircle, XCircle, ShoppingBag, User, Box, AlertTriangle, RotateCcw } from 'lucide-react';
import { Order } from '../store/useShopStore';
import { formatShopDateTime } from '../utils/dateUtils';

interface OrderListRowProps {
    order: Order;
    onClick: () => void;
}

export function OrderListRow({ order, onClick }: OrderListRowProps) {
    const getStatusIcon = (status: string) => {
        if (order.return_status && order.return_status !== 'None') return <RotateCcw className="w-4 h-4 text-red-500" />;
        switch (status?.toLowerCase()) {
            case 'unpaid': return <Clock className="w-4 h-4 text-yellow-500" />;
            case 'on_hold': return <AlertTriangle className="w-4 h-4 text-orange-500" />;
            case 'awaiting_shipment':
            case 'awaiting_collection': return <Package className="w-4 h-4 text-blue-500" />;
            case 'shipped':
            case 'in_transit': return <TruckIcon className="w-4 h-4 text-purple-500" />;
            case 'delivered':
            case 'completed': return <CheckCircle className="w-4 h-4 text-green-500" />;
            case 'cancelled': return <XCircle className="w-4 h-4 text-red-500" />;
            default: return <ShoppingBag className="w-4 h-4 text-gray-500" />;
        }
    };

    const getStatusColor = (status: string) => {
        if (order.return_status && order.return_status !== 'None') return 'bg-red-500/10 text-red-500 border-red-500/20';
        switch (status?.toLowerCase()) {
            case 'unpaid': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
            case 'on_hold': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
            case 'awaiting_shipment':
            case 'awaiting_collection': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
            case 'shipped':
            case 'in_transit': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
            case 'delivered':
            case 'completed': return 'bg-green-500/10 text-green-500 border-green-500/20';
            case 'cancelled': return 'bg-red-500/10 text-red-500 border-red-500/20';
            default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
        }
    };

    const formatStatus = (status: string) => {
        if (order.return_status && order.return_status !== 'None') return `Return: ${order.return_status}`;
        return status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown';
    };

    const formatCurrency = (value: string | number | undefined) => {
        const num = typeof value === 'string' ? parseFloat(value || '0') : (value || 0);
        return `$${num.toFixed(2)}`;
    };

    const mainItem = order.line_items?.[0];
    const itemsCount = order.line_items?.length || 0;

    return (
        <tr
            onClick={onClick}
            className="border-b border-gray-700/50 hover:bg-gray-800/50 cursor-pointer transition-colors group"
        >
            {/* Order ID & Date */}
            <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-gray-700 rounded group-hover:bg-pink-500/10 transition-colors">
                        {getStatusIcon(order.order_status)}
                    </div>
                    <div>
                        <p className="text-sm font-medium text-white">#{order.order_id.slice(-8)}</p>
                        <p className="text-xs text-gray-500">
                            {(order.order_status === 'CANCELLED' || order.cancel_reason || order.cancellation_initiator)
                                ? `Cancelled: ${formatShopDateTime(Number(order.update_time || order.paid_time || order.created_time) * 1000)}`
                                : formatShopDateTime(Number(order.paid_time || order.created_time) * 1000)
                            }
                        </p>
                    </div>
                </div>
            </td>

            {/* Customer */}
            <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                    {order.buyer_info?.buyer_avatar ? (
                        <img
                            src={order.buyer_info.buyer_avatar}
                            alt="Buyer"
                            className="w-6 h-6 rounded-full border border-gray-600"
                        />
                    ) : (
                        <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center">
                            <User size={12} className="text-gray-300" />
                        </div>
                    )}
                    <span className="text-sm text-gray-300 truncate max-w-[120px]">
                        {order.buyer_info?.buyer_nickname || order.shipping_info?.name || 'Guest'}
                    </span>
                </div>
            </td>

            {/* Products */}
            <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                    {mainItem?.sku_image ? (
                        <img
                            src={mainItem.sku_image}
                            alt={mainItem.product_name}
                            className="w-8 h-8 rounded object-cover border border-gray-700"
                        />
                    ) : (
                        <div className="w-8 h-8 rounded bg-gray-700 flex items-center justify-center">
                            <ShoppingBag size={14} className="text-gray-500" />
                        </div>
                    )}
                    <div className="min-w-0">
                        <p className="text-sm text-gray-300 truncate max-w-[150px]">
                            {mainItem?.product_name || 'Unknown'}
                        </p>
                        {itemsCount > 1 && (
                            <p className="text-xs text-pink-400">+{itemsCount - 1} more</p>
                        )}
                    </div>
                </div>
            </td>

            {/* Status */}
            <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full border ${getStatusColor(order.order_status)}`}>
                        {formatStatus(order.order_status)}
                    </span>
                    {order.is_fbt && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                            FBT
                        </span>
                    )}
                </div>
            </td>

            {/* Fulfillment */}
            <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                    <Box size={14} className="text-gray-400" />
                    <span className="text-xs text-gray-400">
                        {order.fulfillment_type === 'FULFILLMENT_BY_TIKTOK' ? 'TikTok' : 'Seller'}
                    </span>
                </div>
            </td>

            {/* Amount */}
            <td className="px-4 py-3 text-right">
                <span className="text-sm font-semibold text-white">
                    {formatCurrency(order.order_amount)}
                </span>
            </td>
        </tr>
    );
}
