import { Order } from '../store/useShopStore';

/**
 * Calculate GMV (Gross Merchandise Value)
 *
 * Formula: GMV = (Price × Items Sold) + Shipping Fees - Seller Discounts - Platform Discounts
 *
 * Where:
 * - Price × Items Sold: Total product price before discounts (original_total_product_price)
 * - Shipping Fees: Shipping charges applied to the order
 * - Seller Discounts: Promotional discounts provided by the seller
 * - Platform Discounts: Co-funded promotional discounts provided by the platform
 *
 * Note: Sales tax is excluded from GMV calculation
 *
 * @param order - Order object with payment_info
 * @returns GMV value as number
 */
export function calculateOrderGMV(order: Order): number {
  const orderAmount = order.order_amount || 0;

  if (!order.payment_info) {
    // No payment_info - return order_amount as-is (best guess)
    return orderAmount;
  }

  // Extract all available payment fields for flexible formula adjustment
  // const currency = order.payment_info.currency || 'USD';
  // const itemInsuranceTax = parseFloat(order.payment_info.item_insurance_tax || '0');
  const originalTotalProductPrice = parseFloat(order.payment_info.original_total_product_price || '0');
  const platformDiscount = Math.abs(parseFloat(order.payment_info.platform_discount || '0'));
  // const productTax = parseFloat(order.payment_info.product_tax || '0');
  const sellerDiscount = parseFloat(order.payment_info.seller_discount || '0');
  const shippingFee = parseFloat(order.payment_info.shipping_fee || '0');
  // const shippingFeeCofundedDiscount = parseFloat(order.payment_info.shipping_fee_cofunded_discount || '0');
  // const shippingFeePlatformDiscount = parseFloat(order.payment_info.shipping_fee_platform_discount || '0');
  // const shippingFeeSellerDiscount = parseFloat(order.payment_info.shipping_fee_seller_discount || '0');
  // const shippingFeeTax = parseFloat(order.payment_info.shipping_fee_tax || '0');
  // const subTotal = parseFloat(order.payment_info.sub_total || '0');
  // const tax = parseFloat(order.payment_info.tax || '0');
  // const totalAmount = parseFloat(order.payment_info.total_amount || '0');

  // GMV Formula: (Price × Items Sold) + Shipping Fees - Seller Discounts - Platform Discounts
  // Note: Sales tax is excluded from GMV
  // For sample orders, we ignore seller discount (which makes it free) so GMV reflects product value
  const effectiveSellerDiscount = order.is_sample_order ? 0 : sellerDiscount;
  const gmv = originalTotalProductPrice + shippingFee - Math.abs(effectiveSellerDiscount) - platformDiscount;

  return Number(gmv.toFixed(2));
}

/**
 * Calculate GMV from product line items.
 *
 * This is useful for product-level GMV tracking and should match
 * the order-level calculation when summed across all line items.
 *
 * For line items, we use: sale_price * quantity
 * (This already represents the price after seller discounts)
 *
 * Note: Platform discounts are order-level, not line-item-level,
 * so they need to be distributed proportionally if needed.
 *
 * @param lineItems - Array of line items from order
 * @returns Total GMV from line items
 */
export function calculateLineItemsGMV(lineItems: Order['line_items']): number {
  return lineItems.reduce((sum, item) => {
    const salePrice = parseFloat(item.sale_price || '0');
    const quantity = item.quantity || 0;
    return sum + (salePrice * quantity);
  }, 0);
}

/**
 * Calculate GMV for multiple orders.
 *
 * @param orders - Array of orders
 * @returns Total GMV across all orders
 */
export function calculateTotalGMV(orders: Order[]): number {
  return Number(orders.reduce((sum, order) => sum + calculateOrderGMV(order), 0).toFixed(2));
}

/**
 * Helper to check if an order has complete payment_info for GMV calculation.
 * Useful for data quality checks and debugging.
 *
 * @param order - Order to check
 * @returns Object with check results
 */
export function validateOrderPaymentInfo(order: Order): {
  isValid: boolean;
  hasOriginalPrice: boolean;
  hasSellerDiscount: boolean;
  hasPlatformDiscount: boolean;
  hasSubtotal: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (!order.payment_info) {
    warnings.push('Missing payment_info entirely');
    return {
      isValid: false,
      hasOriginalPrice: false,
      hasSellerDiscount: false,
      hasPlatformDiscount: false,
      hasSubtotal: false,
      warnings
    };
  }

  const hasOriginalPrice = !!order.payment_info.original_total_product_price;
  const hasSellerDiscount = order.payment_info.seller_discount !== undefined;
  const hasPlatformDiscount = order.payment_info.platform_discount !== undefined;
  const hasSubtotal = !!order.payment_info.subtotal_before_discount_amount || !!order.payment_info.sub_total;

  if (!hasOriginalPrice) {
    warnings.push('Missing original_total_product_price');
  }
  if (!hasSellerDiscount) {
    warnings.push('Missing seller_discount (will default to 0)');
  }
  if (!hasPlatformDiscount) {
    warnings.push('Missing platform_discount (will default to 0)');
  }

  return {
    isValid: hasOriginalPrice || hasSubtotal,
    hasOriginalPrice,
    hasSellerDiscount,
    hasPlatformDiscount,
    hasSubtotal,
    warnings
  };
}

/**
 * Debug utility to analyze GMV calculations and identify discrepancies.
 * Logs detailed breakdown of each order's GMV calculation.
 *
 * @param orders - Array of orders to analyze
 * @returns Detailed breakdown of GMV calculations
 */
export function debugGMVCalculation(orders: Order[]): {
  totalGMV: number;
  totalOrderAmount: number;
  totalTax: number;
  orderCount: number;
  details: Array<{
    order_id: string;
    order_amount: number;
    tax: number;
    product_tax: number;
    shipping_fee_tax: number;
    item_insurance_tax: number;
    shipping_fee: number;
    gmv: number;
    hasPaymentInfo: boolean;
  }>;
} {
  let totalGMV = 0;
  let totalOrderAmount = 0;
  let totalTax = 0;

  const details = orders.map(order => {
    const orderAmount = order.order_amount || 0;
    const gmv = calculateOrderGMV(order);

    const tax = parseFloat(order.payment_info?.tax || '0');
    const product_tax = parseFloat(order.payment_info?.product_tax || '0');
    const shipping_fee_tax = parseFloat(order.payment_info?.shipping_fee_tax || '0');
    const item_insurance_tax = parseFloat(order.payment_info?.item_insurance_tax || '0');
    const shipping_fee = parseFloat(order.payment_info?.shipping_fee || '0');

    totalGMV += gmv;
    totalOrderAmount += orderAmount;
    totalTax += tax;

    return {
      order_id: order.order_id,
      order_amount: orderAmount,
      tax,
      product_tax,
      shipping_fee_tax,
      item_insurance_tax,
      shipping_fee,
      gmv,
      hasPaymentInfo: !!order.payment_info
    };
  });

  return {
    totalGMV,
    totalOrderAmount,
    totalTax,
    orderCount: orders.length,
    details
  };
}
