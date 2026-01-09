import { X, User, MapPin, Package, CreditCard } from 'lucide-react';
import { Order } from '../store/useShopStore';

interface OrderDetailsProps {
    order: Order;
    onClose: () => void;
}

export function OrderDetails({ order, onClose }: OrderDetailsProps) {
    const formatStatus = (status: string) => {
        return status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown';
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp * 1000).toLocaleString();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto border border-gray-800 shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-800 p-6 flex justify-between items-center z-10">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Order Details</h2>
                        <p className="text-gray-400 text-sm">ID: {order.order_id}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 space-y-8">
                    {/* Status & Timeline */}
                    <div className="flex flex-wrap gap-4 justify-between items-center bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                        <div>
                            <p className="text-sm text-gray-400">Status</p>
                            <p className="text-lg font-semibold text-white">{formatStatus(order.order_status)}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-400">Created At</p>
                            <p className="text-white">{formatDate(order.created_time)}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-400">Total Amount</p>
                            <p className="text-xl font-bold text-pink-500">{order.currency} {order.order_amount.toFixed(2)}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
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

                                        {order.shipping_info.tracking_number && (
                                            <div className="mt-3 pt-3 border-t border-gray-700">
                                                <p className="text-xs text-gray-500 uppercase">Tracking Info</p>
                                                <p className="text-white font-mono">{order.shipping_info.tracking_number}</p>
                                                <p className="text-sm text-gray-400">
                                                    {order.shipping_info.shipping_provider}
                                                    {order.shipping_info.delivery_option_name ? ` - ${order.shipping_info.delivery_option_name}` : ''}
                                                </p>
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
                            Order Items
                        </h3>
                        <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
                            <table className="w-full">
                                <thead className="bg-gray-900/50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Product</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Price</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Quantity</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {order.line_items.map((item) => (
                                        <tr key={item.id} className="hover:bg-gray-700/30">
                                            <td className="px-6 py-4">
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
                                                        {/* Assuming sku_name might be available in item if we typed it fully, but for now just product name */}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-300">
                                                {order.currency} {item.sale_price}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-300">
                                                {item.quantity}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-white font-medium">
                                                {order.currency} {(parseFloat(item.sale_price) * item.quantity).toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Payment Info */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <CreditCard className="text-pink-500" size={20} />
                            Payment Summary
                        </h3>
                        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                            <div className="space-y-2">
                                <div className="flex justify-between text-gray-400">
                                    <span>Subtotal</span>
                                    <span>{order.currency} {order.payment_info?.sub_total || order.order_amount.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-gray-400">
                                    <span>Shipping Fee</span>
                                    <span>{order.currency} {order.payment_info?.shipping_fee || '0.00'}</span>
                                </div>
                                <div className="flex justify-between text-gray-400">
                                    <span>Tax</span>
                                    <span>{order.currency} {order.payment_info?.tax || '0.00'}</span>
                                </div>
                                <div className="pt-2 border-t border-gray-700 flex justify-between text-white font-bold text-lg">
                                    <span>Total</span>
                                    <span>{order.currency} {order.payment_info?.total_amount || order.order_amount.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
