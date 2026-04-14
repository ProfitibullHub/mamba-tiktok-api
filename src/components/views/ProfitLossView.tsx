import { DollarSign, TrendingUp, TrendingDown, Wallet, PieChart, Percent, AlertTriangle, ChevronDown, ChevronUp, Package, Truck, Receipt, Users, Megaphone, Building2, SlidersHorizontal, RotateCcw, Download, Plus, Trash2, Calendar, Lock, CircleDollarSign } from 'lucide-react';
// Note: LayoutGrid, Layers are used by the View Mode Toggle — re-add to import when uncommenting the toggle
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useShopStore, Order } from '../../store/useShopStore';
import { useTikTokAdsStore } from '../../store/useTikTokAdsStore';
import { DateRangePicker, DateRange } from '../DateRangePicker';
import {
  formatShopDateISO,
  formatShopDateTime,
  getShopDayStartTimestamp,
  getDateRangeFromPreset,
  previousCalendarDayISO,
} from '../../utils/dateUtils';
import { CalculationTooltip } from '../CalculationTooltip';
import { RefreshCw } from 'lucide-react';
import { Account } from '../../lib/supabase';
import { calculateOrderGMV } from '../../utils/gmvCalculations';
import { exportToCSV, exportToExcel, exportToPDF, ExportData } from '../../utils/exportUtils';
import { ManualAffiliateModal } from '../ManualAffiliateModal';
import { ManualAgencyFeeModal } from '../ManualAgencyFeeModal';
import { useShopAccessFlags } from '../../hooks/useShopMutationAccess';
import { isCancelledOrRefunded } from '../../utils/orderFinancials';
import {
  platformFeeKeys,
  affiliateFeeKeys,
  adSpendFeeKeys,
  netByKeys,
  expenseFromNet,
  shippingTotalForOperatingExpenses,
  isPlatformFeeKey,
  isAffiliateCogsFeeKey,
  isAdSpendFeeKey,
} from '../../utils/plFeeAggregation';
import { computeAgencyFeesRollup } from '../../utils/agencyFeeProration';
import { buildTiktokStatementExportRows } from '../../utils/tiktokStatementExportRows';

// Use paid_time for filtering (matches backend which loads by paid_time)
const getOrderTs = (o: Order): number => Number(o.paid_time || o.created_time);

interface ProfitLossViewProps {
  account: Account;
  shopId?: string;
  timezone?: string; // Shop timezone for date calculations
}

// Aggregated P&L data from backend
interface PLData {
  transaction_count: number;
  total_revenue: number;
  total_settlement: number;
  total_shipping_cost: number;
  total_fee_tax: number;
  total_adjustment: number;
  revenue: Record<string, number>;
  fees: Record<string, number>;
  shipping: Record<string, number>;
  taxes: Record<string, number>;
  supplementary: Record<string, number>;
  statement_totals: {
    total_revenue: number;
    total_settlement: number;
    total_fees: number;
    total_adjustments: number;
    total_shipping: number;
    total_net_sales: number;
  };
  meta: {
    total_statements: number;
    statements_with_transactions: number;
    statements_without_transactions: number;
    currency: string;
    has_complete_data: boolean;
  };
}


// Expandable List Item Component
interface ExpandableItemProps {
  icon: React.ReactNode;
  iconBgColor: string;
  title: string;
  subtitle: string;
  value: string;
  valueColor: string;
  tooltip?: {
    source: string;
    calculation: string;
    api: string;
  };
  expandedContent?: React.ReactNode;
  isNegative?: boolean;
}

