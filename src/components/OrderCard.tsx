import { Clock, Package, TruckIcon, CheckCircle, XCircle, ShoppingBag, User, ChevronRight, CreditCard, Truck, DollarSign, Tag, Box } from 'lucide-react';
import { Order } from '../store/useShopStore';
import { formatShopDateTime } from '../utils/dateUtils';

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

    const getStatusColor = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'unpaid': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
            case 'awaiting_shipment':
            case 'awaiting_collection': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
            case 'shipped': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
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
    const otherItemsCount = (order.line_items?.length || 0) - 1;
    const payment = order.payment_info;



    return (
        <div
            onClick={onClick}
            className="bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-pink-500 transition-all cursor-pointer group"
        >
            {/* Header: Order ID, Status, Amount, Date */}
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-700 rounded-lg group-hover:bg-pink-500/10 group-hover:text-pink-500 transition-colors">
                        {getStatusIcon(order.order_status)}
                    </div>
                    <div>
                        <p className="text-sm text-gray-400">Order #{order.order_id.slice(-6)}</p>
                        <div className="flex items-center gap-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${getStatusColor(order.order_status)}`}>
                                {formatStatus(order.order_status)}
                            </span>
                            {order.is_fbt && (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                                    FBT
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-lg font-bold text-white">{formatCurrency(order.order_amount)}</p>
                    <p className="text-xs text-gray-500">
                        {(order.order_status === 'CANCELLED' || order.cancel_reason || order.cancellation_initiator)
                            ? `Cancelled: ${formatShopDateTime(Number(order.update_time || order.paid_time || order.created_time) * 1000)}`
                            : formatShopDateTime(Number(order.paid_time || order.created_time) * 1000)
                        }
                    </p>
                </div>
            </div>

            {/* Buyer & Shipping Info Row */}
            <div className="flex items-center gap-3 mb-3 p-3 bg-gray-700/30 rounded-lg">
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
                <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-medium text-white truncate">
                        {order.buyer_info?.buyer_nickname || order.buyer_info?.buyer_email || 'Guest Buyer'}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                        {order.shipping_info?.full_address || order.shipping_info?.name || 'No recipient info'}
                    </p>
                </div>
            </div>

            {/* Fulfillment & Shipping Info Pills */}
            <div className="flex flex-wrap gap-2 mb-3">
                {/* Fulfillment Type */}
                <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-700/50 rounded-md">
                    <Box size={12} className="text-gray-400" />
                    <span className="text-xs text-gray-300">
                        {order.fulfillment_type === 'FULFILLMENT_BY_TIKTOK' ? 'TikTok Fulfillment' : 'Seller Fulfillment'}
                    </span>
                </div>

                {/* Shipping Type */}
                {order.delivery_option_name && (
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-700/50 rounded-md">
                        <Truck size={12} className="text-gray-400" />
                        <span className="text-xs text-gray-300">{order.delivery_option_name}</span>
                    </div>
                )}

                {/* Payment Method */}
                {order.payment_method_name && (
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-700/50 rounded-md">
                        <CreditCard size={12} className="text-gray-400" />
                        <span className="text-xs text-gray-300">{order.payment_method_name}</span>
                    </div>
                )}
            </div>

            {/* Payment Breakdown */}
            {payment && (
                <div className="mb-3 p-3 bg-gray-900/50 rounded-lg border border-gray-700/50">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        {/* Subtotal */}
                        <div className="flex justify-between">
                            <span className="text-gray-400">Product Total:</span>
                            <span className="text-gray-300">{formatCurrency(payment.original_total_product_price || payment.sub_total)}</span>
                        </div>

                        {/* Original Shipping */}
                        {parseFloat(payment.original_shipping_fee || '0') > 0 && (
                            <div className="flex justify-between">
                                <span className="text-gray-400">Shipping:</span>
                                <span className="text-gray-300">{formatCurrency(payment.original_shipping_fee)}</span>
                            </div>
                        )}

                        {/* Platform Discount */}
                        {parseFloat(payment.platform_discount || '0') > 0 && (
                            <div className="flex justify-between">
                                <span className="text-green-400 flex items-center gap-1">
                                    <Tag size={10} /> Platform Discount:
                                </span>
                                <span className="text-green-400">-{formatCurrency(payment.platform_discount)}</span>
                            </div>
                        )}

                        {/* Seller Discount */}
                        {parseFloat(payment.seller_discount || '0') > 0 && (
                            <div className="flex justify-between">
                                <span className="text-orange-400 flex items-center gap-1">
                                    <Tag size={10} /> Seller Discount:
                                </span>
                                <span className="text-orange-400">-{formatCurrency(payment.seller_discount)}</span>
                            </div>
                        )}

                        {/* Shipping Discount */}
                        {parseFloat(payment.shipping_fee_seller_discount || '0') > 0 && (
                            <div className="flex justify-between">
                                <span className="text-blue-400 flex items-center gap-1">
                                    <Truck size={10} /> Shipping Discount:
                                </span>
                                <span className="text-blue-400">-{formatCurrency(payment.shipping_fee_seller_discount)}</span>
                            </div>
                        )}

                        {/* Tax */}
                        {parseFloat(payment.tax || payment.product_tax || '0') > 0 && (
                            <div className="flex justify-between">
                                <span className="text-gray-400">Tax:</span>
                                <span className="text-gray-300">{formatCurrency(payment.tax || payment.product_tax)}</span>
                            </div>
                        )}
                    </div>

                    {/* Total */}
                    <div className="flex justify-between mt-2 pt-2 border-t border-gray-700">
                        <span className="text-white font-medium flex items-center gap-1">
                            <DollarSign size={12} /> Total Paid:
                        </span>
                        <span className="text-white font-bold">{formatCurrency(payment.total_amount)}</span>
                    </div>
                </div>
            )}

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
                    <div className="flex items-center gap-2">
                        {mainItem?.seller_sku && (
                            <span className="text-xs text-gray-500">SKU: {mainItem.seller_sku}</span>
                        )}
                        {otherItemsCount > 0 && (
                            <span className="text-xs text-pink-400">+{otherItemsCount} more items</span>
                        )}
                    </div>
                </div>
                <ChevronRight size={16} className="text-gray-500 group-hover:text-pink-500 transition-colors" />
            </div>
        </div>
    );
}
