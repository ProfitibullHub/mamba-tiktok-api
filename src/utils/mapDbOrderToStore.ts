import { Order } from '../store/useShopStore';

/**
 * Maps a raw Supabase `shop_orders` DB row (from Realtime or direct query)
 * into the frontend `Order` type used by useShopStore.
 *
 * DB rows store timestamps as ISO strings; the store expects unix seconds.
 */
export function mapDbOrderToStore(row: any): Order {
    const toUnix = (iso: string | null | undefined): number | undefined => {
        if (!iso) return undefined;
        return Math.floor(new Date(iso).getTime() / 1000);
    };

    const payment = row.payment_info || {};

    return {
        order_id: row.order_id,
        order_status: row.order_status,
        order_amount: parseFloat(payment.total_amount || row.total_amount || '0'),
        currency: payment.currency || row.currency || 'USD',
        created_time: toUnix(row.create_time) || 0,
        update_time: toUnix(row.update_time),
        paid_time: toUnix(row.paid_time),
        line_items: (row.line_items || []).map((item: any) => ({
            id: item.id,
            product_id: item.product_id,
            product_name: item.product_name,
            sku_image: item.sku_image,
            quantity: item.quantity || 1,
            sale_price: item.sale_price,
            original_price: item.original_price,
            seller_sku: item.seller_sku,
            sku_name: item.sku_name,
            is_dangerous_good: item.is_dangerous_good || false,
            is_gift: item.is_gift || false,
        })),
        buyer_info: row.buyer_info,
        shipping_info: row.shipping_info,
        payment_info: payment,
        payment_method_name: row.payment_method_name,
        shipping_type: row.shipping_type,
        delivery_option_id: row.delivery_option_id,
        delivery_option_name: row.delivery_option_name,
        fulfillment_type: row.fulfillment_type || 'FULFILLMENT_BY_SELLER',
        is_fbt: row.is_fbt || false,
        fbt_fulfillment_fee: row.fbt_fulfillment_fee ?? null,
        warehouse_id: row.warehouse_id || null,
        return_status: row.return_status,
        substatus: row.substatus,
        refund_amount: parseFloat(row.refund_amount || '0'),
        return_reason: row.return_reason,
        cancel_reason: row.cancel_reason,
        cancellation_initiator: row.cancellation_initiator,
        is_sample_order: row.is_sample_order,
        collection_time: toUnix(row.collection_time),
        is_cod: row.is_cod || false,
        is_exchange_order: row.is_exchange_order || false,
        is_on_hold_order: row.is_on_hold_order || false,
        is_replacement_order: row.is_replacement_order || false,
        delivery_type: row.delivery_type,
        seller_note: row.seller_note,
        shipping_due_time: toUnix(row.shipping_due_time),
        shipping_provider_id: row.shipping_provider_id,
        shipping_provider: row.shipping_provider,
        tracking_number: row.tracking_number,
    };
}