function ExpandableItem({
  icon,
  iconBgColor,
  title,
  subtitle,
  value,
  valueColor,
  tooltip,
  expandedContent,
  isNegative
}: ExpandableItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border-b border-gray-700 last:border-b-0">
      <div
        className={`flex items-center justify-between py-3 ${expandedContent ? 'cursor-pointer hover:bg-gray-700/30 transition-colors rounded-lg px-2 -mx-2' : ''}`}
        onClick={() => expandedContent && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${iconBgColor} flex items-center justify-center`}>
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-white font-medium">{title}</p>
              {tooltip && (
                <CalculationTooltip
                  source={tooltip.source}
                  calculation={tooltip.calculation}
                  api={tooltip.api}
                />
              )}
              {expandedContent && (
                <span className="text-gray-500">
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400">{subtitle}</p>
          </div>
        </div>
        <p className={`text-xl font-bold ${valueColor}`}>
          {isNegative ? '-' : ''}{value}
        </p>
      </div>

      {isExpanded && expandedContent && (
        <div className="ml-13 pl-4 pb-3 animate-in slide-in-from-top-2 duration-200">
          <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50 ml-10">
            {expandedContent}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Renders a list of key-value rows, filtering out zero values
 */
function BreakdownRows({ items, color = 'text-gray-300' }: { items: { label: string; value: number }[]; color?: string }) {
  const nonZero = items.filter(i => Math.abs(i.value) >= 0.01);
  if (nonZero.length === 0) {
    return <p className="text-gray-500 text-sm">No data in this period</p>;
  }
  return (
    <div className="space-y-2 text-sm">
      {nonZero.map((item, i) => (
        <div key={i} className="flex justify-between">
          <span className="text-gray-400">{item.label}</span>
          <span className={item.value < 0 ? 'text-red-400' : color}>
            {item.value < 0 ? '-' : ''}${Math.abs(item.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      ))}
    </div>
  );
}

// Human-readable labels for fee keys
const FEE_LABELS: Record<string, string> = {
  platform_commission: 'Platform Commission',
  referral_fee: 'Referral Fee',
  transaction_fee: 'Transaction Fee',
  refund_administration_fee: 'Refund Administration Fee',
  credit_card_handling_fee: 'Credit Card Handling Fee',
  affiliate_commission: 'Affiliate Commission',
  affiliate_partner_commission: 'Affiliate Partner Commission',
  affiliate_ads_commission: 'Affiliate Ads Commission',
  sfp_service_fee: 'SFP Service Fee',
  live_specials_fee: 'Live Specials Fee',
  bonus_cashback_service_fee: 'Bonus Cashback Service Fee',
  mall_service_fee: 'Mall Service Fee',
  voucher_xtra_service_fee: 'Voucher Xtra Service Fee',
  flash_sales_service_fee: 'Flash Sales Service Fee',
  cofunded_promotion_service_fee: 'Co-funded Promotion Fee',
  pre_order_service_fee: 'Pre-order Service Fee',
  tsp_commission: 'TSP Commission',
  dt_handling_fee: 'DT Handling Fee',
  epr_pob_service_fee: 'EPR/POB Service Fee',
  seller_paylater_handling_fee: 'PayLater Handling Fee',
  fee_per_item_sold: 'Fee Per Item Sold',
  cofunded_creator_bonus: 'Co-funded Creator Bonus',
  dynamic_commission: 'Dynamic Commission',
  external_affiliate_marketing_fee: 'External Affiliate Marketing',
  tap_shop_ads_commission: 'TAP Shop Ads Commission',
  shipping_fee_guarantee_service_fee: 'Shipping Guarantee Service Fee',
  installation_service_fee: 'Installation Service Fee',
  campaign_resource_fee: 'Campaign Resource Fee',
};

const SHIPPING_LABELS: Record<string, string> = {
  actual_shipping_fee: 'Actual Shipping Fee',
  shipping_fee_discount: 'Shipping Fee Discount',
  customer_paid_shipping_fee: 'Customer Paid Shipping',
  return_shipping_fee: 'Return Shipping Fee',
  replacement_shipping_fee: 'Replacement Shipping Fee',
  exchange_shipping_fee: 'Exchange Shipping Fee',
  signature_confirmation_fee: 'Signature Confirmation Fee',
  shipping_insurance_fee: 'Shipping Insurance Fee',
  fbt_fulfillment_fee_reimbursement: 'FBT Fulfillment Reimbursement',
  return_shipping_label_fee: 'Return Shipping Label Fee',
  seller_self_shipping_service_fee: 'Self-Shipping Service Fee',
  return_shipping_fee_paid_buyer: 'Return Shipping (Buyer Paid)',
  failed_delivery_subsidy: 'Failed Delivery Subsidy',
  shipping_fee_guarantee_reimbursement: 'Shipping Guarantee Reimbursement',
  fbt_free_shipping_fee: 'FBT Free Shipping Fee',
  free_return_subsidy: 'Free Return Subsidy',
  platform_shipping_fee_discount: 'Platform Shipping Discount',
  promo_shipping_incentive: 'Promo Shipping Incentive',
  shipping_fee_subsidy: 'Shipping Fee Subsidy',
  seller_shipping_fee_discount: 'Seller Shipping Discount',
  customer_shipping_fee_offset: 'Customer Shipping Offset',
  fbm_shipping_cost: 'FBM Shipping Cost',
  fbt_shipping_cost: 'FBT Shipping Cost',
  fbt_fulfillment_fee: 'FBT Fulfillment Fee',
  return_refund_subsidy: 'Return Refund Subsidy',
  refunded_customer_shipping_fee: 'Refunded Customer Shipping',
  customer_shipping_fee: 'Customer Shipping Fee',
  refund_customer_shipping_fee: 'Refund Customer Shipping',
};

const PLATFORM_LABELS: Record<string, string> = {
  platform_commission: 'Platform Commission',
  referral_fee: 'Referral Fee',
  transaction_fee: 'Transaction Fee',
  refund_administration_fee: 'Refund Administration Fee',
  credit_card_handling_fee: 'Credit Card Handling Fee',
};

const AFFILIATE_LABELS: Record<string, string> = {
  affiliate_commission: 'Affiliate Commission',
  affiliate_partner_commission: 'Affiliate Partner Commission',
  cofunded_creator_bonus: 'Co-funded Creator Bonus',
  affiliate_ads_commission: 'Affiliate Ads Commission',
  external_affiliate_marketing_fee: 'External Affiliate Marketing Fee',
};

const SERVICE_LABELS: Record<string, string> = {
  flash_sales_service_fee: 'Flash Sales Service Fee',
  payment_processing_fee: 'Payment Processing Fee',
  chargeback_fee: 'Chargeback Fee',
  dispute_fee: 'Dispute Fee',
  customer_service_fee: 'Customer Service Fee',
};

/** Statement `revenue` rollup keys → labels (TikTok settlement transactions). */
const STATEMENT_REVENUE_LABELS: Record<string, string> = {
  subtotal_before_discount: 'Gross sales',
  refund_subtotal_before_discount: 'Gross sales refund',
  seller_discount: 'Seller discount',
  seller_discount_refund: 'Seller discount refund',
  cod_service_fee: 'COD service fee',
  refund_cod_service_fee: 'Refund COD service fee',
};

const STATEMENT_REVENUE_KEY_ORDER = [
  'subtotal_before_discount',
  'refund_subtotal_before_discount',
  'seller_discount',
  'seller_discount_refund',
  'cod_service_fee',
  'refund_cod_service_fee',
] as const;

/** YYYY-MM-DD → DD-MM-YYYY for user-facing copy */
function formatYmdAsDdMmYyyy(ymd: string): string {
  const parts = ymd.split('-').map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${String(y)}`;
}

/** Single calendar day in shop TZ: "Today", "Yesterday", or DD-MM-YYYY */
function labelShopCalendarDay(ymd: string, timezone: string): string {
  const today = formatShopDateISO(Date.now(), timezone);
  const yesterday = previousCalendarDayISO(today, timezone);
  if (ymd === today) return 'Today';
  if (ymd === yesterday) return 'Yesterday';
  return formatYmdAsDdMmYyyy(ymd);
}

/** Range label for sync prompts (same shop timezone as the P&L picker) */
function labelPlDateRangeForSyncPrompt(startDate: string, endDate: string, timezone: string): string {
  if (startDate === endDate) {
    return labelShopCalendarDay(startDate, timezone);
  }
  const a = labelShopCalendarDay(startDate, timezone);
  const b = labelShopCalendarDay(endDate, timezone);
  if (a === b) return a;
  return `${a} – ${b}`;
}

function buildStatementRevenueRows(rev: Record<string, number> | undefined): { label: string; value: number }[] {
  if (!rev) return [];
  const rows: { label: string; value: number }[] = [];
  const seen = new Set<string>();
  for (const k of STATEMENT_REVENUE_KEY_ORDER) {
    const v = rev[k];
    if (v != null && Math.abs(v) >= 0.005) {
      rows.push({
        label: STATEMENT_REVENUE_LABELS[k] || k.replace(/_/g, ' '),
        value: v,
      });
      seen.add(k);
    }
  }
  for (const k of Object.keys(rev).sort()) {
    if (seen.has(k) || Math.abs(rev[k] ?? 0) < 0.005) continue;
    rows.push({
      label: STATEMENT_REVENUE_LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      value: rev[k] ?? 0,
    });
  }
  return rows;
}

export function ProfitLossView({ account, shopId, timezone = 'America/Los_Angeles' }: ProfitLossViewProps) {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    try {
      const preset = localStorage.getItem(`mamba:default_date_preset:${shopId || 'default'}`) || 'today';
      return getDateRangeFromPreset(preset, timezone);
    } catch {
      return getDateRangeFromPreset('today', timezone);
    }
  });

  const applyDateRange = useCallback((r: DateRange) => {
    setDateRange(r);
  }, []);

  // P&L date range is not persisted across refresh (unlike Finance Debug). Reset when shop or timezone changes.
  useEffect(() => {
    try {
      const preset = localStorage.getItem(`mamba:default_date_preset:${shopId || 'default'}`) || 'today';
      setDateRange(getDateRangeFromPreset(preset, timezone));
    } catch {
      setDateRange(getDateRangeFromPreset('today', timezone));
    }
  }, [shopId, timezone]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [expandedHero, setExpandedHero] = useState<'gmv' | 'netSales' | 'netProfit' | null>(null);
  // Shared toggle:  include cancelled orders in financials (synced with OverviewView via localStorage + custom event)
  const [includeCancelledFinancials, setIncludeCancelledFinancials] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(`mamba:view_settings:cancelled_financials:${shopId || 'default'}`);
      return saved !== null ? saved === 'true' : true;
    } catch { return true; }
  });

  // React to toggle changes dispatched from OverviewView in the same tab
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.shopId === (shopId || 'default')) {
        setIncludeCancelledFinancials(detail.value);
      }
    };
    window.addEventListener('mamba:cancelled_financials_changed', handler);
    return () => window.removeEventListener('mamba:cancelled_financials_changed', handler);
  }, [shopId]);

  const products = useShopStore(state => state.products);
  const orders = useShopStore(state => state.orders);
  const dataVersion = useShopStore(state => state.dataVersion);
  const isLoading = useShopStore(state => state.isLoading);
  const syncData = useShopStore(state => state.syncData);
  const cacheMetadata = useShopStore(state => state.cacheMetadata);
  const fetchShopData = useShopStore(state => state.fetchShopData);

  // P&L data from Zustand store (persists across navigations, no flickering)
  const plData = useShopStore(state => state.plData) as PLData | null;
  const plLoading = useShopStore(state => state.plLoading);
  const error = useShopStore(state => state.plError);
  const fetchPLData = useShopStore(state => state.fetchPLData);

  // Manual Affiliate Settlements
  const affiliateSettlements = useShopStore(state => state.finance.affiliateSettlements);
  const fetchAffiliateSettlements = useShopStore(state => state.fetchAffiliateSettlements);
  const deleteAffiliateSettlement = useShopStore(state => state.deleteAffiliateSettlement);
  const [isAffiliateModalOpen, setIsAffiliateModalOpen] = useState(false);

  // Manual Agency Fees
  const agencyFees = useShopStore(state => state.finance.agencyFees);
  const fetchAgencyFees = useShopStore(state => state.fetchAgencyFees);
  const deleteAgencyFee = useShopStore(state => state.deleteAgencyFee);
  const [isAgencyModalOpen, setIsAgencyModalOpen] = useState(false);

  const { canMutateShop, canSyncShop } = useShopAccessFlags(account);

  // TikTok Ads store
  const {
    connected: adsConnected,
    advertiserInfo,
    marketingDaily,
    marketingLoaded,
    loadMarketingFromDB
  } = useTikTokAdsStore();

  const handleSync = async () => {
    if (!shopId || !canSyncShop) return;
    await syncData(account.id, shopId, 'finance');
    // Force refetch after sync
    fetchPLData(account.id, shopId, dateRange.startDate, dateRange.endDate, true, timezone);
    fetchAffiliateSettlements(account.id, shopId, dateRange.startDate, dateRange.endDate);
    fetchAgencyFees(account.id, shopId, dateRange.startDate, dateRange.endDate);
  };

  const handleFullSync = async () => {
    if (!shopId || !canSyncShop) return;
    await syncData(account.id, shopId, 'finance', true); // forceFullSync = true
    // Force refetch after sync
    fetchPLData(account.id, shopId, dateRange.startDate, dateRange.endDate, true, timezone);
    fetchAffiliateSettlements(account.id, shopId, dateRange.startDate, dateRange.endDate);
    fetchAgencyFees(account.id, shopId, dateRange.startDate, dateRange.endDate);
  };

  // Fetch P&L data when params change (store handles caching & dedup)
  useEffect(() => {
    if (shopId) {
      // Load any missing orders data for this date range (smart cache — only fetches what isn't loaded yet)
      fetchShopData(account.id, shopId, { skipSyncCheck: true }, dateRange.startDate, dateRange.endDate);
      fetchPLData(account.id, shopId, dateRange.startDate, dateRange.endDate, false, timezone);
      fetchAffiliateSettlements(account.id, shopId, dateRange.startDate, dateRange.endDate);
      fetchAgencyFees(account.id, shopId, dateRange.startDate, dateRange.endDate);
      // Load synced marketing data from DB if not loaded yet
      if (!marketingLoaded) {
        loadMarketingFromDB(account.id);
      }
    }
  }, [account.id, shopId, dateRange, fetchShopData, fetchPLData, loadMarketingFromDB, marketingLoaded, fetchAffiliateSettlements]);

  // Calculate COGS from orders (useMemo avoids extra re-renders)
  const cogsStats = useMemo(() => {
    let realCogs = 0;
    let realShippingCost = 0;
    let productsWithCogs = 0;
    let productsWithSales = 0;
    const soldProductIds = new Set<string>();

    const startTs = getShopDayStartTimestamp(dateRange.startDate, timezone);
    const endTs = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;

    const validOrders = orders.filter(o => {
      const t = getOrderTs(o);
      const isDate = t >= startTs && t < endTs;
      const isReturned = o.order_status === 'RETURNED' || (o.return_status && o.return_status !== 'None');
      const isSample = o.is_sample_order === true;
      const isCancelled = isCancelledOrRefunded(o);
      return isDate && !isReturned && !isSample && !isCancelled;
    });

    // Calculate sample orders separately
    const sampleOrders = orders.filter(o => {
      const t = getOrderTs(o);
      const isDate = t >= startTs && t < endTs;
      const isReturned = o.order_status === 'RETURNED' || (o.return_status && o.return_status !== 'None');
      const isSample = o.is_sample_order === true;
      return isDate && !isReturned && isSample;
    });

    validOrders.forEach(order => {
      order.line_items.forEach(item => {
        // Find product by SKU or name (for stats and fallback)
        const product = products.find(p =>
          (item.seller_sku && p.skus?.some(s => s.seller_sku === item.seller_sku)) ||
          p.name === item.product_name
        );

        if (product && !soldProductIds.has(product.product_id)) {
          soldProductIds.add(product.product_id);
          productsWithSales++;
          if (product.cogs) productsWithCogs++;
        }

        // Calculate COGS
        // PRIORITY 1: Use Snapshot COGS from Order (Historical Accuracy)
        let itemCogs = (item as any).cogs;
        let itemShippingCost = 0;

        // PRIORITY 2: Fallback to Current Product Catalog COGS
        if (itemCogs === undefined || itemCogs === null) {
          if (product) {
            itemCogs = product.cogs || 0;
            itemShippingCost = product.shipping_cost || 0;
            // Use SKU COGS and shipping if available
            if (item.seller_sku && product.skus) {
              const skuData = product.skus.find(s => s.seller_sku === item.seller_sku);
              if (skuData) {
                if (skuData.cogs) {
                  itemCogs = skuData.cogs;
                }
                if (skuData.shipping_cost) {
                  itemShippingCost = skuData.shipping_cost;
                }
              }
            }
          } else {
            itemCogs = 0;
          }
        }

        realCogs += (Number(itemCogs) * item.quantity);
        realShippingCost += (Number(itemShippingCost) * item.quantity);
      });
    });

    // Calculate sample order metrics
    // Sample Order Value = Quantity × COGS (cost of goods given away)
    let sampleOrderValue = 0;
    const sampleOrderCount = sampleOrders.length;
    const sampleProductsWithCogs = new Set<string>();
    const sampleProductsTotal = new Set<string>();
    const sampleOrdersWithCogs = new Set<string>();
    let totalSampleCogs = 0;

    // Per-SKU breakdown tracking
    const skuBreakdownMap = new Map<string, {
      skuKey: string;
      productName: string;
      skuName: string;
      skuImage: string;
      quantity: number;
      unitCogs: number;
      totalCogs: number;
      orderCount: number;
    }>();

    sampleOrders.forEach(order => {
      let orderHasCogs = false;
      const skusInThisOrder = new Set<string>();

      order.line_items.forEach(item => {
        const quantity = item.quantity || 0;

        // Find the product in catalog
        const product = products.find(p =>
          (item.seller_sku && p.skus?.some(s => s.seller_sku === item.seller_sku)) ||
          p.name === item.product_name
        );

        // Track products
        if (product) {
          sampleProductsTotal.add(product.product_id);
        }

        // Calculate COGS using same priority system as main COGS calculation
        // PRIORITY 1: Use Snapshot COGS from Order (Historical Accuracy)
        let itemCogs = (item as any).cogs;

        // PRIORITY 2: Fallback to Current Product Catalog COGS
        if (itemCogs === undefined || itemCogs === null) {
          if (product) {
            itemCogs = product.cogs || 0;
            // Use SKU COGS if available
            if (item.seller_sku && product.skus) {
              const skuData = product.skus.find(s => s.seller_sku === item.seller_sku);
              if (skuData && skuData.cogs) {
                itemCogs = skuData.cogs;
              }
            }
          } else {
            itemCogs = 0;
          }
        }

        // Track products with COGS
        const cogsValue = Number(itemCogs);
        if (cogsValue > 0 && product) {
          sampleProductsWithCogs.add(product.product_id);
          totalSampleCogs += (cogsValue * quantity);
          orderHasCogs = true; // Mark this order as having COGS
        }

        // Sample Order Value = Quantity × COGS
        // COGS is treated as negative (it's a cost to the business)
        if (cogsValue > 0) {
          sampleOrderValue += (-cogsValue * quantity);
        }

        // Accumulate per-SKU breakdown
        const skuKey = item.seller_sku || item.product_name || 'unknown';
        const existing = skuBreakdownMap.get(skuKey);
        if (existing) {
          existing.quantity += quantity;
          existing.totalCogs += (cogsValue * quantity);
          // Update unitCogs if this item has a better value
          if (cogsValue > 0 && existing.unitCogs === 0) {
            existing.unitCogs = cogsValue;
          }
          if (!skusInThisOrder.has(skuKey)) {
            existing.orderCount += 1;
            skusInThisOrder.add(skuKey);
          }
        } else {
          skuBreakdownMap.set(skuKey, {
            skuKey,
            productName: item.product_name || 'Unknown Product',
            skuName: item.sku_name || '',
            skuImage: item.sku_image || '',
            quantity,
            unitCogs: cogsValue,
            totalCogs: cogsValue * quantity,
            orderCount: 1,
          });
          skusInThisOrder.add(skuKey);
        }
      });

      // Track orders that have at least one product with COGS
      if (orderHasCogs) {
        sampleOrdersWithCogs.add(order.order_id);
      }
    });

    // Sort SKU breakdown by total COGS descending
    const skuBreakdown = Array.from(skuBreakdownMap.values())
      .sort((a, b) => b.totalCogs - a.totalCogs);

    return {
      withCogs: productsWithCogs,
      total: productsWithSales,
      totalCogs: realCogs,
      totalProductShippingCost: realShippingCost,
      sampleOrders: {
        count: sampleOrderCount,
        ordersWithCogs: sampleOrdersWithCogs.size,
        gmv: sampleOrderValue, // Value = Quantity × COGS (negative)
        cogs: Math.abs(sampleOrderValue), // Show absolute value for COGS display
        netValue: sampleOrderValue, // Net value is same as the cost
        productsWithCogs: sampleProductsWithCogs.size,
        totalProducts: sampleProductsTotal.size,
        totalCogsValue: totalSampleCogs,
        skuBreakdown
      }
    };
  }, [products, orders, dateRange, dataVersion, timezone]);

  const formatCurrency = (num: number): string => {
    return `$${Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPercent = (num: number): string => {
    return `${num.toFixed(2)}%`;
  };

  // Computed values - Memoized to prevent re-calculation on every render
  const financials = useMemo(() => {
    const startTs = getShopDayStartTimestamp(dateRange.startDate, timezone);
    const endTs = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;

    // Calculate Gross Sales (GMV) from orders in range.
    // When includeCancelledFinancials is false, cancelled/refunded orders are excluded so
    // grossSalesGMV, refunds, and netRevenue all reflect active orders only.
    const allOrdersInRange = orders.filter(o => {
      const t = getOrderTs(o);
      if (t < startTs || t >= endTs || o.is_sample_order) return false;
      if (!includeCancelledFinancials && isCancelledOrRefunded(o)) return false;
      return true;
    });

    // Calculate Total Order Amount (Gross Revenue including Tax)
    const totalOrderAmount = allOrdersInRange.reduce((sum, o) => {
      // Use total_amount from payment_info if available, otherwise order_amount
      const amount = parseFloat(o.payment_info?.total_amount || o.order_amount?.toString() || '0');
      return sum + amount;
    }, 0);

    // Calculate Total Tax from Orders (and breakdown)
    const taxStats = allOrdersInRange.reduce((acc, o) => {
      acc.totalTax += parseFloat(o.payment_info?.tax || '0');
      acc.totalProductTax += parseFloat(o.payment_info?.product_tax || '0');
      acc.totalShippingTax += parseFloat(o.payment_info?.shipping_fee_tax || '0');
      return acc;
    }, { totalTax: 0, totalProductTax: 0, totalShippingTax: 0 });

    const { totalTax, totalProductTax, totalShippingTax } = taxStats;

    // Calculate GMV components for breakdown display
    const gmvComponents = allOrdersInRange.reduce((acc, o) => {
      acc.originalProductPrice += parseFloat(o.payment_info?.original_total_product_price || '0');
      acc.shippingFees += parseFloat(o.payment_info?.shipping_fee || '0');
      acc.sellerDiscounts += Math.abs(parseFloat(o.payment_info?.seller_discount || '0'));
      acc.platformDiscounts += Math.abs(parseFloat(o.payment_info?.platform_discount || '0'));
      return acc;
    }, { originalProductPrice: 0, shippingFees: 0, sellerDiscounts: 0, platformDiscounts: 0 });

    // Gross GMV = (Price × Items Sold) + Shipping Fees - Seller Discounts - Platform Discounts
    const grossSalesGMV = allOrdersInRange.reduce((sum, o) => sum + calculateOrderGMV(o), 0);

    // Calculate Returns/Refunds from cancelled/refunded orders only
    const refundedOrders = allOrdersInRange.filter(o => isCancelledOrRefunded(o));
    const refunds = refundedOrders.reduce((sum, o) => sum + calculateOrderGMV(o), 0);

    // Net Revenue (Matches Overview GMV) = Gross GMV - Refunds
    const netRevenue = grossSalesGMV - refunds;

    const totalCogs = cogsStats.totalCogs;
    const totalProductShippingCost = cogsStats.totalProductShippingCost;

    // Calculate TikTok Commission (Platform Fees) as baseline, or use actual platform fee net if available
    const platformFeesNet = netByKeys(plData?.fees, platformFeeKeys);
    const platformFeesSum = expenseFromNet(platformFeesNet);
    const tiktokCommission = platformFeesSum > 0 ? platformFeesSum : netRevenue * 0.06;

    // Calculate Automatic Affiliate Commissions (from settlements, netted to handle reversals/refunds)
    const autoAffiliateNet = netByKeys(plData?.fees, affiliateFeeKeys);
    const autoAffiliateCommission = expenseFromNet(autoAffiliateNet);

    // Calculate Manual Affiliate Retainers
    const manualAffiliateRetainers = affiliateSettlements.reduce((sum, s) => sum + Number(s.amount), 0);

    // Total Affiliate Cost (treated as COGS - deducted from revenue to get Gross Profit)
    const totalAffiliateCost = autoAffiliateCommission + manualAffiliateRetainers;

    // Gross Profit = Net Revenue - COGS - Affiliate Commissions (affiliate treated as cost of goods)
    const grossProfit = netRevenue - totalCogs - totalProductShippingCost - totalAffiliateCost;

    // Shipping Costs: prefer settlement transaction shipping net when available (more accurate than order-level estimate)
    const shippingCostsFallbackFromOrders = allOrdersInRange.reduce((sum, o) => {
      const shippingFeeDiscount = parseFloat(o.payment_info?.shipping_fee_seller_discount || '0');
      return sum + Math.abs(shippingFeeDiscount);
    }, 0);
    const shippingCosts = plData?.shipping
      ? shippingTotalForOperatingExpenses(plData.shipping)
      : shippingCostsFallbackFromOrders;

    // Get Ad Spend — use ONLY the synced marketing data (same source as the Marketing Dashboard)
    const shopAdsNet = netByKeys(plData?.fees, adSpendFeeKeys);
    const shopAdsFees = expenseFromNet(shopAdsNet);

    // Marketing Ad Spend (Synced) — from tiktok_ad_spend_daily table, filtered by P&L date range
    // This matches exactly what the Marketing Dashboard shows as "Cost"
    // NOTE: spend_date may include time component, so append T23:59:59 to endDate (same as marketing dashboard)
    const spendEnd = dateRange.endDate + 'T23:59:59';
    const syncedMarketingSpend = marketingDaily
      .filter((d: any) => d.spend_date >= dateRange.startDate && d.spend_date <= spendEnd)
      .reduce((sum: number, d: any) => sum + (parseFloat(d.total_spend) || 0), 0);

    const syncedMarketingConversionValue = marketingDaily
      .filter((d: any) => d.spend_date >= dateRange.startDate && d.spend_date <= spendEnd)
      .reduce((sum: number, d: any) => sum + (parseFloat(d.conversion_value) || 0), 0);

    const adSpend = syncedMarketingSpend;
    const adConversionValue = syncedMarketingConversionValue;
    const adROAS = adSpend > 0 ? adConversionValue / adSpend : 0;

    // Manual agency fees: shop-calendar proration (same timezone as P&L date picker)
    const {
      total: totalAgencyFees,
      lines: agencyFeeLines,
      summaryNotes: agencyFeeSummaryNotes,
    } = computeAgencyFeesRollup(
      agencyFees,
      dateRange.startDate,
      dateRange.endDate,
      timezone,
      { grossSalesGMV, netRevenue, grossProfit }
    );

    // FBT Fulfillment Fees — calculated here so they can be included in shipping for opex
    const totalFbtFees = allOrdersInRange.reduce((sum: number, o: any) => sum + Math.abs(o.fbt_fulfillment_fee || 0), 0);

    // Total Expenses
    // If we have P&L data from backend (Statements), use that as it's the source of truth for all fees
    // Otherwise fall back to estimates
    let realOperatingExpenses = 0;
    let feesBase = 0;
    let shippingBase = 0;

    if (plData && plData.statement_totals) {
      // Use total_fee_tax (from individual transaction data) instead of statement_totals.total_fees
      // (settlement.fee_amount) because both the individual fee breakdown AND total_fee_tax come from
      // the same transaction-level source — so they will be internally consistent.
      // statement_totals.total_fees is a different TikTok API field and can diverge from the transaction sum.
      feesBase = plData.total_fee_tax != null
        ? Math.abs(plData.total_fee_tax)
        : Math.abs(plData.statement_totals.total_fees);
      shippingBase = plData.shipping
        ? shippingTotalForOperatingExpenses(plData.shipping)
        : Math.abs(plData.statement_totals.total_shipping);
      // FBT fulfillment fees are excluded from operating expenses (shown as informational only in dropdown)
      realOperatingExpenses = feesBase + shippingBase - shopAdsFees - autoAffiliateCommission + totalAgencyFees;
    } else {
      // Fallback: Estimates if no statement data
      realOperatingExpenses = tiktokCommission + shippingCosts + totalAgencyFees;
    }

    const heroGmvLines: { label: string; value: number }[] = [
      { label: 'Product price (before discounts)', value: gmvComponents.originalProductPrice },
      { label: 'Shipping fees', value: gmvComponents.shippingFees },
      { label: 'Seller discounts', value: -gmvComponents.sellerDiscounts },
      { label: 'Platform discounts', value: -gmvComponents.platformDiscounts },
    ];

    const heroNetSalesLines = buildStatementRevenueRows(plData?.revenue);

    // Packaging/Supplies (manual input - not available yet, set to 0)
    const packagingSupplies = 0;

    // Calculate taxes sum from plData
    const totalTaxes = plData?.taxes ? Object.values(plData.taxes).reduce((sum, v) => sum + Math.abs(v), 0) : 0;

    // Operating Expenses = platform fees + shipping + agency fees + ad spend (affiliate moved to COGS)
    const totalExpenses = realOperatingExpenses + adSpend;

    // Operating Income = Gross Profit - Operating Expenses
    const netProfit = grossProfit - totalExpenses;

    const heroNetProfitLines: { label: string; value: number; emphasis?: 'subtotal' | 'total' }[] = [
      { label: 'Net revenue (orders, after refunds)', value: netRevenue },
      { label: 'Product COGS', value: -totalCogs },
      { label: 'Product shipping cost', value: -totalProductShippingCost },
      { label: 'Affiliate commissions (auto + manual)', value: -totalAffiliateCost },
      { label: 'Gross profit', value: grossProfit, emphasis: 'subtotal' },
    ];

    if (plData && plData.statement_totals) {
      heroNetProfitLines.push(
        { label: 'Fees (statement transactions)', value: -feesBase },
        { label: 'Shipping (operating)', value: -shippingBase },
        { label: 'Add back: TAP / shop ads in fee rollup', value: shopAdsFees },
        { label: 'Add back: Affiliate in fee rollup', value: autoAffiliateCommission },
        { label: 'Agency fees', value: -totalAgencyFees },
      );
    } else {
      heroNetProfitLines.push(
        { label: 'TikTok commission (estimate)', value: -tiktokCommission },
        { label: 'Shipping (estimate)', value: -shippingCosts },
        { label: 'Agency fees', value: -totalAgencyFees },
      );
    }

    heroNetProfitLines.push(
      { label: 'Marketing ad spend (synced)', value: -adSpend },
      { label: 'Net profit', value: netProfit, emphasis: 'total' },
    );
    const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
    const roi = (totalCogs + totalProductShippingCost + totalAffiliateCost + totalExpenses) > 0 ? (netProfit / (totalCogs + totalProductShippingCost + totalAffiliateCost + totalExpenses)) * 100 : 0;

    // Gross Profit % and Operating Income metrics
    const grossProfitPct = grossMargin; // GP / Net Revenue * 100
    const operatingIncome = netProfit; // Gross Profit - Operating Expenses
    const operatingIncomePct = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;

    // Total units sold (for profitability calculator)
    const totalUnitsSold = allOrdersInRange
      .filter(o => !isCancelledOrRefunded(o))
      .reduce((sum, o) => sum + o.line_items.reduce((s, item) => s + (item.quantity || 0), 0), 0);

      // serviceFees = residual using the same transaction-level base (total_fee_tax) as the
      // individual fee breakdown. This ensures both the total and the itemized rows come from
      // the same data source so they are internally consistent.
      const serviceFeesResidual = plData ? Math.max(0, Math.abs(plData.total_fee_tax ?? plData.statement_totals?.total_fees ?? 0) - platformFeesSum - autoAffiliateCommission - shopAdsFees) : 0;

      let serviceFeeItems: { label: string; value: number }[] = [];
      if (plData && plData.fees) {
        const itemizedServiceFees = Object.keys(plData.fees)
          .filter(k =>
            !isPlatformFeeKey(k) &&
            !isAffiliateCogsFeeKey(k) &&
            !isAdSpendFeeKey(k) &&
            Math.abs(plData.fees[k]) > 0
          )
          .map(k => ({
            label: k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            value: Math.abs(plData.fees[k])
          }))
          .sort((a, b) => b.value - a.value);

        const itemizedSum = itemizedServiceFees.reduce((sum, item) => sum + item.value, 0);
        const diff = serviceFeesResidual - itemizedSum;

        serviceFeeItems = [...itemizedServiceFees];
        if (diff > 0.05) {
          serviceFeeItems.push({
            label: 'Other Uncategorized Fees',
            value: diff
          });
        }
      }

      return {
        totalOrderAmount,
        totalTax,
        totalProductTax,
        totalShippingTax,
        grossSalesGMV,
        refunds,
        netRevenue,
        totalCogs,
        totalProductShippingCost,
        grossProfit,
        tiktokCommission,
        shippingCosts,
        adSpend,
        packagingSupplies,
        totalExpenses,
        netProfit,
        grossMargin,
        roi,
        adConversionValue,
        adROAS,
        // GMV Components
        totalUnitsSold,
        realOperatingExpenses,
        fbtFeesFromOrders: totalFbtFees,
        gmvOriginalProductPrice: gmvComponents.originalProductPrice,
        gmvShippingFees: gmvComponents.shippingFees,
        gmvSellerDiscounts: gmvComponents.sellerDiscounts,
        gmvPlatformDiscounts: gmvComponents.platformDiscounts,
        manualAffiliateRetainers,
        autoAffiliateCommission,
        totalAffiliateCost,
        shopAdsFees,
        totalAgencyFees,
        agencyFeeLines,
        agencyFeeSummaryNotes,
        hasTransactionData: plData?.meta?.has_complete_data || false,
        totalFees: Math.abs(plData?.statement_totals?.total_fees || 0) - shopAdsFees - autoAffiliateCommission,
        totalShipping: Math.abs(plData?.statement_totals?.total_shipping || 0),
        settlementAmount: plData?.statement_totals?.total_settlement || 0,
        statementNetSales: plData?.statement_totals?.total_net_sales ?? 0,
        platformFees: platformFeesSum,
        fbtFees: totalFbtFees,
        serviceFees: serviceFeesResidual,
        serviceFeeItems,
        totalTaxes,
        operatingExpenses: totalExpenses,
        grossProfitPct,
        operatingIncome,
        operatingIncomePct,
        heroGmvLines,
        heroNetSalesLines,
        heroNetProfitLines,
      };
  }, [orders, cogsStats, dateRange, dataVersion, affiliateSettlements, agencyFees, plData, includeCancelledFinancials, marketingDaily, timezone]);

  // Destructure for easier usage in render
  const {
    netRevenue,
    totalCogs,
    totalProductShippingCost,
    grossProfit,
    adSpend,
    totalExpenses,
    totalUnitsSold,
    realOperatingExpenses,
    manualAffiliateRetainers,
    autoAffiliateCommission,
    totalAffiliateCost,
    totalAgencyFees,
    agencyFeeLines,
    agencyFeeSummaryNotes,
  } = financials;

  const handleDeleteRetainer = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canMutateShop) return;
    if (confirm('Are you sure you want to delete this retainer?')) {
      await deleteAffiliateSettlement(id);
    }
  };

  // ═══════════════════ PROFITABILITY CALCULATOR STATE ═══════════════════
  const [calcOpen, setCalcOpen] = useState(false);

  // Slider values (null = not yet initialized from actual data)
  const [simRetailPrice, setSimRetailPrice] = useState<number | null>(null);
  const [simProductCogs, setSimProductCogs] = useState<number | null>(null);
  const [simFulfillmentFees, setSimFulfillmentFees] = useState<number | null>(null);
  const [simAdSpend, setSimAdSpend] = useState<number | null>(null);
  const [simRevenue, setSimRevenue] = useState<number | null>(null);
  const [simUnitsSold, setSimUnitsSold] = useState<number | null>(null);
  const [simSamplingQty, setSimSamplingQty] = useState<number | null>(null);

  // Actual values derived from real data (used as defaults and for delta display)
  const actualValues = useMemo(() => {
    const units = totalUnitsSold || 1;
    return {
      retailPrice: units > 0 ? netRevenue / units : 0,
      productCogs: units > 0 ? (totalCogs + totalProductShippingCost) / units : 0,
      fulfillmentFees: realOperatingExpenses,
      adSpend: adSpend,
      revenue: netRevenue,
      unitsSold: totalUnitsSold,
      samplingQty: cogsStats.sampleOrders.count
    };
  }, [netRevenue, totalCogs, totalProductShippingCost, realOperatingExpenses, adSpend, totalUnitsSold, cogsStats]);

  // Initialize sliders when actual data loads/changes
  useEffect(() => {
    if (netRevenue > 0 || totalUnitsSold > 0) {
      setSimRetailPrice(prev => prev === null ? actualValues.retailPrice : prev);
      setSimProductCogs(prev => prev === null ? actualValues.productCogs : prev);
      setSimFulfillmentFees(prev => prev === null ? actualValues.fulfillmentFees : prev);
      setSimAdSpend(prev => prev === null ? actualValues.adSpend : prev);
      setSimRevenue(prev => prev === null ? actualValues.revenue : prev);
      setSimUnitsSold(prev => prev === null ? actualValues.unitsSold : prev);
      setSimSamplingQty(prev => prev === null ? actualValues.samplingQty : prev);
    }
  }, [actualValues]);

  const resetCalculator = useCallback(() => {
    setSimRetailPrice(actualValues.retailPrice);
    setSimProductCogs(actualValues.productCogs);
    setSimFulfillmentFees(actualValues.fulfillmentFees);
    setSimAdSpend(actualValues.adSpend);
    setSimRevenue(actualValues.revenue);
    setSimUnitsSold(actualValues.unitsSold);
    setSimSamplingQty(actualValues.samplingQty);
  }, [actualValues]);

  // Today / Yesterday quick-select handlers
  const handleTodayClick = useCallback(() => {
    const today = new Date();
    const todayStr = formatShopDateISO(today, timezone);
    applyDateRange({ startDate: todayStr, endDate: todayStr });
  }, [timezone, applyDateRange]);

  const isTodayActive = () => {
    const todayStr = formatShopDateISO(new Date(), timezone);
    return dateRange.startDate === todayStr && dateRange.endDate === todayStr;
  };

  const handleYesterdayClick = useCallback(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatShopDateISO(yesterday, timezone);
    applyDateRange({ startDate: yesterdayStr, endDate: yesterdayStr });
  }, [timezone, applyDateRange]);

  const isYesterdayActive = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatShopDateISO(yesterday, timezone);
    return dateRange.startDate === yesterdayStr && dateRange.endDate === yesterdayStr;
  };

  // Export handler
  const handleExport = useCallback((format: 'csv' | 'excel' | 'pdf') => {
    // Prepare export data
    const exportData: ExportData = {
      headers: ['Metric', 'Value'],
      rows: [
        ['Date Range', `${dateRange.startDate} to ${dateRange.endDate}`],
        ['Shop', account.name],
        ['Export Date', new Date().toLocaleDateString()],
        ['', ''],

        ...buildTiktokStatementExportRows(plData, {
          formatCurrency,
          dateRangeLabel: `${dateRange.startDate} to ${dateRange.endDate}`,
          timezoneLabel: timezone,
        }),

        // ===== MAMBA P&L (orders + statements) ═══
        ['═══ REVENUE (order-based) ═══', ''],
        ['Gross Sales (GMV)', formatCurrency(financials.grossSalesGMV)],
        ['  Original Product Price', formatCurrency(financials.gmvOriginalProductPrice)],
        ['  Shipping Fees', formatCurrency(financials.gmvShippingFees)],
        ['  Seller Discounts', `-${formatCurrency(financials.gmvSellerDiscounts)}`],
        ['  Platform Discounts', `-${formatCurrency(financials.gmvPlatformDiscounts)}`],
        ['Returns & Refunds', `-${formatCurrency(financials.refunds)}`],
        ['Net Revenue', formatCurrency(financials.netRevenue)],
        ['', ''],

        // ===== OPERATING EXPENSES =====
        ['═══ OPERATING EXPENSES ═══', ''],

        // Platform Fees
        ['Platform Fees', `-${formatCurrency(plData?.fees ? platformFeeKeys.reduce((sum, k) => sum + (plData.fees[k] || 0), 0) : 0)}`],
        ...Object.entries(plData?.fees || {})
          .filter(([key]) => isPlatformFeeKey(key))
          .filter(([_, value]) => Math.abs(value) >= 0.01)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .map(([key, value]) => [
            `  ${PLATFORM_LABELS[key] || key.replace(/_/g, ' ')}`,
            `-${formatCurrency(Math.abs(value))}`
          ]),
        ['', ''],

        // Affiliate Fees
        ['Affiliate Fees', `-${formatCurrency(plData?.fees ? affiliateFeeKeys.reduce((sum, k) => sum + (plData.fees[k] || 0), 0) : 0)}`],
        ...Object.entries(plData?.fees || {})
          .filter(([key]) => isAffiliateCogsFeeKey(key))
          .filter(([_, value]) => Math.abs(value) >= 0.01)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .map(([key, value]) => [
            `  ${AFFILIATE_LABELS[key] || key.replace(/_/g, ' ')}`,
            `-${formatCurrency(Math.abs(value))}`
          ]),
        ['', ''],

        // Service Fees
        ['Service Fees', `-${formatCurrency(plData?.fees ? Object.keys(plData.fees).filter(k => !isPlatformFeeKey(k) && !isAffiliateCogsFeeKey(k) && !isAdSpendFeeKey(k)).reduce((sum, k) => sum + (plData.fees[k] || 0), 0) : 0)}`],
        ...Object.entries(plData?.fees || {}).filter(([key]) => !isPlatformFeeKey(key) && !isAffiliateCogsFeeKey(key) && !isAdSpendFeeKey(key)).filter(([_, value]) => Math.abs(value) >= 0.01).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([key, value]) => [`  ${SERVICE_LABELS[key] || key.replace(/_/g, ' ')}`, `-${formatCurrency(Math.abs(value))}`]),
        ['', ''],

        // Shipping Costs
        ['Shipping Costs', `-${formatCurrency(plData ? Math.abs(plData.statement_totals.total_shipping) : 0)}`],
        ...Object.entries(plData?.shipping || {}).filter(([_, value]) => Math.abs(value) >= 0.01).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([key, value]) => [`  ${SHIPPING_LABELS[key] || key.replace(/_/g, ' ')}`, value < 0 ? `-${formatCurrency(Math.abs(value))}` : formatCurrency(value)]),
        ['', ''],



        // Ad Spend
        ['Ad Spend', `-${formatCurrency(financials.adSpend)}`],
        ['', ''],

        // Packaging
        ['Packaging & Supplies', `-${formatCurrency(financials.packagingSupplies)}`],
        ['', ''],

        ['Total Operating Expenses', `-${formatCurrency(financials.totalExpenses)}`],
        ['', ''],

        // FBT Fees (Informational)
        ['FBT (Non-Shipping) Fees', `-${formatCurrency(financials.fbtFeesFromOrders || 0)}`],
        ['  FBT Orders with Fees', orders.filter(o => o.fbt_fulfillment_fee && o.fbt_fulfillment_fee > 0).length.toString()],
        ['', ''],

        // ===== COST OF GOODS SOLD =====
        ['═══ COST OF GOODS SOLD ═══', ''],
        ['Total COGS', `-${formatCurrency(financials.totalCogs)}`],
        ['  Regular Orders COGS', `-${formatCurrency(financials.totalCogs - cogsStats.sampleOrders.totalCogsValue)}`],
        ['  Regular Orders Count', (orders.filter(o => !o.is_sample_order && getOrderTs(o) >= getShopDayStartTimestamp(dateRange.startDate, timezone) && getOrderTs(o) < getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400).length - cogsStats.sampleOrders.count).toString()],
        ['  Regular Orders Units', (financials.totalUnitsSold - cogsStats.sampleOrders.totalProducts).toString()],
        ['  Sample Orders COGS', `-${formatCurrency(cogsStats.sampleOrders.totalCogsValue)}`],
        ['  Sample Orders Count', cogsStats.sampleOrders.count.toString()],
        ['  Sample Orders Units', cogsStats.sampleOrders.totalProducts.toString()],
        ['Gross Profit', formatCurrency(financials.grossProfit)],
        ['Gross Margin', formatPercent(financials.grossMargin)],
        ['', ''],

        // ===== PROFITABILITY =====
        ['═══ PROFITABILITY ═══', ''],
        ['Net Sales (TikTok statements)', formatCurrency(financials.statementNetSales)],
        ['Total Settlement Amount (TikTok)', formatCurrency(financials.settlementAmount)],
        ['Net Profit', formatCurrency(financials.netProfit)],
        ['ROI', formatPercent(financials.roi)],
        ['Ad ROAS', financials.adROAS.toFixed(2) + 'x'],
        ['', ''],

        // ===== ORDER STATISTICS =====
        ['═══ ORDER STATISTICS ═══', ''],
        ['Total Units Sold', financials.totalUnitsSold.toString()],
        ['Regular Orders', (orders.filter(o => !o.is_sample_order && getOrderTs(o) >= getShopDayStartTimestamp(dateRange.startDate, timezone) && getOrderTs(o) < getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400).length - cogsStats.sampleOrders.count).toString()],
        ['Sample Orders', cogsStats.sampleOrders.count.toString()],
        ['FBT Orders', orders.filter(o => o.is_fbt).length.toString()],
        ['Seller Fulfilled Orders', orders.filter(o => !o.is_fbt).length.toString()],
      ]
    };

    const filename = `PL_Statement_${dateRange.startDate}_to_${dateRange.endDate}`;

    switch (format) {
      case 'csv':
        exportToCSV(exportData, `${filename}.csv`);
        break;
      case 'excel':
        exportToExcel(exportData, `${filename}.xlsx`);
        break;
      case 'pdf':
        exportToPDF(
          exportData,
          `${filename}.pdf`,
          'Profit & Loss Statement',
          `${account.name} | ${dateRange.startDate} to ${dateRange.endDate}`
        );
        break;
    }
  }, [dateRange, financials, account.name, cogsStats, plData, orders, timezone]);


  // Simulated P&L calculation
  const simulatedPL = useMemo(() => {
    const rp = simRetailPrice ?? actualValues.retailPrice;
    const cogs = simProductCogs ?? actualValues.productCogs;
    const ff = simFulfillmentFees ?? actualValues.fulfillmentFees;
    const as = simAdSpend ?? actualValues.adSpend;
    const units = simUnitsSold ?? actualValues.unitsSold;
    const sampling = simSamplingQty ?? actualValues.samplingQty;
    const rev = simRevenue ?? actualValues.revenue;

    // Determine simulated revenue:
    // If user changed retail price or units, revenue = price × units
    // Otherwise use the revenue slider value
    const rpChanged = Math.abs(rp - actualValues.retailPrice) > 0.01;
    const unitsChanged = units !== actualValues.unitsSold;
    const simRev = (rpChanged || unitsChanged) ? rp * units : rev;

    const simCogs = cogs * (units + sampling);
    const simGrossProfit = simRev - simCogs;
    const simTotalExpenses = ff + as + (totalAgencyFees || 0);
    const simNetProfit = simGrossProfit - simTotalExpenses;
    const simMargin = simRev > 0 ? (simNetProfit / simRev) * 100 : 0;
    const simGrossMargin = simRev > 0 ? (simGrossProfit / simRev) * 100 : 0;

    // Deltas from actual
    const actualNetProfit = grossProfit - totalExpenses;
    const actualMargin = netRevenue > 0 ? (actualNetProfit / netRevenue) * 100 : 0;

    return {
      revenue: simRev,
      cogs: simCogs,
      grossProfit: simGrossProfit,
      totalExpenses: simTotalExpenses,
      netProfit: simNetProfit,
      margin: simMargin,
      grossMargin: simGrossMargin,
      isProfitable: simNetProfit >= 0,
      // Deltas
      revenueDelta: simRev - netRevenue,
      cogsDelta: simCogs - totalCogs,
      grossProfitDelta: simGrossProfit - grossProfit,
      netProfitDelta: simNetProfit - actualNetProfit,
      marginDelta: simMargin - actualMargin
    };
  }, [simRetailPrice, simProductCogs, simFulfillmentFees, simAdSpend, simRevenue, simUnitsSold, simSamplingQty, actualValues, netRevenue, totalCogs, grossProfit, totalExpenses]);

  // Helper to convert Record<string, number> to array for BreakdownRows
  const recordToItems = (record: Record<string, number> | undefined, labelMap: Record<string, string>) => {
    if (!record) return [];
    return Object.entries(record)
      // Only include fees that are in the labelMap
      .filter(([key, _]) => key in labelMap)
      .filter(([_, value]) => Math.abs(value) >= 0.01)
      .map(([key, value]) => ({
        label: labelMap[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        value: value
      }))
      // Sort by absolute value descending
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  };

  const {
    hasTransactionData,
    totalFees,
    totalShipping,
    platformFees,
    fbtFees,
    serviceFees,
    serviceFeeItems,
    operatingExpenses,
    grossProfitPct,
    operatingIncome,
    operatingIncomePct,
    netProfit,
    heroGmvLines,
    heroNetSalesLines,
    heroNetProfitLines,
    refunds,
  } = financials;

  const toggleHero = useCallback((k: 'gmv' | 'netSales' | 'netProfit') => {
    setExpandedHero(prev => (prev === k ? null : k));
  }, []);

  /** Prompt when TikTok statements are missing, incomplete, or likely stale for this shop/range. */
  const financeDataNotice = useMemo(() => {
    if (!shopId || plLoading || cacheMetadata.isSyncing) return null;
    if (cacheMetadata.shopId !== shopId || cacheMetadata.accountId !== account.id) return null;
    if (error) return null;

    const neverSynced = !cacheMetadata.settlementsLastSynced;

    const totalStatements = plData?.meta?.total_statements ?? 0;
    const noStatementsInRange =
      plData != null &&
      totalStatements === 0 &&
      financials.grossSalesGMV > 1;

    const incompleteStatements =
      plData != null &&
      totalStatements > 0 &&
      plData.meta?.has_complete_data === false;

    const todayShop = formatShopDateISO(Date.now(), timezone);
    const viewingRecentEnd = dateRange.endDate >= todayShop;
    const syncedMs = cacheMetadata.settlementsLastSynced
      ? new Date(cacheMetadata.settlementsLastSynced).getTime()
      : 0;
    const staleMs = 36 * 60 * 60 * 1000;
    const settlementsStale =
      Boolean(cacheMetadata.settlementsLastSynced) &&
      Number.isFinite(syncedMs) &&
      Date.now() - syncedMs > staleMs &&
      viewingRecentEnd;

    if (neverSynced) {
      return {
        kind: 'never' as const,
        title: 'Financial statements not synced yet',
        message:
          'TikTok settlement data has not been downloaded for this shop. Run Sync finance to load statement totals, fees, shipping, and transaction breakdowns for your reports.',
        action: 'sync' as const,
      };
    }
    if (noStatementsInRange) {
      const periodLabel = labelPlDateRangeForSyncPrompt(dateRange.startDate, dateRange.endDate, timezone);
      return {
        kind: 'gap' as const,
        title: `Statement data not synced for ${periodLabel}`,
        message: `There is sales activity in Mamba for ${periodLabel}, but no matching TikTok statements are loaded for that period yet. Run Sync finance to pull statements from TikTok.`,
        action: 'sync' as const,
      };
    }
    if (incompleteStatements) {
      return {
        kind: 'incomplete' as const,
        title: 'Statement details incomplete',
        message:
          'Some settlements are missing full transaction lines. Use Full sync to backfill fee and shipping breakdowns from TikTok.',
        action: 'full' as const,
      };
    }
    if (settlementsStale) {
      return {
        kind: 'stale' as const,
        title: 'Financial data may need a refresh',
        message:
          'Settlement sync is older than 36 hours while you are viewing dates that include today. Sync finance to pick up the latest daily statement from TikTok.',
        action: 'sync' as const,
      };
    }
    return null;
  }, [
    shopId,
    plLoading,
    error,
    plData,
    cacheMetadata.shopId,
    cacheMetadata.accountId,
    cacheMetadata.settlementsLastSynced,
    cacheMetadata.isSyncing,
    account.id,
    financials.grossSalesGMV,
    dateRange.startDate,
    dateRange.endDate,
    timezone,
  ]);

  return (
    <div className="space-y-6">
      {!canMutateShop && (
        <div
          className="flex items-start gap-3 rounded-xl border border-slate-500/30 bg-slate-800/50 px-4 py-3 text-sm text-slate-300"
          role="status"
        >
          <Lock className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" aria-hidden />
          <div>
            <p className="font-medium text-slate-100">Limited editing</p>
            <p className="text-slate-400 mt-0.5">
              {canSyncShop
                ? 'You can use Sync Finance / Full Sync to refresh data from TikTok. You cannot add, edit, or delete manual agency fees or affiliate retainers.'
                : 'You cannot add, edit, or delete manual agency fees or affiliate retainers for this shop.'}
            </p>
          </div>
        </div>
      )}

      {financeDataNotice && (
        <div
          className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm"
          role="status"
        >
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 sm:mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-amber-100">{financeDataNotice.title}</p>
            <p className="text-amber-200/85 mt-1 leading-relaxed">{financeDataNotice.message}</p>
            {cacheMetadata.settlementsLastSynced && financeDataNotice.kind !== 'never' && (
              <p className="text-xs text-amber-200/60 mt-2">
                Last settlement sync:{' '}
                {formatShopDateTime(cacheMetadata.settlementsLastSynced, timezone)}
              </p>
            )}
          </div>
          {canSyncShop && (
            <button
              type="button"
              onClick={() =>
                financeDataNotice.action === 'full' ? handleFullSync() : handleSync()
              }
              disabled={cacheMetadata.isSyncing || isLoading}
              className="shrink-0 px-4 py-2 rounded-lg font-medium text-amber-950 bg-amber-400 hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {financeDataNotice.action === 'full' ? 'Full sync' : 'Sync finance'}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Profit & Loss Statement</h2>
          <p className="text-gray-400">Financial performance and profitability analysis</p>
        </div>
        <div className="flex gap-3 items-center">
          {/* Ads Balance Display */}
          {advertiserInfo && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg mr-2" title="Source: TikTok Business API">
              <div className="p-1 bg-green-500/10 rounded">
                <Wallet className="w-3 h-3 text-green-400" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Ads Balance</span>
                <span className="text-sm font-bold text-white">{formatCurrency(advertiserInfo.balance)}</span>
              </div>
            </div>
          )}
          <button
            onClick={handleSync}
            disabled={!canSyncShop || cacheMetadata.isSyncing || isLoading}
            title={!canSyncShop ? 'You do not have access to sync this shop' : undefined}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw size={20} className={cacheMetadata.isSyncing ? "animate-spin" : ""} />
            <span>{cacheMetadata.isSyncing ? 'Syncing...' : 'Sync Finance'}</span>
          </button>
          <button
            onClick={handleFullSync}
            disabled={!canSyncShop || cacheMetadata.isSyncing || isLoading}
            title={
              !canSyncShop
                ? 'You do not have access to sync this shop'
                : 'Full re-sync: fetches all settlements with complete transaction details (affiliate commissions, platform fees, etc.)'
            }
            className="flex items-center space-x-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            <RotateCcw size={16} className={cacheMetadata.isSyncing ? "animate-spin" : ""} />
            <span>Full Sync</span>
          </button>

          {/* Export Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center space-x-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors"
            >
              <Download size={20} />
              <span>Export</span>
              <ChevronDown size={16} />
            </button>

            {showExportMenu && (
              <div className="absolute right-0 top-full mt-2 w-40 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden">
                <button
                  onClick={() => { handleExport('csv'); setShowExportMenu(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors text-left"
                >
                  <span>CSV</span>
                </button>
                <button
                  onClick={() => { handleExport('excel'); setShowExportMenu(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors text-left"
                >
                  <span>Excel</span>
                </button>
                <button
                  onClick={() => { handleExport('pdf'); setShowExportMenu(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors text-left"
                >
                  <span>PDF</span>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleTodayClick}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border ${isTodayActive()
              ? 'bg-pink-600 hover:bg-pink-700 text-white border-pink-500 shadow-lg shadow-pink-900/20'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white hover:border-gray-600'
              }`}
          >
            <Calendar className={`w-4 h-4 ${isTodayActive() ? 'text-white' : 'text-gray-400'}`} />
            Today
          </button>
          <button
            onClick={handleYesterdayClick}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border ${isYesterdayActive()
              ? 'bg-pink-600 hover:bg-pink-700 text-white border-pink-500 shadow-lg shadow-pink-900/20'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white hover:border-gray-600'
              }`}
          >
            <Calendar className={`w-4 h-4 ${isYesterdayActive() ? 'text-white' : 'text-gray-400'}`} />
            Yesterday
          </button>

          <DateRangePicker value={dateRange} onChange={applyDateRange} />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Loading state - only shown on initial load when no cached data exists */}
      {plLoading && !plData && (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
        </div>
      )}

      {/* Always show content - no plData check needed for order-based calculations */}
      <>

        {/* COGS Warning */}
        {cogsStats.total > 0 && cogsStats.withCogs < cogsStats.total && (
          <div className="bg-gradient-to-r from-orange-500/10 to-amber-500/10 border border-orange-500/30 rounded-xl p-4">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-orange-500/20 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-orange-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-orange-300 font-semibold mb-1">
                  Product Costs (COGS) Required for Accurate Calculations
                </h3>
                <p className="text-gray-400 text-sm mb-3">
                  {cogsStats.total - cogsStats.withCogs} of {cogsStats.total} products with sales are missing COGS data.
                  Your profit calculations are incomplete without this information.
                </p>
                <div className="flex items-center gap-4">
                  <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-orange-500 to-amber-500 h-full transition-all duration-500"
                      style={{ width: `${cogsStats.total > 0 ? (cogsStats.withCogs / cogsStats.total) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-orange-400 text-sm font-medium whitespace-nowrap">
                    {cogsStats.withCogs}/{cogsStats.total} Complete
                  </span>
                </div>
                <p className="text-gray-500 text-xs mt-2">
                  Go to <strong className="text-gray-400">Products</strong> &rarr; Click on a product &rarr; Add COGS (Cost of Goods Sold) for each product
                </p>
              </div>
            </div>
          </div>
        )}

        {cogsStats.total > 0 && cogsStats.withCogs === cogsStats.total && (
          <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl p-3">
            <div className="flex items-center gap-3">
              <div className="p-1.5 bg-green-500/20 rounded-lg">
                <DollarSign className="w-4 h-4 text-green-400" />
              </div>
              <p className="text-green-400 text-sm font-medium">
                All {cogsStats.total} products have COGS data &mdash; Profit calculations are accurate
              </p>
            </div>
          </div>
        )}

        {/* Ad Spend Alert */}
        {/* <div className="bg-gradient-to-r from-yellow-500/10 to-amber-500/10 border border-yellow-500/30 rounded-xl p-4">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-yellow-500/20 rounded-lg">
            <Megaphone className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-yellow-300 font-semibold mb-1">Ad Spend Data Not Available</h3>
            <p className="text-gray-400 text-sm">
              TikTok Ads API integration is required to include ad spend and ad revenue in your P&L.
              Net profit calculations currently exclude advertising costs.
            </p>
          </div>
        </div>
      </div> */}

        {/* ═══════════════════ FULL DETAIL VIEW ═══════════════════ */}
        <>

          {/* Top metrics: GMV, Net Sales, Net Profit (expandable breakdowns) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* GMV Card */}
            <div className="bg-gray-800/60 border border-gray-700 rounded-2xl overflow-hidden">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleHero('gmv')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleHero('gmv');
                  }
                }}
                className="w-full p-6 md:p-8 text-left cursor-pointer hover:bg-gray-800/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                aria-expanded={expandedHero === 'gmv'}
              >
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 bg-blue-500/20 rounded-xl shrink-0">
                      <DollarSign className="w-6 h-6 text-blue-400" />
                    </div>
                    <p className="text-gray-400 text-sm font-semibold uppercase tracking-widest">Gross Merchandise Value</p>
                  </div>
                  <ChevronDown className={`w-5 h-5 shrink-0 text-gray-500 mt-1 transition-transform ${expandedHero === 'gmv' ? 'rotate-180' : ''}`} aria-hidden />
                </div>
                <p className="text-5xl font-bold text-white tracking-tight">{formatCurrency(financials.grossSalesGMV)}</p>
                <p className="text-gray-500 text-sm mt-3">Total revenue generated from all orders · click for breakdown</p>
              </div>
              {expandedHero === 'gmv' && (
                <div className="px-6 md:px-8 pb-6 md:pb-8 pt-0 border-t border-gray-700/80 space-y-2 text-sm">
                  <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">How this total is built (orders in date range)</p>
                  {heroGmvLines.map((row, i) => (
                    <div key={i} className="flex justify-between gap-3">
                      <span className="text-gray-400">{row.label}</span>
                      <span className={`font-mono tabular-nums ${row.value < 0 ? 'text-red-400' : 'text-gray-200'}`}>
                        {row.value < 0 ? '-' : ''}{formatCurrency(Math.abs(row.value))}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-3 pt-2 border-t border-gray-700 mt-2 font-semibold">
                    <span className="text-white">Gross Merchandise Value</span>
                    <span className="font-mono tabular-nums text-white">{formatCurrency(financials.grossSalesGMV)}</span>
                  </div>
                  {refunds > 0.005 && (
                    <>
                      <div className="flex justify-between gap-3 pt-2">
                        <span className="text-gray-400">Refunds (cancelled/refunded orders)</span>
                        <span className="font-mono tabular-nums text-red-400">-{formatCurrency(refunds)}</span>
                      </div>
                      <div className="flex justify-between gap-3 font-medium">
                        <span className="text-gray-300">Net revenue (used downstream)</span>
                        <span className="font-mono tabular-nums text-sky-400">{formatCurrency(netRevenue)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Net Sales Card */}
            <div className="bg-gray-800/60 border border-sky-500/20 rounded-2xl overflow-hidden">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleHero('netSales')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleHero('netSales');
                  }
                }}
                className="w-full p-6 md:p-8 text-left cursor-pointer hover:bg-gray-800/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
                aria-expanded={expandedHero === 'netSales'}
              >
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 bg-sky-500/20 rounded-xl shrink-0">
                      <Receipt className="w-6 h-6 text-sky-400" />
                    </div>
                    <p className="text-gray-400 text-sm font-semibold uppercase tracking-widest truncate">Net Sales</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span onClick={e => e.stopPropagation()} className="inline-flex">
                      <CalculationTooltip
                        source="TikTok Shop settlements"
                        calculation="Sum of net_sales_amount for all statements in the selected date range (synced from TikTok)."
                        api="GET /finance/pl-data → statement_totals.total_net_sales"
                      />
                    </span>
                    <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${expandedHero === 'netSales' ? 'rotate-180' : ''}`} aria-hidden />
                  </div>
                </div>
                <p className="text-5xl font-bold text-sky-400 tracking-tight">{formatCurrency(financials.statementNetSales)}</p>
                <p className="text-gray-500 text-sm mt-3">From statement data (TikTok) · click for breakdown</p>
              </div>
              {expandedHero === 'netSales' && (
                <div className="px-6 md:px-8 pb-6 md:pb-8 pt-0 border-t border-gray-700/80 space-y-2 text-sm">
                  <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">Statement revenue rollups (synced transactions)</p>
                  {heroNetSalesLines.length === 0 ? (
                    <p className="text-gray-500 text-sm">No line-item revenue breakdown in synced data. The total above comes from TikTok settlement <code className="text-gray-400">net_sales_amount</code> per statement.</p>
                  ) : (
                    heroNetSalesLines.map((row, i) => (
                      <div key={i} className="flex justify-between gap-3">
                        <span className="text-gray-400">{row.label}</span>
                        <span className={`font-mono tabular-nums ${row.value < 0 ? 'text-red-400' : 'text-gray-200'}`}>
                          {row.value < 0 ? '-' : ''}{formatCurrency(Math.abs(row.value))}
                        </span>
                      </div>
                    ))
                  )}
                  <div className="flex justify-between gap-3 pt-2 border-t border-gray-700 mt-2 font-semibold">
                    <span className="text-white">Net sales (TikTok statements)</span>
                    <span className="font-mono tabular-nums text-sky-400">{formatCurrency(financials.statementNetSales)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Net Profit Card */}
            <div className={`rounded-2xl overflow-hidden border ${netProfit >= 0 ? 'bg-emerald-900/20 border-emerald-500/30' : 'bg-red-900/20 border-red-500/30'}`}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleHero('netProfit')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleHero('netProfit');
                  }
                }}
                className={`w-full p-6 md:p-8 text-left cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 ${netProfit >= 0 ? 'hover:bg-emerald-900/25 focus-visible:ring-emerald-500/40' : 'hover:bg-red-900/25 focus-visible:ring-red-500/40'}`}
                aria-expanded={expandedHero === 'netProfit'}
              >
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2.5 rounded-xl shrink-0 ${netProfit >= 0 ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
                      {netProfit >= 0
                        ? <TrendingUp className="w-6 h-6 text-emerald-400" />
                        : <TrendingDown className="w-6 h-6 text-red-400" />}
                    </div>
                    <p className="text-gray-400 text-sm font-semibold uppercase tracking-widest">Net Profit</p>
                  </div>
                  <ChevronDown className={`w-5 h-5 shrink-0 text-gray-500 mt-1 transition-transform ${expandedHero === 'netProfit' ? 'rotate-180' : ''}`} aria-hidden />
                </div>
                <p className={`text-5xl font-bold tracking-tight ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {netProfit < 0 ? '-' : ''}{formatCurrency(netProfit)}
                </p>
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  <span className={`text-sm font-medium ${netProfit >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                    {operatingIncomePct.toFixed(1)}% of net revenue
                  </span>
                  <span className="text-gray-600 text-xs">· After COGS, affiliate, and operating expenses · click for math</span>
                </div>
              </div>
              {expandedHero === 'netProfit' && (
                <div className="px-6 md:px-8 pb-6 md:pb-8 pt-0 border-t border-gray-700/50 space-y-2 text-sm">
                  <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">Net profit calculation</p>
                  {heroNetProfitLines.map((row, i) => {
                    const isSub = row.emphasis === 'subtotal';
                    const isTot = row.emphasis === 'total';
                    const neg = row.value < -0.005;
                    const cls = isTot
                      ? 'text-white font-bold text-base pt-2 border-t border-gray-600 mt-1'
                      : isSub
                        ? 'text-white font-semibold pt-2 border-t border-gray-700 mt-1'
                        : '';
                    return (
                      <div key={i} className={`flex justify-between gap-3 ${cls}`}>
                        <span className={isTot || isSub ? 'text-white' : 'text-gray-400'}>{row.label}</span>
                        <span className={`font-mono tabular-nums ${isTot ? (netProfit >= 0 ? 'text-emerald-400' : 'text-red-400') : isSub ? 'text-blue-400' : neg ? 'text-red-400' : row.value > 0.005 ? 'text-emerald-400' : 'text-gray-200'}`}>
                          {row.value < 0 ? '-' : ''}{formatCurrency(Math.abs(row.value))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ═══════════════════ REVENUE SECTION ═══════════════════ */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Revenue</h3>
            <p className="text-gray-500 text-sm mb-4">Breakdown of GMV (Gross Merchandise Value) = (Price × Items Sold) + Shipping Fees - Seller Discounts - Platform Discounts</p>
            <div className="space-y-1">

              {/* Original Product Price (Price × Items Sold) */}
              <ExpandableItem
                icon={<Package className="w-5 h-5 text-white" />}
                iconBgColor="bg-gradient-to-r from-blue-500 to-cyan-500"
                title="Product Price (Before Discounts)"
                subtitle="Price × Items Sold"
                value={formatCurrency(financials.gmvOriginalProductPrice)}
                valueColor="text-blue-400"
                tooltip={{
                  source: "Orders",
                  calculation: "Sum(original_total_product_price)",
                  api: "GET /orders/search"
                }}
              />

              {/* Shipping Fees */}
              <ExpandableItem
                icon={<Truck className="w-5 h-5 text-white" />}
                iconBgColor="bg-gradient-to-r from-purple-500 to-indigo-500"
                title="Shipping Fees"
                subtitle="Total shipping charges"
                value={formatCurrency(financials.gmvShippingFees)}
                valueColor="text-purple-400"
                tooltip={{
                  source: "Orders",
                  calculation: "Sum(shipping_fee)",
                  api: "GET /orders/search"
                }}
              />

              {/* Seller Discounts */}
              {financials.gmvSellerDiscounts > 0 && (
                <ExpandableItem
                  icon={<DollarSign className="w-5 h-5 text-white" />}
                  iconBgColor="bg-gradient-to-r from-orange-500 to-red-500"
                  title="Seller Discounts"
                  subtitle="Promotional discounts by seller"
                  value={formatCurrency(financials.gmvSellerDiscounts)}
                  valueColor="text-orange-400"
                  isNegative
                  tooltip={{
                    source: "Orders",
                    calculation: "Sum(seller_discount)",
                    api: "GET /orders/search"
                  }}
                />
              )}

              {/* Platform Discounts */}
              {financials.gmvPlatformDiscounts > 0 && (
                <ExpandableItem
                  icon={<DollarSign className="w-5 h-5 text-white" />}
                  iconBgColor="bg-gradient-to-r from-pink-500 to-rose-500"
                  title="Platform Discounts"
                  subtitle="Co-funded promotional discounts"
                  value={formatCurrency(financials.gmvPlatformDiscounts)}
                  valueColor="text-pink-400"
                  isNegative
                  tooltip={{
                    source: "Orders",
                    calculation: "Sum(platform_discount)",
                    api: "GET /orders/search"
                  }}
                />
              )}

              {financials.refunds > 0 && (
                <ExpandableItem
                  icon={<DollarSign className="w-5 h-5 text-white" />}
                  iconBgColor="bg-gradient-to-r from-red-500 to-pink-500"
                  title="Returns/Refunds"
                  subtitle="Cancelled and refunded orders (Ex. Tax)"
                  value={formatCurrency(financials.refunds)}
                  valueColor="text-red-400"
                  isNegative
                  tooltip={{
                    source: "Orders",
                    calculation: "Sum of GMV for cancelled/refunded orders",
                    api: "GET /orders/search"
                  }}
                />
              )}

              {/* Total GMV — matches Overview GMV (grossSalesGMV = price + shipping - discounts) */}
              <div className="flex items-center justify-between py-4 bg-green-500/10 rounded-lg px-4 mt-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-bold text-white">Gross Merchandise Value (GMV)</p>
                    <CalculationTooltip
                      source="Calculated"
                      calculation="(Price × Items Sold) + Shipping Fees - Seller Discounts - Platform Discounts"
                      api="Calculated"
                    />
                  </div>
                </div>
                <p className="text-2xl font-bold text-green-400">{formatCurrency(financials.grossSalesGMV)}</p>
              </div>
            </div>
          </div>

          {/* ═══════════════════ OPERATING EXPENSES ═══════════════════ */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Operating Expenses</h3>
            <p className="text-gray-500 text-sm mb-4">
              {hasTransactionData
                ? 'Itemized from statement transaction data'
                : 'Summary from settlement statements - sync to get itemized breakdowns'}
            </p>
            <div className="space-y-1">
              {/* Platform Fees & Commissions */}
              <ExpandableItem
                icon={<Receipt className="w-5 h-5 text-white" />}
                iconBgColor="bg-gradient-to-r from-purple-500 to-pink-500"
                title="Platform Fees"
                subtitle={hasTransactionData ? 'Itemized from transactions' : 'From settlement data'}
                value={formatCurrency(hasTransactionData ? Math.abs(platformFees) : totalFees)}
                valueColor="text-purple-400"
                isNegative
                tooltip={{
                  source: "Statement Transactions",
                  calculation: "Sum(platform_commission + referral_fee + transaction_fee + ...)",
                  api: "GET /finance/pl-data"
                }}
                expandedContent={
                  hasTransactionData ? (
                    <BreakdownRows
                      items={[
                        { label: 'Platform Commission', value: plData?.fees?.platform_commission || 0 },
                        { label: 'Referral Fee', value: plData?.fees?.referral_fee || 0 },
                        { label: 'Transaction Fee', value: plData?.fees?.transaction_fee || 0 },
                        { label: 'Refund Administration Fee', value: plData?.fees?.refund_administration_fee || 0 },
                        { label: 'Credit Card Handling Fee', value: plData?.fees?.credit_card_handling_fee || 0 },
                      ]}
                      color="text-purple-400"
                    />
                  ) : (
                    <p className="text-gray-500 text-sm">Sync finance data to see itemized fee breakdown</p>
                  )
                }
              />

              {/* Agency Fees */}
              <ExpandableItem
                icon={<Building2 className="w-5 h-5 text-white" />}
                iconBgColor="bg-gradient-to-r from-blue-500 to-indigo-500"
                title="Agency Fees"
                subtitle="Manual agency service fees"
                value={formatCurrency(totalAgencyFees)}
                valueColor="text-blue-400"
                isNegative
                tooltip={{
                  source: "Manual Entry (prorated)",
                  calculation: "Retainer: daily share of period amount on each shop-calendar day in range. Commission: % × (GMV | net revenue | gross profit) × active days ÷ range days.",
                  api: "Supabase agency_fees + in-app rollup",
                }}
                expandedContent={
                  <div className="space-y-4">
                    <div className="bg-gray-800 rounded-lg p-3 border border-gray-700 space-y-2">
                      <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">How this is calculated</p>
                      <ul className="text-xs text-gray-400 space-y-1.5 list-disc pl-4 leading-relaxed">
                        {agencyFeeSummaryNotes.map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ul>
                    </div>

                    {agencyFeeLines.length > 0 && (
                      <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 space-y-3">
                        <p className="text-xs font-medium text-gray-300">
                          Amounts for {dateRange.startDate} → {dateRange.endDate}
                        </p>
                        {agencyFeeLines.map((line) => (
                          <div key={line.id} className="border-t border-gray-800 pt-3 first:border-t-0 first:pt-0">
                            <div className="flex justify-between gap-2 items-start">
                              <div>
                                <p className="text-sm font-medium text-white">{line.agencyName}</p>
                                <p className="text-[11px] text-gray-500 mt-0.5">
                                  Starts {line.feeStartDate} · {line.feeType}
                                  {line.feeType !== 'commission' ? ` · ${line.recurrence}` : ''}
                                </p>
                              </div>
                              <span className="text-sm font-semibold text-blue-400 shrink-0">{formatCurrency(line.total)}</span>
                            </div>
                            <ul className="mt-2 space-y-1 text-[11px] text-gray-500 leading-snug">
                              {line.notes.map((n, j) => (
                                <li key={j}>{n}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="bg-gray-800/80 rounded-lg p-3 border border-gray-700">
                      <p className="text-gray-400 text-xs leading-relaxed">
                        These costs reduce net profit after gross profit. Edit definitions below; the card total always reflects proration for the selected range.
                      </p>
                    </div>

                    {/* Manual Agency Fees List */}
                    <div className="border-t border-gray-700 pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-white">Configured fees</h4>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canMutateShop) setIsAgencyModalOpen(true);
                          }}
                          disabled={!canMutateShop}
                          title={!canMutateShop ? 'Read-only for your role' : undefined}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 active:bg-blue-500/30 rounded-lg transition-colors border border-blue-500/20 disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <Plus size={14} />
                          Add Fee
                        </button>
                      </div>

                      {agencyFees.length === 0 ? (
                        <p className="text-gray-500 text-xs italic">No manual agency fees on file for this shop (through {dateRange.endDate}).</p>
                      ) : (
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                          {agencyFees.map((fee) => {
                            const rolled = agencyFeeLines.find((l) => l.id === fee.id);
                            const periodAmt = rolled?.total ?? 0;
                            return (
                              <div key={fee.id} className="flex items-center justify-between bg-gray-900/50 p-2 rounded border border-gray-800 gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm text-gray-300 font-medium truncate">{fee.agency_name}</p>
                                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                                    <span>Starts {fee.date}</span>
                                    {fee.description && (
                                      <>
                                        <span>•</span>
                                        <span className="truncate max-w-[140px]">{fee.description}</span>
                                      </>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-gray-600 mt-1">
                                    This range: <span className="text-blue-400/90">{formatCurrency(periodAmt)}</span>
                                    {fee.fee_type !== 'commission' &&
                                      Number(fee.retainer_amount ?? fee.amount ?? 0) > 0 && (
                                      <span className="text-gray-600">
                                        {' '}
                                        · retainer config ${Number(fee.retainer_amount ?? fee.amount).toFixed(2)}
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!canMutateShop) return;
                                      if (confirm('Are you sure you want to delete this agency fee?')) {
                                        deleteAgencyFee(fee.id);
                                      }
                                    }}
                                    disabled={!canMutateShop}
                                    title={!canMutateShop ? 'Read-only for your role' : 'Delete Fee'}
                                    className="text-gray-600 hover:text-red-400 transition-colors p-1 disabled:opacity-30 disabled:pointer-events-none"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                }
              />

              {/* Ad Spend / Marketing (always visible so total adds up) */}
              <ExpandableItem
                icon={<Megaphone className="w-5 h-5 text-white" />}
                iconBgColor={adSpend > 0
                  ? "bg-gradient-to-r from-orange-500 to-red-500"
                  : "bg-gradient-to-r from-gray-600 to-gray-500"}
                title="Marketing / Ad Spend"
                subtitle={adsConnected
                  ? `TikTok Ads API + Shop Settlement Deductions`
                  : "TikTok advertising costs (connect Ads account to populate)"}
                value={formatCurrency(adSpend)}
                valueColor={adSpend > 0 ? "text-orange-400" : "text-gray-500"}
                isNegative={adSpend > 0}
                tooltip={{
                  source: adsConnected ? "TikTok Business API + Shop Settlements" : "Not Available",
                  calculation: "Marketing API Spend + Shop Ads Fees (TAP from settlements); affiliate ads commission is in Affiliate COGS",
                  api: "GET /tiktok-ads/spend + GET /finance/pl-data"
                }}
                expandedContent={
                  adsConnected && adSpend > 0 ? (
                    <BreakdownRows
                      items={[
                        { label: 'TikTok Ads API Spend', value: financials.adSpend - financials.shopAdsFees },
                        ...adSpendFeeKeys
                          .filter(k => Math.abs(plData?.fees?.[k] || 0) >= 0.01)
                          .map(k => ({
                            label: FEE_LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                            value: Math.abs(plData?.fees?.[k] || 0)
                          }))
                      ]}
                      color="text-orange-400"
                    />
                  ) : (
                    <p className="text-gray-400 text-sm">Connect your TikTok Ads account in the Marketing tab to include ad spend in your P&L.</p>
                  )
                }
              />

              {/* Service Fees */}
              {serviceFees > 0 && (
                <ExpandableItem
                  icon={<DollarSign className="w-5 h-5 text-white" />}
                  iconBgColor="bg-gradient-to-r from-indigo-500 to-purple-500"
                  title="Service Fees"
                  subtitle="TikTok service and promotion fees"
                  value={formatCurrency(serviceFees)}
                  valueColor="text-indigo-400"
                  isNegative
                  tooltip={{
                    source: "Statement Transactions",
                    calculation: "Sum(all service fees)",
                    api: "GET /finance/pl-data"
                  }}
                  expandedContent={
                    serviceFeeItems.length > 0 ? (
                      <BreakdownRows
                        items={serviceFeeItems}
                        color="text-indigo-400"
                      />
                    ) : (
                      <p className="text-gray-400 text-sm">No detailed itemization available for these service fees.</p>
                    )
                  }
                />
              )}

              {/* Shipping Costs (includes FBT Fulfillment Fees) */}
              <ExpandableItem
                icon={<Truck className="w-5 h-5 text-white" />}
                iconBgColor={totalShipping > 0
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500'
                  : 'bg-gradient-to-r from-gray-600 to-gray-500'}
                title="Shipping Costs"
                subtitle={`${hasTransactionData ? 'Itemized shipping breakdown' : 'From settlement data'} (excl. FBT)`}
                value={totalShipping > 0 ? formatCurrency(totalShipping) : '$0.00'}
                valueColor={totalShipping > 0 ? 'text-cyan-400' : 'text-gray-500'}
                isNegative={totalShipping > 0}
                tooltip={{
                  source: "Statement Transactions",
                  calculation: "Sum(shipping_cost_amount) — FBT fees shown for reference only, excluded from OpEx",
                  api: "GET /finance/pl-data"
                }}
                expandedContent={
                  <div className="space-y-1">
                    {hasTransactionData ? (
                      <BreakdownRows
                        items={recordToItems(plData?.shipping, SHIPPING_LABELS)}
                        color="text-cyan-400"
                      />
                    ) : (
                      <p className="text-gray-500 text-sm">Sync finance data to see itemized shipping breakdown</p>
                    )}
                    {/* Shipping subtotal (included in OpEx) */}
                    {totalShipping > 0 && (
                      <div className="flex justify-between text-xs text-gray-400 pt-1 border-t border-gray-700/50 mt-2">
                        <span>Shipping subtotal (in OpEx)</span>
                        <span>{formatCurrency(totalShipping)}</span>
                      </div>
                    )}
                    {/* FBT fees — shown for reference, excluded from OpEx calculation */}
                    {fbtFees > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-700">
                        <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">FBT Fees (excluded from OpEx)</p>
                        <div className="flex justify-between text-sm opacity-50">
                          <span className="line-through text-gray-400">FBT Fulfillment Fee</span>
                          <span className="line-through text-gray-400">{formatCurrency(fbtFees)}</span>
                        </div>
                        <p className="text-gray-600 text-xs mt-1 line-through">
                          From {orders.filter((o: any) => o.fbt_fulfillment_fee && o.fbt_fulfillment_fee > 0).length} FBT orders
                        </p>
                        <div className="flex justify-between text-xs text-gray-500 pt-2 mt-1 border-t border-gray-700/50">
                          <span>Total incl. FBT (reference only)</span>
                          <span>{formatCurrency(totalShipping + fbtFees)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                }
              />


              {/* Total Operating Expenses */}
              <div className="flex items-center justify-between py-4 bg-red-500/10 rounded-lg px-4 mt-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-red-500 to-pink-500 flex items-center justify-center">
                    <TrendingDown className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-bold text-white">Total Operating Expenses</p>
                      <CalculationTooltip
                        source="Calculated"
                        calculation="Platform Fees + Service Fees + Shipping + Marketing/Ad Spend + Agency Fees"
                        api="Calculated"
                      />
                    </div>
                    <p className="text-xs text-gray-400">Platform, service fees + Shipping (excl. FBT) + Marketing + Agency (excludes Affiliate COGS, FBT & Taxes)</p>
                  </div>
                </div>
                <p className="text-2xl font-bold text-red-400">-{formatCurrency(operatingExpenses)}</p>
              </div>

              {/* Operating Income */}
              <div className="flex items-center justify-between py-4 bg-emerald-500/10 rounded-lg px-4 mt-2">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${operatingIncome >= 0 ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-gradient-to-r from-red-500 to-pink-500'} flex items-center justify-center`}>
                    {operatingIncome >= 0 ? <TrendingUp className="w-5 h-5 text-white" /> : <TrendingDown className="w-5 h-5 text-white" />}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-bold text-white">Operating Income</p>
                    <CalculationTooltip
                      source="Calculated"
                      calculation="Gross Profit - Operating Expenses"
                      api="Calculated"
                    />
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-2xl font-bold ${operatingIncome >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {operatingIncome < 0 ? '-' : ''}{formatCurrency(operatingIncome)}
                  </p>
                  <p className={`text-sm font-medium ${operatingIncome >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                    {formatPercent(operatingIncomePct)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ═══════════════════ COST OF GOODS SOLD ═══════════════════ */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Cost of Goods Sold</h3>
            <p className="text-gray-500 text-sm mb-4">Your product costs (manually entered per product)</p>
            <div className="space-y-1">
              <ExpandableItem
                icon={<Package className="w-5 h-5 text-white" />}
                iconBgColor={cogsStats.withCogs === cogsStats.total && cogsStats.total > 0
                  ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                  : 'bg-gradient-to-r from-orange-500 to-red-500'}
                title="Product Costs (COGS)"
                subtitle={cogsStats.total > 0
                  ? (cogsStats.withCogs > 0
                    ? `${cogsStats.withCogs}/${cogsStats.total} products with COGS`
                    : 'No COGS data set - add COGS to products')
                  : 'No products with sales found'}
                value={cogsStats.withCogs > 0 ? formatCurrency(totalCogs) : '$0.00'}
                valueColor={cogsStats.withCogs > 0 ? 'text-orange-400' : 'text-gray-500'}
                tooltip={{
                  source: "Product Catalog",
                  calculation: "Sum(product.cogs x quantity_sold)",
                  api: "Manual input on products"
                }}
                expandedContent={
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Products with COGS</span>
                      <span className="text-green-400">{cogsStats.withCogs}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Products missing COGS</span>
                      <span className="text-orange-400">{cogsStats.total - cogsStats.withCogs}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Total Products with Sales</span>
                      <span className="text-white">{cogsStats.total}</span>
                    </div>
                    <div className="border-t border-gray-700 pt-2 flex justify-between font-medium">
                      <span className="text-white">Calculated COGS</span>
                      <span className="text-orange-400">{formatCurrency(totalCogs)}</span>
                    </div>
                    <p className="text-gray-500 text-xs">Go to Products &rarr; Click product &rarr; Add COGS value</p>
                  </div>
                }
              />

              {/* Affiliate Commissions (COGS) */}
              <ExpandableItem
                icon={<Users className="w-5 h-5 text-white" />}
                iconBgColor="bg-gradient-to-r from-pink-500 to-rose-500"
                title="Affiliate Commissions"
                subtitle="Commissions paid to affiliates & creators (Auto + Manual) — treated as COGS"
                value={formatCurrency(totalAffiliateCost)}
                valueColor="text-pink-400"
                isNegative
                tooltip={{
                  source: "Statement Transactions + Manual",
                  calculation: "Auto Commissions + Manual Retainers",
                  api: "GET /finance/pl-data"
                }}
                expandedContent={
                  <div className="space-y-4">
                    <BreakdownRows
                      items={[
                        ...(plData?.fees
                          ? affiliateFeeKeys
                            .filter(k => Math.abs(plData.fees[k] || 0) >= 0.01)
                            .map(k => ({
                              label: AFFILIATE_LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                              value: Math.abs(plData.fees[k] || 0)
                            }))
                          : [{ label: 'Automatic Commission (TikTok)', value: autoAffiliateCommission }]
                        ),
                        { label: 'Manual Retainers', value: manualAffiliateRetainers },
                      ]}
                      color="text-pink-400"
                    />

                    {/* Manual Retainers List */}
                    <div className="mt-4 border-t border-gray-700 pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-white">Manual Retainers</h4>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canMutateShop) setIsAffiliateModalOpen(true);
                          }}
                          disabled={!canMutateShop}
                          title={!canMutateShop ? 'Read-only for your role' : undefined}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 active:bg-pink-500/30 rounded-lg transition-colors border border-pink-500/20 disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <Plus size={14} />
                          Add Retainer
                        </button>
                      </div>

                      {affiliateSettlements.length === 0 ? (
                        <p className="text-gray-500 text-xs italic">No manual retainers for this period.</p>
                      ) : (
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                          {affiliateSettlements.map(settlement => (
                            <div key={settlement.id} className="flex items-center justify-between bg-gray-900/50 p-2 rounded border border-gray-800">
                              <div>
                                <p className="text-sm text-gray-300 font-medium">{settlement.affiliate_name}</p>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                  <span>{settlement.date}</span>
                                  {settlement.description && (
                                    <>
                                      <span>•</span>
                                      <span className="truncate max-w-[150px]">{settlement.description}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-pink-400 text-sm font-medium">{formatCurrency(settlement.amount)}</span>
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteRetainer(settlement.id, e)}
                                  disabled={!canMutateShop}
                                  title={!canMutateShop ? 'Read-only for your role' : 'Delete Retainer'}
                                  className="text-gray-600 hover:text-red-400 transition-colors p-1 disabled:opacity-30 disabled:pointer-events-none"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                }
              />

              {/* Gross Profit */}
              <div className="flex items-center justify-between py-4 bg-blue-500/10 rounded-lg px-4 mt-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 flex items-center justify-center">
                    <Wallet className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-bold text-white">Gross Profit</p>
                    <CalculationTooltip
                      source="Calculated"
                      calculation="Net Revenue - COGS - Affiliate Commissions"
                      api="Calculated"
                    />
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-2xl font-bold ${grossProfit >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                    {grossProfit < 0 ? '-' : ''}{formatCurrency(grossProfit)}
                  </p>
                  <p className={`text-sm font-medium ${grossProfit >= 0 ? 'text-blue-400/70' : 'text-red-400/70'}`}>
                    {formatPercent(grossProfitPct)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ═══════════════════ SAMPLE ORDERS ═══════════════════ */}
          <div className="bg-gray-800 rounded-xl border border-blue-500/30 p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Sample Orders</h3>
            <p className="text-gray-500 text-sm mb-4">Orders marked as samples (excluded from P&L calculations)</p>

            {cogsStats.sampleOrders.count === 0 ? (
              <div className="bg-blue-500/10 rounded-lg p-4 border border-blue-500/30">
                <p className="text-blue-300 text-sm text-center">
                  No sample orders found in this date range
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <ExpandableItem
                  icon={<Package className="w-5 h-5 text-white" />}
                  iconBgColor="bg-gradient-to-r from-blue-500 to-cyan-500"
                  title="Sample Order Count"
                  subtitle={`${cogsStats.sampleOrders.count} sample order${cogsStats.sampleOrders.count !== 1 ? 's' : ''} across ${cogsStats.sampleOrders.skuBreakdown.length} SKU${cogsStats.sampleOrders.skuBreakdown.length !== 1 ? 's' : ''}`}
                  value={cogsStats.sampleOrders.count.toString()}
                  valueColor="text-blue-400"
                  tooltip={{
                    source: "Orders",
                    calculation: "Count(orders where is_sample_order=true)",
                    api: "GET /orders/search"
                  }}
                  expandedContent={
                    cogsStats.sampleOrders.skuBreakdown.length > 0 ? (
                      <div className="space-y-2 text-sm">
                        {/* Header */}
                        <div className="flex items-center gap-3 text-xs text-gray-500 uppercase tracking-wider pb-1 border-b border-gray-700">
                          <span className="flex-1">Product / SKU</span>
                          <span className="w-12 text-center">Qty</span>
                          <span className="w-20 text-right">Unit COGS</span>
                          <span className="w-20 text-right">Total</span>
                        </div>
                        {/* SKU rows */}
                        {cogsStats.sampleOrders.skuBreakdown.map(sku => (
                          <div key={sku.skuKey} className="flex items-center gap-3 py-1.5">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {sku.skuImage ? (
                                <img src={sku.skuImage} alt="" className="w-7 h-7 rounded object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-7 h-7 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
                                  <Package className="w-3.5 h-3.5 text-gray-500" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-white truncate text-xs">{sku.productName}</p>
                                {sku.skuName && (
                                  <p className="text-gray-500 truncate text-xs">{sku.skuName}</p>
                                )}
                              </div>
                            </div>
                            <span className="w-12 text-center text-white font-medium">x{sku.quantity}</span>
                            <span className={`w-20 text-right ${sku.unitCogs > 0 ? 'text-orange-400' : 'text-gray-600'}`}>
                              {sku.unitCogs > 0 ? formatCurrency(sku.unitCogs) : 'N/A'}
                            </span>
                            <span className={`w-20 text-right font-medium ${sku.totalCogs > 0 ? 'text-red-400' : 'text-gray-600'}`}>
                              {sku.totalCogs > 0 ? formatCurrency(sku.totalCogs) : '-'}
                            </span>
                          </div>
                        ))}
                        {/* Footer total */}
                        <div className="flex items-center gap-3 pt-2 border-t border-gray-700 font-medium">
                          <span className="flex-1 text-white">Total</span>
                          <span className="w-12 text-center text-white">
                            x{cogsStats.sampleOrders.skuBreakdown.reduce((sum, s) => sum + s.quantity, 0)}
                          </span>
                          <span className="w-20"></span>
                          <span className="w-20 text-right text-red-400">
                            {formatCurrency(cogsStats.sampleOrders.totalCogsValue)}
                          </span>
                        </div>
                      </div>
                    ) : undefined
                  }
                />

                <ExpandableItem
                  icon={<DollarSign className="w-5 h-5 text-white" />}
                  iconBgColor="bg-gradient-to-r from-red-500 to-orange-500"
                  title="Sample Order Value"
                  subtitle="Cost of goods given away (Quantity × COGS)"
                  value={`${cogsStats.sampleOrders.gmv < 0 ? '-' : ''}${formatCurrency(cogsStats.sampleOrders.gmv)}`}
                  valueColor="text-red-400"
                  tooltip={{
                    source: "Orders & Products",
                    calculation: "Value = Quantity × COGS (negative because it's a cost)",
                    api: "GET /orders/search + product.cogs"
                  }}
                  expandedContent={
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Total Sample Orders</span>
                        <span className="text-white">{cogsStats.sampleOrders.count}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Orders with COGS set</span>
                        <span className="text-green-400">{cogsStats.sampleOrders.ordersWithCogs}</span>
                      </div>
                      <div className="border-t border-gray-700 pt-2 flex justify-between font-medium">
                        <span className="text-white">Sample Order Value (Cost)</span>
                        <span className="text-red-400">
                          {cogsStats.sampleOrders.gmv < 0 ? '-' : ''}{formatCurrency(cogsStats.sampleOrders.gmv)}
                        </span>
                      </div>
                    </div>
                  }
                />

                {/* Note about exclusion */}
                <div className="mt-4 bg-blue-500/10 rounded-lg p-4 border border-blue-500/30">
                  <p className="text-blue-300 text-sm">
                    <strong>Note:</strong> Sample orders are excluded from all P&L calculations including Revenue, COGS, and Net Profit to provide accurate financial reporting.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ═══════════════════ PROFITABILITY SUMMARY ═══════════════════ */}
          <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-6">Profitability Summary</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
              {/* GMV */}
              <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
                <div className="flex items-center gap-3 mb-3">
                  <DollarSign className="w-5 h-5 text-blue-400" />
                  <p className="text-gray-400 text-sm font-medium">GMV</p>
                </div>
                <p className="text-2xl font-bold text-blue-400">{formatCurrency(financials.grossSalesGMV)}</p>
                <p className="text-xs text-gray-500 mt-1">Gross Merchandise Value</p>
              </div>

              {/* Net sales (statement) */}
              <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Receipt className="w-5 h-5 text-sky-400 shrink-0" />
                    <p className="text-gray-400 text-sm font-medium truncate">Net Sales</p>
                  </div>
                  <CalculationTooltip
                    source="TikTok Shop settlements"
                    calculation="Sum of net_sales_amount for all statements in the selected date range (synced from TikTok)."
                    api="GET /finance/pl-data → statement_totals.total_net_sales"
                  />
                </div>
                <p className="text-2xl font-bold text-sky-400">{formatCurrency(financials.statementNetSales)}</p>
                <p className="text-xs text-gray-500 mt-1">From statement data (TikTok)</p>
              </div>

              {/* Total settlement amount */}
              <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <CircleDollarSign className="w-5 h-5 text-violet-400 shrink-0" />
                    <p className="text-gray-400 text-sm font-medium truncate">Total Settlement</p>
                  </div>
                  <CalculationTooltip
                    source="TikTok Shop settlements"
                    calculation="Sum of statement settlement amounts for the date range. Uses settlement_data.settlement_amount from the Finance API when present (matches Seller Center); otherwise transaction summary or net_amount."
                    api="GET /finance/pl-data → statement_totals.total_settlement"
                  />
                </div>
                <p className="text-2xl font-bold text-violet-400">{formatCurrency(financials.settlementAmount)}</p>
                <p className="text-xs text-gray-500 mt-1">Settlement amount (TikTok)</p>
              </div>

              {/* Gross Profit */}
              <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Wallet className="w-5 h-5 text-amber-400 shrink-0" />
                    <p className="text-gray-400 text-sm font-medium truncate">Gross Profit</p>
                  </div>
                  <CalculationTooltip
                    source="Calculated in app"
                    calculation="Net Revenue − Product COGS − Product Shipping Cost (your data) − Affiliate Commissions (COGS)"
                    api="TikTok API: none (computed from orders + statement fee rollups)"
                  />
                </div>
                <p className={`text-2xl font-bold ${financials.grossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {financials.grossProfit < 0 ? '-' : ''}{formatCurrency(financials.grossProfit)}
                </p>
                <p className="text-xs text-gray-500 mt-1">Profit after COGS & affiliate commissions</p>
              </div>

              {/* Gross Margin */}
              <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Percent className="w-5 h-5 text-cyan-400 shrink-0" />
                    <p className="text-gray-400 text-sm font-medium truncate">Gross Margin</p>
                  </div>
                  <CalculationTooltip
                    source="Calculated in app"
                    calculation="(Gross Profit ÷ Net Revenue) × 100 — 0% when Net Revenue is 0"
                    api="TikTok API: none (computed)"
                  />
                </div>
                <p className={`text-2xl font-bold ${financials.grossMargin >= 20 ? 'text-emerald-400' : financials.grossMargin >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {financials.grossMargin.toFixed(1)}%
                </p>
                <p className="text-xs text-gray-500 mt-1">Gross Profit ÷ Net Revenue</p>
              </div>

              {/* Net Profit $ */}
              <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
                <div className="flex items-center gap-3 mb-3">
                  {netProfit >= 0 ? (
                    <TrendingUp className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-red-400" />
                  )}
                  <p className="text-gray-400 text-sm font-medium">Net Profit</p>
                </div>
                <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {netProfit < 0 ? '-' : ''}{formatCurrency(netProfit)}
                </p>
                <p className="text-xs text-gray-500 mt-1">Net revenue after all expenses</p>
              </div>

              {/* Net Profit % */}
              <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
                <div className="flex items-center gap-3 mb-3">
                  <PieChart className="w-5 h-5 text-emerald-400" />
                  <p className="text-gray-400 text-sm font-medium">Net Profit %</p>
                </div>
                <p className={`text-2xl font-bold ${operatingIncomePct >= 10 ? 'text-green-400' : operatingIncomePct >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {operatingIncomePct.toFixed(1)}%
                </p>
                <p className="text-xs text-gray-500 mt-1">Net Profit ÷ Net Revenue</p>
              </div>

            </div>
          </div>

          {/* ═══════════════════ PROFITABILITY CALCULATOR ═══════════════════ */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            {/* Header — always visible */}
            <button
              onClick={() => setCalcOpen(!calcOpen)}
              className="w-full flex items-center justify-between p-6 hover:bg-gray-750 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-lg">
                  <SlidersHorizontal className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-semibold text-white">Profitability Calculator</h3>
                  <p className="text-sm text-gray-400">Adjust variables to find your break-even & profit targets</p>
                </div>
              </div>
              {calcOpen ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
            </button>

            {/* Collapsible body */}
            {calcOpen && (
              <div className="border-t border-gray-700 p-6 space-y-6">
                {/* Reset button */}
                <div className="flex justify-end">
                  <button
                    onClick={resetCalculator}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset to Actual
                  </button>
                </div>

                {/* Slider Groups */}
                <div className="space-y-5">
                  {/* Per-Unit Economics */}
                  <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50">
                    <h4 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-indigo-400" />
                      Per-Unit Economics
                    </h4>
                    <div className="space-y-4">
                      <CalcSlider
                        label="Avg Retail Price"
                        value={simRetailPrice ?? actualValues.retailPrice}
                        actual={actualValues.retailPrice}
                        onChange={setSimRetailPrice}
                        min={0}
                        max={Math.max((actualValues.retailPrice || 10) * 3, 10)}
                        step={0.5}
                        prefix="$"
                        formatValue={formatCurrency}
                      />
                      <CalcSlider
                        label="Product COGS"
                        value={simProductCogs ?? actualValues.productCogs}
                        actual={actualValues.productCogs}
                        onChange={setSimProductCogs}
                        min={0}
                        max={Math.max((actualValues.productCogs || 10) * 3, 10)}
                        step={0.25}
                        prefix="$"
                        formatValue={formatCurrency}
                      />
                    </div>
                  </div>

                  {/* Volume */}
                  <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50">
                    <h4 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                      <Package className="w-4 h-4 text-indigo-400" />
                      Volume
                    </h4>
                    <div className="space-y-4">
                      <CalcSlider
                        label="Units Sold"
                        value={simUnitsSold ?? actualValues.unitsSold}
                        actual={actualValues.unitsSold}
                        onChange={(v) => setSimUnitsSold(Math.round(v))}
                        min={0}
                        max={Math.max((actualValues.unitsSold || 10) * 3, 10)}
                        step={1}
                        formatValue={(n) => Math.round(n).toLocaleString()}
                      />
                      <CalcSlider
                        label="Sampling Qty"
                        value={simSamplingQty ?? actualValues.samplingQty}
                        actual={actualValues.samplingQty}
                        onChange={(v) => setSimSamplingQty(Math.round(v))}
                        min={0}
                        max={Math.max((actualValues.samplingQty || 5) * 3, 20)}
                        step={1}
                        formatValue={(n) => Math.round(n).toLocaleString()}
                      />
                    </div>
                  </div>

                  {/* Costs & Revenue */}
                  <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50">
                    <h4 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-indigo-400" />
                      Revenue & Costs
                    </h4>
                    <div className="space-y-4">
                      <CalcSlider
                        label="Sales Revenue"
                        value={simRevenue ?? actualValues.revenue}
                        actual={actualValues.revenue}
                        onChange={setSimRevenue}
                        min={0}
                        max={Math.max((actualValues.revenue || 1000) * 3, 1000)}
                        step={50}
                        prefix="$"
                        formatValue={formatCurrency}
                      />
                      <CalcSlider
                        label="Fulfillment Fees"
                        value={simFulfillmentFees ?? actualValues.fulfillmentFees}
                        actual={actualValues.fulfillmentFees}
                        onChange={setSimFulfillmentFees}
                        min={0}
                        max={Math.max((actualValues.fulfillmentFees || 500) * 3, 500)}
                        step={10}
                        prefix="$"
                        formatValue={formatCurrency}
                      />
                      <CalcSlider
                        label="Ad Spend"
                        value={simAdSpend ?? actualValues.adSpend}
                        actual={actualValues.adSpend}
                        onChange={setSimAdSpend}
                        min={0}
                        max={Math.max((actualValues.adSpend || 500) * 3, 500)}
                        step={25}
                        prefix="$"
                        formatValue={formatCurrency}
                      />
                    </div>
                  </div>
                </div>

                {/* Simulated Results */}
                <div className={`rounded-xl p-5 border ${simulatedPL.isProfitable
                  ? 'bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-green-500/30'
                  : 'bg-gradient-to-r from-red-500/10 to-pink-500/10 border-red-500/30'
                  }`}>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-semibold text-white">Simulated P&L</h4>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${simulatedPL.isProfitable
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                      }`}>
                      {simulatedPL.isProfitable ? 'PROFITABLE' : 'AT LOSS'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <SimResultCard
                      label="Revenue"
                      value={simulatedPL.revenue}
                      delta={simulatedPL.revenueDelta}
                      formatValue={formatCurrency}
                      color="text-green-400"
                    />
                    <SimResultCard
                      label="COGS"
                      value={simulatedPL.cogs}
                      delta={simulatedPL.cogsDelta}
                      formatValue={formatCurrency}
                      color="text-orange-400"
                      isExpense
                    />
                    <SimResultCard
                      label="Gross Profit"
                      value={simulatedPL.grossProfit}
                      delta={simulatedPL.grossProfitDelta}
                      formatValue={formatCurrency}
                      color={simulatedPL.grossProfit >= 0 ? 'text-blue-400' : 'text-red-400'}
                    />
                    <SimResultCard
                      label="Expenses"
                      value={simulatedPL.totalExpenses}
                      delta={simulatedPL.totalExpenses - totalExpenses}
                      formatValue={formatCurrency}
                      color="text-red-400"
                      isExpense
                    />
                    <SimResultCard
                      label="Net Profit"
                      value={simulatedPL.netProfit}
                      delta={simulatedPL.netProfitDelta}
                      formatValue={formatCurrency}
                      color={simulatedPL.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}
                    />
                    <SimResultCard
                      label="Net Margin"
                      value={simulatedPL.margin}
                      delta={simulatedPL.marginDelta}
                      formatValue={(n) => `${n.toFixed(1)}%`}
                      color={simulatedPL.margin >= 0 ? 'text-green-400' : 'text-red-400'}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Data source info */}
          <div className="text-center text-gray-600 text-xs pb-4">
            Based on {orders.length} orders in date range
          </div>
        </>
      </>

      {canMutateShop && (
        <ManualAffiliateModal
          isOpen={isAffiliateModalOpen}
          onClose={() => setIsAffiliateModalOpen(false)}
          account={account}
          shopId={shopId || ''}
        />
      )}

      {canMutateShop && (
        <ManualAgencyFeeModal
          isOpen={isAgencyModalOpen}
          onClose={() => setIsAgencyModalOpen(false)}
          account={account}
          shopId={shopId || ''}
        />
      )}
    </div>
  );
}

// ═══════════════════ CALCULATOR SUB-COMPONENTS ═══════════════════

interface CalcSliderProps {
  label: string;
  value: number;
  actual: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  formatValue: (n: number) => string;
}

function CalcSlider({ label, value, actual, onChange, min, max, step, prefix, formatValue }: CalcSliderProps) {
  const delta = value - actual;
  const hasDelta = Math.abs(delta) > 0.01;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">{label}</span>
        <div className="flex items-center gap-2">
          {/* Editable input */}
          <div className="flex items-center bg-gray-800 border border-gray-600 rounded-lg overflow-hidden">
            {prefix && <span className="text-gray-500 text-sm pl-2">{prefix}</span>}
            <input
              type="number"
              value={Number(value.toFixed(2))}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
              }}
              className="w-24 bg-transparent text-white text-sm font-medium px-2 py-1.5 focus:outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              min={min}
              max={max}
              step={step}
            />
          </div>
          {/* Delta badge */}
          {hasDelta && (
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${delta > 0 ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
              {delta > 0 ? '+' : ''}{prefix === '$' ? formatValue(Math.abs(delta)) : delta.toFixed(step < 1 ? 2 : 0)}
              {delta > 0 && prefix === '$' ? '' : ''}
            </span>
          )}
        </div>
      </div>
      {/* Range slider */}
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-pink-500
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-pink-500 [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(236,72,153,0.5)]
          [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-pink-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
      />
      {/* Min/Max labels */}
      <div className="flex justify-between text-xs text-gray-600">
        <span>{prefix === '$' ? formatValue(min) : min}</span>
        <span className="text-gray-500">Actual: {prefix === '$' ? formatValue(actual) : actual.toLocaleString()}</span>
        <span>{prefix === '$' ? formatValue(max) : max.toLocaleString()}</span>
      </div>
    </div>
  );
}

interface SimResultCardProps {
  label: string;
  value: number;
  delta: number;
  formatValue: (n: number) => string;
  color: string;
  isExpense?: boolean;
}

function SimResultCard({ label, value, delta, formatValue, color, isExpense }: SimResultCardProps) {
  const hasDelta = Math.abs(delta) > 0.01;
  // For expenses, a decrease (negative delta) is good
  const deltaIsGood = isExpense ? delta < 0 : delta > 0;

  return (
    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>
        {value < 0 ? '-' : ''}{formatValue(Math.abs(value))}
      </p>
      {hasDelta && (
        <p className={`text-xs font-medium mt-0.5 ${deltaIsGood ? 'text-green-400' : 'text-red-400'}`}>
          {delta > 0 ? '+' : ''}{formatValue(delta)}
        </p>
      )}
    </div>
  );
}
