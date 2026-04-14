/** Aligns with client `src/utils/orderFinancials.ts` for dashboard email summaries. */

export type OrderRow = {
    order_status?: string | null;
    cancel_reason?: string | null;
    cancellation_initiator?: string | null;
    is_sample_order?: boolean | null;
};

export function isCancelledOrRefunded(order: OrderRow): boolean {
    const st = order.order_status;
    if (st === 'CANCELLED' || st === 'REFUNDED' || st === 'CANCELED') return true;
    if (order.cancel_reason) return true;
    if (order.cancellation_initiator) return true;
    return false;
}
