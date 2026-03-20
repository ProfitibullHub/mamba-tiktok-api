import { X, User, MapPin, Package, CreditCard, Truck, Box, Tag, DollarSign, Info, CheckCircle, RotateCcw, Gift, Flame, Clock, XCircle, BadgeCheck } from 'lucide-react';
import { Order } from '../store/useShopStore';
import { formatShopDateTime } from '../utils/dateUtils';

interface OrderDetailsProps {
    order: Order;
    onClose: () => void;
}

export function OrderDetails({ order, onClose }: OrderDetailsProps) {
    const formatStatus = (status: string) => {
        return status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown';
    };

    const formatDate = (timestamp: number) => {
        return formatShopDateTime(timestamp); // Handles seconds/ms automatically
    };

    const formatCurrency = (value: string | number | undefined, showZero = true) => {
        const num = typeof value === 'string' ? parseFloat(value || '0') : (value || 0);
        if (num === 0 && !showZero) return null;
        return `${order.currency} ${num.toFixed(2)}`;
    };

    const payment = order.payment_info;

    // Calculate totals for display
    const originalProductPrice = parseFloat(payment?.original_total_product_price || payment?.sub_total || '0');
    const originalShippingFee = parseFloat(payment?.original_shipping_fee || '0');
    const platformDiscount = parseFloat(payment?.platform_discount || '0');
    const sellerDiscount = parseFloat(payment?.seller_discount || '0');
    const shippingDiscount = parseFloat(payment?.shipping_fee_seller_discount || '0') +
        parseFloat(payment?.shipping_fee_platform_discount || '0') +
        parseFloat(payment?.shipping_fee_cofunded_discount || '0');
    const productTax = parseFloat(payment?.product_tax || payment?.tax || '0');
    const shippingTax = parseFloat(payment?.shipping_fee_tax || '0');
    const totalTax = productTax + shippingTax;
    const totalAmount = parseFloat(payment?.total_amount || String(order.order_amount) || '0');
    const finalShippingFee = parseFloat(payment?.shipping_fee || '0');

    const hasAnyDiscounts = platformDiscount > 0 || sellerDiscount > 0 || shippingDiscount > 0;

    // Fulfillment display
    const getFulfillmentInfo = () => {
        if (order.fulfillment_type === 'FULFILLMENT_BY_TIKTOK' || order.is_fbt) {
            return { label: 'Fulfilled by TikTok (FBT)', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' };
        }
        return { label: 'Seller Fulfillment', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' };
    };

    const fulfillmentInfo = getFulfillmentInfo();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-gray-800 shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-800 p-6 flex justify-between items-center z-10">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Order Details</h2>
                        <p className="text-gray-400 text-sm font-mono">ID: {order.order_id}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Status & Key Info Row */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Status</p>
                            <p className="text-lg font-semibold text-white">{formatStatus(order.order_status)}</p>
                        </div>
                        <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Payment Status</p>
                            <div className="flex items-center gap-2">
                                {order.paid_time ? (
                                    <>
                                        <BadgeCheck size={18} className="text-green-400" />
                                        <span className="text-green-400 font-semibold">PAID</span>
                                    </>
                                ) : (
                                    <>
                                        <XCircle size={18} className="text-red-400" />
                                        <span className="text-red-400 font-semibold">UNPAID</span>
                                    </>
                                )}
                            </div>
                            {order.paid_time && (
                                <div className="mt-2">
                                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Paid Time</p>
                                    <p className="text-white text-sm">{formatDate(order.paid_time)}</p>
                                </div>
                            )}
                        </div>
                        <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Created</p>
                            <p className="text-white">{formatDate(order.created_time)}</p>
                            {(order.order_status === 'CANCELLED' || order.cancel_reason || order.cancellation_initiator) && order.update_time && (
                                <div className="mt-2">
                                    <p className="text-xs text-red-400 uppercase tracking-wider mb-1">Cancelled Time</p>
                                    <p className="text-red-300 text-sm">{formatDate(order.update_time)}</p>
                                </div>
                            )}
                            {order.collection_time && (
                                <div className="mt-2">
                                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Collection Time</p>
                                    <p className="text-white">{formatDate(order.collection_time)}</p>
                                </div>
                            )}
                            {order.shipping_due_time && (
                                <div className="mt-2">
                                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Shipping Due</p>
                                    <p className="text-white">{formatDate(order.shipping_due_time)}</p>
                                </div>
                            )}
                        </div>
                        <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total Amount</p>
                            <p className="text-xl font-bold text-pink-500">{formatCurrency(totalAmount)}</p>
                        </div>
                    </div>

                    {/* Order Flags & Notes */}
                    {(order.is_exchange_order || order.is_on_hold_order || order.is_replacement_order || order.seller_note) && (
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 space-y-3">
                            <div className="flex flex-wrap gap-2">
                                {order.is_exchange_order && (
                                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 text-sm">
                                        <RotateCcw size={14} /> Exchange Order
                                    </span>
                                )}
                                {order.is_replacement_order && (
                                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 text-sm">
                                        <RotateCcw size={14} /> Replacement Order
                                    </span>
                                )}
                                {order.is_on_hold_order && (
                                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 text-sm">
                                        <Clock size={14} /> On Hold
                                    </span>
                                )}
                            </div>
                            {order.seller_note && (
                                <div className="flex items-start gap-2 text-blue-200 bg-blue-500/20 p-3 rounded-lg">
                                    <Info size={16} className="mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-xs uppercase opacity-70 mb-1">Seller Note</p>
                                        <p className="text-sm">{order.seller_note}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Fulfillment & Shipping Type Row */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Fulfillment Type */}
                        <div className={`p-4 rounded-xl border ${fulfillmentInfo.color}`}>
                            <div className="flex items-center gap-3">
                                <Box size={24} />
                                <div>
                                    <p className="text-xs uppercase tracking-wider opacity-70">Fulfillment Type</p>
                                    <p className="font-semibold">{fulfillmentInfo.label}</p>
                                </div>
                            </div>
                            {order.is_fbt && order.fbt_fulfillment_fee && (
                                <div className="mt-2 pt-2 border-t border-current/20">
                                    <p className="text-sm">FBT Fee: {formatCurrency(order.fbt_fulfillment_fee)}</p>
                                </div>
                            )}
                        </div>

                        {/* Shipping Type */}
                        <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-400">
                            <div className="flex items-center gap-3">
                                <Truck size={24} />
                                <div>
                                    <p className="text-xs uppercase tracking-wider opacity-70">Shipping Type</p>
                                    <p className="font-semibold">
                                        {order.shipping_type === 'PLATFORM' ? 'Platform Shipping' : 'Seller Shipping'}
                                    </p>
                                    {order.delivery_type && (
                                        <p className="text-xs text-blue-300/70 mt-1">{order.delivery_type.replace(/_/g, ' ')}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Delivery Option */}
                        <div className="p-4 rounded-xl border border-green-500/30 bg-green-500/10 text-green-400">
                            <div className="flex items-center gap-3">
                                <CheckCircle size={24} />
                                <div>
                                    <p className="text-xs uppercase tracking-wider opacity-70">Delivery Option</p>
                                    <p className="font-semibold">{order.delivery_option_name || 'Standard'}</p>
                                    {order.delivery_option_id && (
                                        <p className="text-xs opacity-70 font-mono">ID: {order.delivery_option_id.slice(-8)}</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Warehouse ID if FBT */}
                    {order.warehouse_id && (
                        <div className="flex items-center gap-2 px-4 py-2 bg-gray-800/30 rounded-lg border border-gray-700/50">
                            <Info size={14} className="text-gray-500" />
                            <span className="text-sm text-gray-400">Warehouse ID: </span>
                            <span className="text-sm text-gray-300 font-mono">{order.warehouse_id}</span>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Buyer Info */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <User className="text-pink-500" size={20} />
                                Buyer Information
                            </h3>
                            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-4">
                                <div className="flex items-center gap-4">
                                    {order.buyer_info?.buyer_avatar ? (
                                        <img
                                            src={order.buyer_info.buyer_avatar}
                                            alt="Buyer"
                                            className="w-16 h-16 rounded-full border-2 border-gray-700"
                                        />
                                    ) : (
                                        <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center">
                                            <User size={32} className="text-gray-500" />
                                        </div>
                                    )}
                                    <div>
                                        <p className="text-lg font-medium text-white">
                                            {order.buyer_info?.buyer_nickname || 'Guest User'}
                                        </p>
                                        <p className="text-lg font-medium text-white">
                                            {order.buyer_info?.buyer_nickname || 'Guest User'}
                                        </p>
                                        {/* buyer_email removed as per request */}
                                        {order.buyer_info?.buyer_message && (
                                            <p className="text-gray-500 text-xs mt-1 italic">"{order.buyer_info.buyer_message}"</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Shipping Info */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <MapPin className="text-pink-500" size={20} />
                                Shipping Address
                            </h3>
                            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                                {order.shipping_info ? (
                                    <div className="space-y-1 text-gray-300">
                                        <p className="font-medium text-white">{order.shipping_info.name}</p>
                                        {order.shipping_info.full_address ? (
                                            <p>{order.shipping_info.full_address}</p>
                                        ) : (
                                            <>
                                                <p>{order.shipping_info.address_line1}</p>
                                                {order.shipping_info.address_line2 && <p>{order.shipping_info.address_line2}</p>}
                                                <p>
                                                    {order.shipping_info.city}, {order.shipping_info.state} {order.shipping_info.postal_code}
                                                </p>
                                                <p>{order.shipping_info.country}</p>
                                            </>
                                        )}
                                        {order.shipping_info.phone_number && (
                                            <p className="text-sm text-gray-500 mt-2">{order.shipping_info.phone_number}</p>
                                        )}

                                        {(order.tracking_number || order.shipping_info.tracking_number) && (
                                            <div className="mt-3 pt-3 border-t border-gray-700">
                                                <p className="text-xs text-gray-500 uppercase">Tracking Info</p>
                                                <p className="text-white font-mono">{order.tracking_number || order.shipping_info.tracking_number}</p>
                                                <p className="text-sm text-gray-400">{order.shipping_provider || order.shipping_info.shipping_provider}</p>
                                                {order.shipping_provider_id && (
                                                    <p className="text-xs text-gray-500 mt-1">Provider ID: {order.shipping_provider_id}</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-gray-500 italic">No shipping information available</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Line Items */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <Package className="text-pink-500" size={20} />
                            Order Items ({order.line_items.length})
                        </h3>
                        <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
                            <table className="w-full">
                                <thead className="bg-gray-900/50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Product</th>
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Price</th>
                                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Qty</th>
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {order.line_items.map((item) => (
                                        <tr key={item.id} className="hover:bg-gray-700/30">
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-3">
                                                    {item.sku_image ? (
                                                        <img
                                                            src={item.sku_image}
                                                            alt={item.product_name}
                                                            className="w-12 h-12 rounded-lg object-cover border border-gray-600"
                                                        />
                                                    ) : (
                                                        <div className="w-12 h-12 rounded-lg bg-gray-700 flex items-center justify-center border border-gray-600">
                                                            <Package size={20} className="text-gray-500" />
                                                        </div>
                                                    )}
                                                    <div>
                                                        <span className="text-sm text-white font-medium block">{item.product_name}</span>
                                                        {item.seller_sku && (
                                                            <span className="text-xs text-gray-500">SKU: {item.seller_sku}</span>
                                                        )}
                                                        {item.sku_name && item.sku_name !== 'Default' && (
                                                            <span className="text-xs text-gray-400 ml-2">{item.sku_name}</span>
                                                        )}
                                                        <div className="flex gap-2 mt-1">
                                                            {item.is_dangerous_good && (
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 border border-red-500/30">
                                                                    <Flame size={10} /> Dangerous Good
                                                                </span>
                                                            )}
                                                            {item.is_gift && (
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-pink-500/20 text-pink-400 border border-pink-500/30">
                                                                    <Gift size={10} /> Gift
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-sm text-gray-300 text-right">
                                                <div>
                                                    <span>{order.currency} {item.sale_price}</span>
                                                    {item.original_price && parseFloat(item.original_price) > parseFloat(item.sale_price) && (
                                                        <span className="text-xs text-gray-500 line-through ml-2">
                                                            {order.currency} {item.original_price}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-sm text-gray-300 text-center">
                                                {item.quantity}
                                            </td>
                                            <td className="px-4 py-4 text-sm text-white font-medium text-right">
                                                {order.currency} {(parseFloat(item.sale_price) * item.quantity).toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Return & Refund Section */}
                    {(order.refund_amount || (order.return_status && order.return_status !== 'None')) && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <RotateCcw className="text-red-500" size={20} />
                                Return & Refund Information
                            </h3>
                            <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/30">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {order.refund_amount ? (
                                        <div>
                                            <p className="text-xs text-red-300 uppercase tracking-wider mb-1">Refund Amount</p>
                                            <p className="text-xl font-bold text-red-400">{formatCurrency(order.refund_amount)}</p>
                                        </div>
                                    ) : null}
                                    {order.return_status && order.return_status !== 'None' && (
                                        <div>
                                            <p className="text-xs text-red-300 uppercase tracking-wider mb-1">Return Status</p>
                                            <p className="text-white font-medium">{order.return_status}</p>
                                        </div>
                                    )}
                                    {order.return_reason && (
                                        <div className="col-span-2">
                                            <p className="text-xs text-red-300 uppercase tracking-wider mb-1">Reason</p>
                                            <p className="text-white">{order.return_reason}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Cancellation Info */}
                    {(order.cancel_reason || order.cancellation_initiator) && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <XCircle className="text-red-500" size={20} />
                                Cancellation Information
                            </h3>
                            <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/30">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {order.cancel_reason && (
                                        <div>
                                            <p className="text-xs text-red-300 uppercase tracking-wider mb-1">Reason</p>
                                            <p className="text-white">{order.cancel_reason}</p>
                                        </div>
                                    )}
                                    {order.cancellation_initiator && (
                                        <div>
                                            <p className="text-xs text-red-300 uppercase tracking-wider mb-1">Initiator</p>
                                            <p className="text-white">{order.cancellation_initiator}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Comprehensive Payment Breakdown */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <CreditCard className="text-pink-500" size={20} />
                            Payment Breakdown
                        </h3>
                        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                            <div className="space-y-3">
                                {/* Original Prices Section */}
                                <div className="pb-3 border-b border-gray-700">
                                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Original Prices</p>
                                    <div className="flex justify-between text-gray-300">
                                        <span className="flex items-center gap-2">
                                            <Tag size={14} className="text-gray-500" />
                                            Product Subtotal
                                        </span>
                                        <span>{formatCurrency(originalProductPrice)}</span>
                                    </div>
                                    <div className="flex justify-between text-gray-300 mt-1">
                                        <span className="flex items-center gap-2">
                                            <Truck size={14} className="text-gray-500" />
                                            Original Shipping Fee
                                        </span>
                                        <span>{formatCurrency(originalShippingFee)}</span>
                                    </div>
                                </div>

                                {/* Discounts Section */}
                                {hasAnyDiscounts && (
                                    <div className="pb-3 border-b border-gray-700">
                                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Discounts Applied</p>

                                        {platformDiscount > 0 && (
                                            <div className="flex justify-between text-green-400">
                                                <span className="flex items-center gap-2">
                                                    <Tag size={14} />
                                                    Platform Discount
                                                </span>
                                                <span>-{formatCurrency(platformDiscount)}</span>
                                            </div>
                                        )}

                                        {sellerDiscount > 0 && (
                                            <div className="flex justify-between text-orange-400 mt-1">
                                                <span className="flex items-center gap-2">
                                                    <Tag size={14} />
                                                    Seller Discount
                                                </span>
                                                <span>-{formatCurrency(sellerDiscount)}</span>
                                            </div>
                                        )}

                                        {shippingDiscount > 0 && (
                                            <div className="flex justify-between text-blue-400 mt-1">
                                                <span className="flex items-center gap-2">
                                                    <Truck size={14} />
                                                    Shipping Discount
                                                </span>
                                                <span>-{formatCurrency(shippingDiscount)}</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Fees & Taxes Section */}
                                <div className="pb-3 border-b border-gray-700">
                                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Final Charges</p>

                                    <div className="flex justify-between text-gray-300">
                                        <span>Final Shipping Fee</span>
                                        <span className={finalShippingFee === 0 ? 'text-green-400' : ''}>
                                            {finalShippingFee === 0 ? 'FREE' : formatCurrency(finalShippingFee)}
                                        </span>
                                    </div>

                                    <div className="flex justify-between text-gray-300 mt-1">
                                        <span>Product Tax</span>
                                        <span>{formatCurrency(productTax)}</span>
                                    </div>

                                    {shippingTax > 0 && (
                                        <div className="flex justify-between text-gray-300 mt-1">
                                            <span>Shipping Tax</span>
                                            <span>{formatCurrency(shippingTax)}</span>
                                        </div>
                                    )}

                                    {parseFloat(payment?.item_insurance_tax || '0') > 0 && (
                                        <div className="flex justify-between text-gray-300 mt-1">
                                            <span>Insurance Tax</span>
                                            <span>{formatCurrency(payment?.item_insurance_tax)}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Grand Total */}
                                <div className="pt-2">
                                    <div className="flex justify-between items-center">
                                        <span className="flex items-center gap-2 text-white text-lg font-bold">
                                            <DollarSign size={20} className="text-pink-500" />
                                            Total Paid by Customer
                                        </span>
                                        <span className="text-2xl font-bold text-pink-500">{formatCurrency(totalAmount)}</span>
                                    </div>
                                    {payment?.currency && payment.currency !== order.currency && (
                                        <p className="text-xs text-gray-500 text-right mt-1">
                                            Currency: {payment.currency}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Payment Summary Mini Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className="bg-gradient-to-br from-pink-500/20 to-purple-500/20 p-4 rounded-xl border border-pink-500/30">
                            <p className="text-xs text-gray-400 uppercase">Subtotal</p>
                            <p className="text-lg font-bold text-white">{formatCurrency(originalProductPrice)}</p>
                        </div>
                        <div className="bg-gradient-to-br from-blue-500/20 to-cyan-500/20 p-4 rounded-xl border border-blue-500/30">
                            <p className="text-xs text-gray-400 uppercase">Shipping</p>
                            <p className="text-lg font-bold text-white">
                                {finalShippingFee === 0 ? 'FREE' : formatCurrency(finalShippingFee)}
                            </p>
                        </div>
                        <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 p-4 rounded-xl border border-green-500/30">
                            <p className="text-xs text-gray-400 uppercase">Product Discounts</p>
                            <p className="text-lg font-bold text-green-400">
                                {(platformDiscount + sellerDiscount) > 0 ? `-${formatCurrency(platformDiscount + sellerDiscount)}` : 'None'}
                            </p>
                        </div>
                        <div className="bg-gradient-to-br from-orange-500/20 to-yellow-500/20 p-4 rounded-xl border border-orange-500/30">
                            <p className="text-xs text-gray-400 uppercase">Tax</p>
                            <p className="text-lg font-bold text-white">{formatCurrency(totalTax)}</p>
                        </div>
                        <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 p-4 rounded-xl border border-purple-500/30">
                            <p className="text-xs text-gray-400 uppercase">Total</p>
                            <p className="text-lg font-bold text-pink-400">{formatCurrency(totalAmount)}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
