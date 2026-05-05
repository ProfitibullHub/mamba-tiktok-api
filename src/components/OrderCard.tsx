import { Clock, Package, TruckIcon, CheckCircle, XCircle, ShoppingBag, User, ChevronRight, CreditCard, Truck, DollarSign, Tag, Box } from 'lucide-react';
import { Order } from '../store/useShopStore';
import { formatShopDateTime } from '../utils/dateUtils';

interface OrderCardProps {
    order: Order;
    onClick: () => void;
}

export function OrderCard({ order, onClick }: OrderCardProps) {
    const getStatusTone = (status: string): 'warning' | 'info' | 'success' | 'danger' | 'neutral' => {
        switch (status?.toLowerCase()) {
            case 'unpaid':
                return 'warning';
            case 'awaiting_shipment':
            case 'awaiting_collection':
            case 'shipped':
                return 'info';
            case 'delivered':
            case 'completed':
                return 'success';
            case 'cancelled':
                return 'danger';
            default:
                return 'neutral';
        }
    };

    const toneTextColor = (tone: 'warning' | 'info' | 'success' | 'danger' | 'neutral') => {
        if (tone === 'warning') return 'var(--brand-warning-text)';
        if (tone === 'info') return 'var(--brand-info-text)';
        if (tone === 'success') return 'var(--brand-success-text)';
        if (tone === 'danger') return 'var(--brand-danger-text)';
        return 'var(--brand-text-muted)';
    };

    const getStatusIcon = (status: string) => {
        const tone = getStatusTone(status);
        const iconProps = { className: 'w-5 h-5', style: { color: toneTextColor(tone) } };
        switch (status?.toLowerCase()) {
            case 'unpaid': return <Clock {...iconProps} />;
            case 'awaiting_shipment':
            case 'awaiting_collection': return <Package {...iconProps} />;
            case 'shipped': return <TruckIcon {...iconProps} />;
            case 'delivered':
            case 'completed': return <CheckCircle {...iconProps} />;
            case 'cancelled': return <XCircle {...iconProps} />;
            default: return <ShoppingBag {...iconProps} />;
        }
    };

    const getStatusColor = (status: string) => {
        const tone = getStatusTone(status);
        if (tone === 'warning') return 'brand-state-warning';
        if (tone === 'info') return 'brand-state-info';
        if (tone === 'success') return 'brand-state-success';
        if (tone === 'danger') return 'brand-state-danger';
        return 'brand-card';
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
            className="brand-card rounded-xl p-4 transition-all cursor-pointer group brand-card-hover"
        >
            {/* Header: Order ID, Status, Amount, Date */}
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg transition-colors" style={{ backgroundColor: 'var(--brand-interactive-hover-bg)' }}>
                        {getStatusIcon(order.order_status)}
                    </div>
                    <div>
                        <p className="text-sm brand-muted">Order #{order.order_id.slice(-6)}</p>
                        <div className="flex items-center gap-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${getStatusColor(order.order_status)}`}>
                                {formatStatus(order.order_status)}
                            </span>
                            {order.is_fbt && (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full brand-state-info">
                                    FBT
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-lg font-bold brand-text">{formatCurrency(order.order_amount)}</p>
                    <p className="text-xs brand-muted">
                        {(order.order_status === 'CANCELLED' || order.cancel_reason || order.cancellation_initiator)
                            ? `Cancelled: ${formatShopDateTime(Number(order.update_time || order.paid_time || order.created_time) * 1000)}`
                            : formatShopDateTime(Number(order.paid_time || order.created_time) * 1000)
                        }
                    </p>
                </div>
            </div>

            {/* Buyer & Shipping Info Row */}
            <div className="flex items-center gap-3 mb-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--brand-interactive-hover-bg)' }}>
                {order.buyer_info?.buyer_avatar ? (
                    <img
                        src={order.buyer_info.buyer_avatar}
                        alt="Buyer"
                        className="w-8 h-8 rounded-full border"
                        style={{ borderColor: 'var(--brand-card-border)' }}
                    />
                ) : (
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--brand-card-bg)' }}>
                        <User size={14} className="brand-muted" />
                    </div>
                )}
                <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-medium brand-text truncate">
                        {order.buyer_info?.buyer_nickname || order.buyer_info?.buyer_email || 'Guest Buyer'}
                    </p>
                    <p className="text-xs brand-muted truncate">
                        {order.shipping_info?.full_address || order.shipping_info?.name || 'No recipient info'}
                    </p>
                </div>
            </div>

            {/* Fulfillment & Shipping Info Pills */}
            <div className="flex flex-wrap gap-2 mb-3">
                {/* Fulfillment Type */}
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ backgroundColor: 'var(--brand-interactive-hover-bg)' }}>
                    <Box size={12} className="brand-muted" />
                    <span className="text-xs brand-muted">
                        {order.fulfillment_type === 'FULFILLMENT_BY_TIKTOK' ? 'TikTok Fulfillment' : 'Seller Fulfillment'}
                    </span>
                </div>

                {/* Shipping Type */}
                {order.delivery_option_name && (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ backgroundColor: 'var(--brand-interactive-hover-bg)' }}>
                        <Truck size={12} className="brand-muted" />
                        <span className="text-xs brand-muted">{order.delivery_option_name}</span>
                    </div>
                )}

                {/* Payment Method */}
                {order.payment_method_name && (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ backgroundColor: 'var(--brand-interactive-hover-bg)' }}>
                        <CreditCard size={12} className="brand-muted" />
                        <span className="text-xs brand-muted">{order.payment_method_name}</span>
                    </div>
                )}
            </div>

            {/* Payment Breakdown */}
            {payment && (
                <div className="mb-3 p-3 rounded-lg border brand-card">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        {/* Subtotal */}
                        <div className="flex justify-between">
                            <span className="brand-muted">Product Total:</span>
                            <span className="brand-text">{formatCurrency(payment.original_total_product_price || payment.sub_total)}</span>
                        </div>

                        {/* Original Shipping */}
                        {parseFloat(payment.original_shipping_fee || '0') > 0 && (
                            <div className="flex justify-between">
                                <span className="brand-muted">Shipping:</span>
                                <span className="brand-text">{formatCurrency(payment.original_shipping_fee)}</span>
                            </div>
                        )}

                        {/* Platform Discount */}
                        {parseFloat(payment.platform_discount || '0') > 0 && (
                            <div className="flex justify-between">
                                <span className="brand-profit flex items-center gap-1">
                                    <Tag size={10} /> Platform Discount:
                                </span>
                                <span className="brand-profit">-{formatCurrency(payment.platform_discount)}</span>
                            </div>
                        )}

                        {/* Seller Discount */}
                        {parseFloat(payment.seller_discount || '0') > 0 && (
                            <div className="flex justify-between">
                                <span className="brand-state-warning flex items-center gap-1 px-1 rounded">
                                    <Tag size={10} /> Seller Discount:
                                </span>
                                <span className="brand-state-warning px-1 rounded">-{formatCurrency(payment.seller_discount)}</span>
                            </div>
                        )}

                        {/* Shipping Discount */}
                        {parseFloat(payment.shipping_fee_seller_discount || '0') > 0 && (
                            <div className="flex justify-between">
                                <span className="brand-state-info flex items-center gap-1 px-1 rounded">
                                    <Truck size={10} /> Shipping Discount:
                                </span>
                                <span className="brand-state-info px-1 rounded">-{formatCurrency(payment.shipping_fee_seller_discount)}</span>
                            </div>
                        )}

                        {/* Tax */}
                        {parseFloat(payment.tax || payment.product_tax || '0') > 0 && (
                            <div className="flex justify-between">
                                <span className="brand-muted">Tax:</span>
                                <span className="brand-text">{formatCurrency(payment.tax || payment.product_tax)}</span>
                            </div>
                        )}
                    </div>

                    {/* Total */}
                    <div className="flex justify-between mt-2 pt-2 border-t" style={{ borderColor: 'var(--brand-card-border)' }}>
                        <span className="brand-text font-medium flex items-center gap-1">
                            <DollarSign size={12} /> Total Paid:
                        </span>
                        <span className="brand-text font-bold">{formatCurrency(payment.total_amount)}</span>
                    </div>
                </div>
            )}

            {/* Product Preview */}
            <div className="flex items-center gap-3">
                {mainItem?.sku_image ? (
                    <img
                        src={mainItem.sku_image}
                        alt={mainItem.product_name}
                        className="w-12 h-12 rounded-lg object-cover border"
                        style={{ borderColor: 'var(--brand-card-border)' }}
                    />
                ) : (
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--brand-interactive-hover-bg)' }}>
                        <ShoppingBag size={20} className="brand-muted" />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <p className="text-sm brand-text truncate">{mainItem?.product_name || 'Unknown Product'}</p>
                    <div className="flex items-center gap-2">
                        {mainItem?.seller_sku && (
                            <span className="text-xs brand-muted">SKU: {mainItem.seller_sku}</span>
                        )}
                        {otherItemsCount > 0 && (
                            <span className="text-xs" style={{ color: 'var(--brand-primary)' }}>+{otherItemsCount} more items</span>
                        )}
                    </div>
                </div>
                <ChevronRight size={16} className="brand-muted transition-colors" />
            </div>
        </div>
    );
}
