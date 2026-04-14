import type { Order } from '../store/useShopStore';

/**
 * Orders treated as cancelled/refunded for P&L revenue and COGS exclusion.
 * Aligns with TikTok order lifecycle (status + cancellation signals).
 */
export function isCancelledOrRefunded(order: Order): boolean {
  const st = order.order_status;
  if (st === 'CANCELLED' || st === 'REFUNDED') return true;
  if (st === 'CANCELED') return true; // defensive
  if (order.cancel_reason) return true;
  if (order.cancellation_initiator) return true;
  return false;
}
