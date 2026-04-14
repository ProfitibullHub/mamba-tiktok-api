import type { OrderRow } from './orderFinancials.js';

export type OrderForGmv = OrderRow & {
    order_amount?: number | null;
    total_amount?: number | string | null;
    payment_info?: Record<string, string | undefined> | null;
};

/** Mirrors client `calculateOrderGMV` for server-side digest emails. */
export function calculateOrderGMV(order: OrderForGmv): number {
    const fromTotal =
        order.total_amount !== undefined && order.total_amount !== null ? Number(order.total_amount) : NaN;
    const orderAmount =
        order.order_amount != null && !Number.isNaN(Number(order.order_amount))
            ? Number(order.order_amount)
            : !Number.isNaN(fromTotal)
              ? fromTotal
              : 0;
    if (!order.payment_info) {
        return orderAmount;
    }
    const pi = order.payment_info;
    const originalTotalProductPrice = parseFloat(pi.original_total_product_price || '0');
    const platformDiscount = Math.abs(parseFloat(pi.platform_discount || '0'));
    const sellerDiscount = parseFloat(pi.seller_discount || '0');
    const shippingFee = parseFloat(pi.shipping_fee || '0');
    const effectiveSellerDiscount = order.is_sample_order ? 0 : sellerDiscount;
    const gmv = originalTotalProductPrice + shippingFee - Math.abs(effectiveSellerDiscount) - platformDiscount;
    return Number(gmv.toFixed(2));
}
