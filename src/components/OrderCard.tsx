import { Clock, Package, TruckIcon, CheckCircle, XCircle, ShoppingBag, User, ChevronRight } from 'lucide-react';
import { Order } from '../store/useShopStore';

interface OrderCardProps {
    order: Order;
    onClick: () => void;
}

export function OrderCard({ order, onClick }: OrderCardProps) {
    const getStatusIcon = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'unpaid': return <Clock className="w-5 h-5 text-yellow-500" />;
            case 'awaiting_shipment':
            case 'awaiting_collection': return <Package className="w-5 h-5 text-blue-500" />;
            case 'shipped': return <TruckIcon className="w-5 h-5 text-purple-500" />;
            case 'delivered':
            case 'completed': return <CheckCircle className="w-5 h-5 text-green-500" />;
            case 'cancelled': return <XCircle className="w-5 h-5 text-red-500" />;
            default: return <ShoppingBag className="w-5 h-5 text-gray-500" />;
        }
    };

    const formatStatus = (status: string) => {
        return status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown';
    };

    const mainItem = order.line_items?.[0];
    const otherItemsCount = (order.line_items?.length || 0) - 1;

    return (
        <div
            onClick={onClick}
            className="bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-pink-500 transition-all cursor-pointer group"
        >
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-700 rounded-lg group-hover:bg-pink-500/10 group-hover:text-pink-500 transition-colors">
                        {getStatusIcon(order.order_status)}
                    </div>
                    <div>
                        <p className="text-sm text-gray-400">Order #{order.order_id.slice(-6)}</p>
                        <p className="text-white font-medium">{formatStatus(order.order_status)}</p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-lg font-bold text-white">{order.currency} {order.order_amount.toFixed(2)}</p>
                    <p className="text-xs text-gray-500">{new Date(Number(order.created_time) * 1000).toLocaleDateString()}</p>
                </div>
            </div>

            {/* Buyer Info */}
            <div className="flex items-center gap-3 mb-4 p-3 bg-gray-700/30 rounded-lg">
                {order.buyer_info?.buyer_avatar ? (
                    <img
                        src={order.buyer_info.buyer_avatar}
                        alt="Buyer"
                        className="w-8 h-8 rounded-full border border-gray-600"
                    />
                ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
                        <User size={14} className="text-gray-300" />
                    </div>
                )}
                <div className="overflow-hidden">
                    <p className="text-sm font-medium text-white truncate">
                        {order.buyer_info?.buyer_nickname || order.buyer_info?.buyer_email || 'Guest Buyer'}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                        {order.shipping_info?.name || 'No recipient info'}
                    </p>
                </div>
            </div>

            {/* Product Preview */}
            <div className="flex items-center gap-3">
                {mainItem?.sku_image ? (
                    <img
                        src={mainItem.sku_image}
                        alt={mainItem.product_name}
                        className="w-12 h-12 rounded-lg object-cover border border-gray-700"
                    />
                ) : (
                    <div className="w-12 h-12 rounded-lg bg-gray-700 flex items-center justify-center">
                        <ShoppingBag size={20} className="text-gray-500" />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-300 truncate">{mainItem?.product_name || 'Unknown Product'}</p>
                    {otherItemsCount > 0 && (
                        <p className="text-xs text-gray-500">+{otherItemsCount} more items</p>
                    )}
                </div>
                <ChevronRight size={16} className="text-gray-500 group-hover:text-pink-500 transition-colors" />
            </div>
        </div>
    );
}
