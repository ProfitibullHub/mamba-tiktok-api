import { DollarSign, TrendingUp, TrendingDown, Minus, Wallet, PieChart, Percent, AlertTriangle, ChevronDown, ChevronUp, Package, Truck, Receipt, Users, Megaphone, Building2, SlidersHorizontal, RotateCcw, Download, Plus, Trash2, Calendar, Lock, CircleDollarSign, RefreshCw, ListOrdered } from 'lucide-react';
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
import { Account } from '../../lib/supabase';
import { calculateOrderGMV } from '../../utils/gmvCalculations';
import { exportToCSV, exportToExcel, exportToPDF, ExportData } from '../../utils/exportUtils';
import { ManualAffiliateModal } from '../ManualAffiliateModal';
import { ManualAgencyFeeModal } from '../ManualAgencyFeeModal';
import { CustomPlManageModal } from '../CustomPlManageModal';
import { patchCustomPlEmptyValueDisplay } from '../../lib/customPlFinanceApi';
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
import { useSellerBranding } from '../../contexts/SellerBrandingContext';
import { useTenantContext } from '../../contexts/TenantContext';
import { scopedPlDataFromCache } from '../../utils/plDataRangeGuard';
import { readDefaultLoadDaysFromStorage } from '../../config/dataRetention';
import { shouldSkipShopTabMountBootstrap } from '../../utils/shopTabBootstrap';
import {
  useMergedShopEffectivePermissions,
  effectiveHasTiktokShopData,
  effectiveAllowsMarketingFinanceTab,
} from '../../hooks/useMyEffectivePermissions';

// Use paid_time for filtering (matches backend which loads by paid_time)
const getOrderTs = (o: Order): number => Number(o.paid_time || o.created_time);

/** P&L date default is separate from Overview / dashboard (`mamba:default_date_preset`). */
const PL_DEFAULT_PRESET_IDS = new Set(['today', 'yesterday', 'last7', 'last30', 'mtd', 'lastMonth']);

function plDefaultPresetStorageKey(shopId: string | undefined): string {
  return `mamba:pl_default_date_preset:${shopId || 'default'}`;
}

function readPlDefaultDateRange(shopId: string | undefined, timezone: string): DateRange {
  try {
    const raw = localStorage.getItem(plDefaultPresetStorageKey(shopId));
    const preset = raw && PL_DEFAULT_PRESET_IDS.has(raw) ? raw : 'yesterday';
    return getDateRangeFromPreset(preset, timezone);
  } catch {
    return getDateRangeFromPreset('yesterday', timezone);
  }
}

/** SPA session snapshot for Profit & Loss only (lost on refresh). */
function initialProfitLossDateRange(saved: DateRange | undefined, shopId: string | undefined, timezone: string): DateRange {
  if (saved) return saved;
  return readPlDefaultDateRange(shopId, timezone);
}

interface ProfitLossViewProps {
  account: Account;
  shopId?: string;
  timezone?: string; // Shop timezone for date calculations
  sessionDateRange?: DateRange;
  onSessionDateRangeChange?: (range: DateRange) => void;
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
    /** Seller Center gross sales: transaction rollup (≠ legacy `total_revenue`, which often duplicates net sales). */
    total_gross_sales?: number;
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
  financial_visibility?: {
    can_view_cogs?: boolean;
    can_view_margin?: boolean;
    can_view_custom_line_items?: boolean;
    restricted_fields?: string[];
    restricted_custom_pl_line_item_ids?: string[];
  };
  restriction_notice?: string;
  custom_line_items?: {
    /** PRD §5.3 */
    empty_amount_in_range_display?: 'zero' | 'null';
    lines: Array<{
      id: string;
      name: string;
      category: string;
      sort_order: number;
      is_active: boolean;
      amount_in_range: number | null;
      value_segments: Array<{
        id: string;
        amount: number;
        /** Portion of `amount` attributed to the current report range (calendar-day proration when the segment is longer). */
        amount_in_report?: number;
        start_date: string;
        end_date: string | null;
      }>;
    }>;
    by_category: Record<string, number>;
  };
}

const PL_AMOUNT_EPS = 0.005;
const PL_PCT_EPS = 0.05;

/** Signed dollars / counts: positive green, negative red, ~zero yellow (warning tone). */
function plSignedMetricClass(amount: number): string {
  if (Math.abs(amount) < PL_AMOUNT_EPS) return 'brand-metric-zero';
  return amount > 0 ? 'brand-profit' : 'brand-loss';
}

/** Percentages (margins): same semantics as signed metrics. */
function plSignedPctClass(pct: number): string {
  if (Math.abs(pct) < PL_PCT_EPS) return 'brand-metric-zero';
  return pct > 0 ? 'brand-profit' : 'brand-loss';
}

/** Costs shown as positive dollar amounts: spend → loss tone; credits negative → profit tone. */
function plExpenseMetricClass(amount: number): string {
  if (Math.abs(amount) < PL_AMOUNT_EPS) return 'brand-metric-zero';
  return amount > 0 ? 'brand-loss' : 'brand-profit';
}

/** Background + border + glyph color for metric icon tiles (matches value semantics). */
function plSemanticToIconTileClass(semantic: string): string {
  switch (semantic) {
    case 'brand-profit':
      return 'brand-icon-tile-profit';
    case 'brand-loss':
      return 'brand-icon-tile-loss';
    case 'brand-metric-zero':
      return 'brand-icon-tile-zero';
    case 'brand-muted':
    case 'brand-text':
    default:
      return 'brand-icon-tile-neutral';
  }
}


// Expandable List Item Component
interface ExpandableItemProps {
  icon: React.ReactNode;
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
    <div className="border-b last:border-b-0" style={{ borderColor: 'var(--brand-card-border)' }}>
      <div
        className={`flex items-center justify-between py-3 ${expandedContent ? 'cursor-pointer brand-row-hover transition-colors rounded-lg px-2 -mx-2' : ''}`}
        onClick={() => expandedContent && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(valueColor)}`}>
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="brand-text font-medium">{title}</p>
              {tooltip && (
                <CalculationTooltip
                  source={tooltip.source}
                  calculation={tooltip.calculation}
                  api={tooltip.api}
                />
              )}
              {expandedContent && (
                <span className="brand-muted">
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </span>
              )}
            </div>
            <p className="text-sm brand-muted">{subtitle}</p>
          </div>
        </div>
        <p className={`text-xl font-bold ${valueColor}`}>
          {isNegative ? '-' : ''}{value}
        </p>
      </div>

      {isExpanded && expandedContent && (
        <div className="ml-13 pl-4 pb-3 animate-in slide-in-from-top-2 duration-200">
          <div className="brand-card rounded-lg p-4 ml-10">
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
function BreakdownRows({ items }: { items: { label: string; value: number }[] }) {
  const nonZero = items.filter(i => Math.abs(i.value) >= 0.01);
  if (nonZero.length === 0) {
    return <p className="brand-muted text-sm">No data in this period</p>;
  }
  return (
    <div className="space-y-2 text-sm">
      {nonZero.map((item, i) => (
        <div key={i} className="flex justify-between">
          <span className="brand-muted">{item.label}</span>
          <span className={plExpenseMetricClass(item.value)}>
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

export function ProfitLossView({
  account,
  shopId,
  timezone = 'America/Los_Angeles',
  sessionDateRange,
  onSessionDateRangeChange,
}: ProfitLossViewProps) {
  const { isPlatformSuperAdmin } = useTenantContext();
  const [dateRange, setDateRange] = useState<DateRange>(() =>
    initialProfitLossDateRange(sessionDateRange, shopId, timezone),
  );

  const applyDateRange = useCallback(
    (r: DateRange) => {
      setDateRange(r);
      onSessionDateRangeChange?.(r);
    },
    [onSessionDateRangeChange],
  );

  const [showExportMenu, setShowExportMenu] = useState(false);
  const { data: sellerBrand } = useSellerBranding();
  const [expandedHero, setExpandedHero] = useState<'gmv' | 'grossProfit' | 'netProfit' | null>(null);
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

  const { data: mergedSellerPerms, isLoading: permsLoading } = useMergedShopEffectivePermissions(
    account.tenant_id,
    account.id,
    { enabled: Boolean(account.tenant_id && account.id) },
  );
  const bypassShopPermissionCeiling = isPlatformSuperAdmin;
  const operationalShopData = Boolean(
    bypassShopPermissionCeiling || (mergedSellerPerms && effectiveHasTiktokShopData(mergedSellerPerms))
  );
  const loadMarketingForFinance = Boolean(
    bypassShopPermissionCeiling || (mergedSellerPerms && effectiveAllowsMarketingFinanceTab(mergedSellerPerms))
  );
  const orders = useShopStore(state => state.orders);
  const products = useShopStore(state => state.products);
  const dataVersion = useShopStore(state => state.dataVersion);
  const isLoading = useShopStore(state => state.isLoading);
  const syncData = useShopStore(state => state.syncData);
  const cacheMetadata = useShopStore(state => state.cacheMetadata);
  const fetchShopData = useShopStore(state => state.fetchShopData);
  const syncProgress = useShopStore(state => state.syncProgress);
  const syncProgressShopId = useShopStore(state => state.syncProgressShopId);
  const fetchInProgress = useShopStore((state) => state.fetchInProgress);

  // P&L data from Zustand store (persists across navigations, no flickering)
  const plDataRaw = useShopStore(state => state.plData) as PLData | null;
  const plDataKey = useShopStore(state => state.plDataKey);
  const plDataCache = useShopStore(state => state.plDataCache);
  const plLoading = useShopStore(state => state.plLoading);
  const error = useShopStore(state => state.plError);
  const fetchPLData = useShopStore(state => state.fetchPLData);
  const refreshPlDataCustomLineItems = useShopStore((state) => state.refreshPlDataCustomLineItems);

  const plData = useMemo(
    () => scopedPlDataFromCache(plDataRaw, plDataKey, plDataCache, account.id, shopId, dateRange.startDate, dateRange.endDate) as PLData | null,
    [plDataRaw, plDataKey, plDataCache, account.id, shopId, dateRange.startDate, dateRange.endDate]
  );

  const canViewCogs = bypassShopPermissionCeiling || plData?.financial_visibility?.can_view_cogs !== false;
  const canViewMargin = bypassShopPermissionCeiling || plData?.financial_visibility?.can_view_margin !== false;
  const canViewCustomLineItems =
    bypassShopPermissionCeiling || plData?.financial_visibility?.can_view_custom_line_items !== false;

  const customPlPayload = plData?.custom_line_items;
  const customPlNetDisplay = useMemo(() => {
    if (!customPlPayload?.lines?.length) return 0;
    return customPlPayload.lines.reduce((sum, row) => sum + (Number(row.amount_in_range) || 0), 0);
  }, [customPlPayload]);

  const refreshCustomPlAfterModalSave = useCallback(async () => {
    if (!shopId) return;
    await refreshPlDataCustomLineItems(account.id, shopId, dateRange.startDate, dateRange.endDate, timezone);
  }, [account.id, shopId, dateRange.startDate, dateRange.endDate, timezone, refreshPlDataCustomLineItems]);

  const saveCustomPlEmptyDisplay = useCallback(
    async (mode: 'zero' | 'null') => {
      if (!shopId) return;
      setCustomPlEmptyDisplaySaving(true);
      try {
        await patchCustomPlEmptyValueDisplay(account.id, shopId, mode);
        await refreshPlDataCustomLineItems(account.id, shopId, dateRange.startDate, dateRange.endDate, timezone);
      } catch (err) {
        console.error(err);
      } finally {
        setCustomPlEmptyDisplaySaving(false);
      }
    },
    [account.id, shopId, dateRange.startDate, dateRange.endDate, timezone, refreshPlDataCustomLineItems],
  );

  const restrictedFieldSet = useMemo(
    () => (bypassShopPermissionCeiling ? new Set<string>() : new Set(plData?.financial_visibility?.restricted_fields || [])),
    [bypassShopPermissionCeiling, plData?.financial_visibility?.restricted_fields]
  );
  const isRestricted = useCallback((field: string) => restrictedFieldSet.has(field), [restrictedFieldSet]);
  /** Hide affiliate block when policy targets commission lines or custom line items (manual retainers), independent of product COGS visibility. */
  const hideAffiliatePlSection =
    restrictedFieldSet.has('affiliate_commissions') || restrictedFieldSet.has('custom_line_items');

  // Manual Affiliate Settlements
  const affiliateSettlements = useShopStore(state => state.finance.affiliateSettlements);
  const affiliateSettlementsInRange = useMemo(
    () => affiliateSettlements.filter(s => s.date >= dateRange.startDate && s.date <= dateRange.endDate),
    [affiliateSettlements, dateRange.startDate, dateRange.endDate]
  );
  const fetchAffiliateSettlements = useShopStore(state => state.fetchAffiliateSettlements);
  const deleteAffiliateSettlement = useShopStore(state => state.deleteAffiliateSettlement);
  const [isAffiliateModalOpen, setIsAffiliateModalOpen] = useState(false);

  // Manual Agency Fees
  const agencyFees = useShopStore(state => state.finance.agencyFees);
  const fetchAgencyFees = useShopStore(state => state.fetchAgencyFees);
  const deleteAgencyFee = useShopStore(state => state.deleteAgencyFee);
  const [isAgencyModalOpen, setIsAgencyModalOpen] = useState(false);
  const [isCustomPlModalOpen, setIsCustomPlModalOpen] = useState(false);
  const [customPlEmptyDisplaySaving, setCustomPlEmptyDisplaySaving] = useState(false);

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

  /** Same shop-data progress copy as Overview (e.g. "Loading 22/30 days…"). */
  const ordersLoadStatusText = useMemo(() => {
    if (!operationalShopData) return null;
    if (!shopId) return null;
    if (cacheMetadata.isSyncing && cacheMetadata.shopId === shopId) return null;
    if (
      syncProgressShopId === shopId &&
      (syncProgress.isActive || fetchInProgress) &&
      syncProgress.message?.trim()
    ) {
      return syncProgress.message.trim();
    }
    return null;
  }, [
    operationalShopData,
    shopId,
    cacheMetadata.isSyncing,
    cacheMetadata.shopId,
    syncProgressShopId,
    syncProgress.isActive,
    fetchInProgress,
    syncProgress.message,
  ]);

  useEffect(() => {
    if (!shopId || !loadMarketingForFinance || marketingLoaded || permsLoading) return;
    void loadMarketingFromDB(account.id);
  }, [shopId, account.id, marketingLoaded, loadMarketingFromDB, loadMarketingForFinance, permsLoading]);

  // Fetch P&L data when params change (store handles caching & dedup). Same-range remounts skip the
  // full waterfall so tab switches stay snappy; user date changes still rerun (fingerprint changes).
  // Operational `fetchShopData` (orders/products) runs only when the user has `tiktok.shop.data`.
  useEffect(() => {
    if (!shopId || permsLoading) return;
    const ld = readDefaultLoadDaysFromStorage(shopId);
    const fp = `${account.id}|${dateRange.startDate}|${dateRange.endDate}|${ld}|${operationalShopData ? 'shop' : 'fin'}`;
    if (shouldSkipShopTabMountBootstrap(shopId, 'profit-loss', fp)) return;
    if (operationalShopData) {
      fetchShopData(
        account.id,
        shopId,
        {
          skipSyncCheck: true,
          initialLoadDays: ld,
          timezone,
        },
        dateRange.startDate,
        dateRange.endDate,
      );
    }
    fetchPLData(account.id, shopId, dateRange.startDate, dateRange.endDate, false, timezone);
    fetchAffiliateSettlements(account.id, shopId, dateRange.startDate, dateRange.endDate);
    fetchAgencyFees(account.id, shopId, dateRange.startDate, dateRange.endDate);
  }, [
    account.id,
    shopId,
    dateRange.startDate,
    dateRange.endDate,
    timezone,
    operationalShopData,
    permsLoading,
    fetchShopData,
    fetchPLData,
    fetchAffiliateSettlements,
    fetchAgencyFees,
  ]);


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

    /** Per-SKU rollup for “how we calculated COGS” (non-sample qualifying orders only). */
    const regularCogsBySku = new Map<
      string,
      {
        skuKey: string;
        productName: string;
        skuName: string;
        skuImage: string;
        quantity: number;
        totalCogs: number;
        fromSnapshot: number;
        fromCatalog: number;
      }
    >();
    let cogsFromOrderSnapshot = 0;
    let cogsFromCatalogFallback = 0;
    let regularCogsLineItems = 0;

    validOrders.forEach(order => {
      order.line_items.forEach(item => {
        regularCogsLineItems += 1;
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
        const usedOrderSnapshotCogs = itemCogs !== undefined && itemCogs !== null;

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

        const qty = Number(item.quantity) || 0;
        const unit = Number(itemCogs);
        const lineCogs = unit * qty;
        if (usedOrderSnapshotCogs) {
          cogsFromOrderSnapshot += lineCogs;
        } else {
          cogsFromCatalogFallback += lineCogs;
        }

        const skuKey = item.seller_sku || item.product_name || 'unknown';
        const existing = regularCogsBySku.get(skuKey);
        if (existing) {
          existing.quantity += qty;
          existing.totalCogs += lineCogs;
          if (usedOrderSnapshotCogs) existing.fromSnapshot += lineCogs;
          else existing.fromCatalog += lineCogs;
        } else {
          regularCogsBySku.set(skuKey, {
            skuKey,
            productName: item.product_name || 'Unknown product',
            skuName: item.sku_name || '',
            skuImage: item.sku_image || '',
            quantity: qty,
            totalCogs: lineCogs,
            fromSnapshot: usedOrderSnapshotCogs ? lineCogs : 0,
            fromCatalog: usedOrderSnapshotCogs ? 0 : lineCogs,
          });
        }

        realCogs += lineCogs;
        realShippingCost += (Number(itemShippingCost) * qty);
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

    // Sort regular-order COGS breakdown by extended cost (matches Σ line totals)
    const regularCogsBreakdown = Array.from(regularCogsBySku.values())
      .map((row) => ({
        ...row,
        unitCogs: row.quantity > 0 ? row.totalCogs / row.quantity : 0,
      }))
      .sort((a, b) => b.totalCogs - a.totalCogs);

    return {
      withCogs: productsWithCogs,
      total: productsWithSales,
      totalCogs: realCogs,
      totalProductShippingCost: realShippingCost,
      regularOrdersCogsDetail: {
        qualifyingOrders: validOrders.length,
        lineItems: regularCogsLineItems,
        fromOrderSnapshot: cogsFromOrderSnapshot,
        fromCatalogFallback: cogsFromCatalogFallback,
        breakdown: regularCogsBreakdown,
      },
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

  const formatCurrency = (num: number | null): string => {
    if (num === null) return '—';
    return `$${Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPercent = (num: number): string => {
    return `${num.toFixed(2)}%`;
  };

  // Computed values - Memoized to prevent re-calculation on every render
  const financials = useMemo(() => {
    const startTs = getShopDayStartTimestamp(dateRange.startDate, timezone);
    const endTs = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;

    /** No order/product API data — P&amp;L from TikTok statements + marketing sync only. */
    if (!operationalShopData) {
      const statementGrossSales =
        typeof plData?.statement_totals?.total_gross_sales === 'number' &&
        Number.isFinite(plData.statement_totals.total_gross_sales)
          ? plData.statement_totals.total_gross_sales
          : (() => {
              if (!plData || !(Number(plData.transaction_count) > 0)) {
                return plData?.statement_totals?.total_revenue ?? 0;
              }
              const rev = plData.revenue || {};
              const sb = Number(rev.subtotal_before_discount ?? 0);
              if (Math.abs(sb) >= PL_AMOUNT_EPS) return sb;
              const br = sb + Number(rev.refund_subtotal_before_discount ?? 0);
              if (Math.abs(br) >= PL_AMOUNT_EPS) return br;
              const tr = Number(plData.total_revenue ?? 0);
              if (Math.abs(tr) >= PL_AMOUNT_EPS) return tr;
              return plData?.statement_totals?.total_revenue ?? 0;
            })();

      const netRevenue = plData?.statement_totals?.total_net_sales ?? 0;
      const grossSalesGMV = statementGrossSales;
      const totalOrderAmount = 0;
      const totalTax = 0;
      const totalProductTax = 0;
      const totalShippingTax = 0;
      const refunds = 0;

      const platformFeesNet = netByKeys(plData?.fees, platformFeeKeys);
      const platformFeesSum = expenseFromNet(platformFeesNet);
      const tiktokCommission = platformFeesSum > 0 ? platformFeesSum : netRevenue * 0.06;
      const autoAffiliateNet = netByKeys(plData?.fees, affiliateFeeKeys);
      const autoAffiliateCommission = expenseFromNet(autoAffiliateNet);
      const manualAffiliateRetainers = affiliateSettlementsInRange.reduce((sum, s) => sum + Number(s.amount), 0);
      const totalAffiliateCost = autoAffiliateCommission + manualAffiliateRetainers;
      const plCustomBcStmt = plData?.custom_line_items?.by_category;
      const customOpExStmt =
        Number(plCustomBcStmt?.expenses ?? 0) + Number(plCustomBcStmt?.supplementary ?? 0);
      const customCogsStmt = Number(plCustomBcStmt?.cogs ?? 0);

      const totalCogs = 0;
      const totalProductShippingCost = 0;
      /** No order/COGS-backed profit in statements-only mode — heroes use statement totals only. */
      const grossProfit = 0;

      const shippingCosts = plData?.shipping
        ? shippingTotalForOperatingExpenses(plData.shipping)
        : Math.abs(plData?.statement_totals?.total_shipping ?? 0);
      const shopAdsNet = netByKeys(plData?.fees, adSpendFeeKeys);
      const shopAdsFees = expenseFromNet(shopAdsNet);
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

      const {
        total: totalAgencyFees,
        lines: agencyFeeLines,
        summaryNotes: agencyFeeSummaryNotes,
      } = computeAgencyFeesRollup(
        agencyFees,
        dateRange.startDate,
        dateRange.endDate,
        timezone,
        { grossSalesGMV: statementGrossSales, netRevenue, grossProfit }
      );

      let realOperatingExpenses = 0;
      let feesBase = 0;
      let shippingBase = 0;
      if (plData && plData.statement_totals) {
        feesBase = plData.total_fee_tax != null
          ? Math.abs(plData.total_fee_tax)
          : Math.abs(plData.statement_totals.total_fees);
        shippingBase = plData.shipping
          ? shippingTotalForOperatingExpenses(plData.shipping)
          : Math.abs(plData.statement_totals.total_shipping);
        realOperatingExpenses = feesBase + shippingBase - shopAdsFees - autoAffiliateCommission + totalAgencyFees + customOpExStmt;
      } else {
        realOperatingExpenses = tiktokCommission + shippingCosts + totalAgencyFees + customOpExStmt;
      }

      const heroGmvLines: { label: string; value: number }[] = [];
      if (plData?.revenue && Number(plData.transaction_count) > 0) {
        const rev = plData.revenue;
        const pushIf = (label: string, key: string) => {
          const v = Number((rev as Record<string, number>)[key] ?? 0);
          if (Math.abs(v) >= PL_AMOUNT_EPS) heroGmvLines.push({ label, value: v });
        };
        pushIf('Subtotal before discount', 'subtotal_before_discount');
        pushIf('Refund subtotal before discount', 'refund_subtotal_before_discount');
        if (heroGmvLines.length === 0) {
          heroGmvLines.push({ label: 'Gross sales (statement transactions)', value: statementGrossSales });
        }
      } else {
        heroGmvLines.push({ label: 'Gross sales (TikTok statements)', value: statementGrossSales });
      }

      /** Net sales drill-down: revenue lines from synced statement transactions only (no COGS/affiliate walk). */
      const heroGrossProfitLines: { label: string; value: number; emphasis?: 'total' }[] = [];
      if (plData?.revenue && Number(plData.transaction_count) > 0) {
        const rev = plData.revenue as Record<string, number>;
        const pushRev = (label: string, key: string) => {
          const v = Number(rev[key] ?? 0);
          if (Math.abs(v) >= PL_AMOUNT_EPS) heroGrossProfitLines.push({ label, value: v });
        };
        pushRev('Gross sales', 'subtotal_before_discount');
        pushRev('Gross sales refund', 'refund_subtotal_before_discount');
        pushRev('Seller discount', 'seller_discount');
        pushRev('Seller discount refund', 'seller_discount_refund');
      }
      if (heroGrossProfitLines.length === 0) {
        heroGrossProfitLines.push({ label: 'Gross sales (statement rollup)', value: statementGrossSales });
      }
      heroGrossProfitLines.push({ label: 'Net sales (statement rollup)', value: netRevenue, emphasis: 'total' });

      const packagingSupplies = 0;
      const totalTaxes = plData?.taxes ? Object.values(plData.taxes).reduce((sum, v) => sum + Math.abs(v), 0) : 0;
      const totalExpenses = realOperatingExpenses + adSpend;
      const operatingExpensesBeforeExclusion = totalExpenses + totalCogs + customCogsStmt + totalAffiliateCost;
      const grossMargin = 0;
      const roi = 0;
      const grossProfitPct = 0;
      const operatingIncome = 0;
      const operatingIncomePct = 0;
      const totalUnitsSold = 0;
      const netProfit = 0;

      /** Settlement drill-down: statement_totals only (not a reconciled accounting identity). */
      const st = plData?.statement_totals;
      const settlementAmt = st?.total_settlement ?? 0;
      const heroNetProfitLines: { label: string; value: number; emphasis?: 'subtotal' | 'total' }[] = [];
      if (st) {
        heroNetProfitLines.push({ label: 'Net sales (statement)', value: st.total_net_sales ?? netRevenue });
        heroNetProfitLines.push({ label: 'Total fees (statement)', value: -Math.abs(st.total_fees ?? 0) });
        heroNetProfitLines.push({ label: 'Total shipping (statement)', value: -Math.abs(st.total_shipping ?? 0) });
        const adj = st.total_adjustments ?? 0;
        if (Math.abs(adj) >= PL_AMOUNT_EPS) {
          heroNetProfitLines.push({ label: 'Adjustments (statement, net)', value: adj });
        }
        heroNetProfitLines.push({ label: 'Total settlement (statement)', value: settlementAmt, emphasis: 'total' });
      } else {
        heroNetProfitLines.push({ label: 'Total settlement (statement)', value: settlementAmt, emphasis: 'total' });
      }

      const serviceFeesResidual = plData
        ? Math.max(
            0,
            Math.abs(plData.total_fee_tax ?? plData.statement_totals?.total_fees ?? 0) -
              platformFeesSum -
              autoAffiliateCommission -
              shopAdsFees,
          )
        : 0;

      let serviceFeeItems: { label: string; value: number }[] = [];
      if (plData && plData.fees) {
        const itemizedServiceFees = Object.keys(plData.fees)
          .filter(
            (k) =>
              !isPlatformFeeKey(k) &&
              !isAffiliateCogsFeeKey(k) &&
              !isAdSpendFeeKey(k) &&
              Math.abs(plData.fees[k]) > 0,
          )
          .map((k) => ({
            label: k.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
            value: Math.abs(plData.fees[k]),
          }))
          .sort((a, b) => b.value - a.value);

        const itemizedSum = itemizedServiceFees.reduce((sum, item) => sum + item.value, 0);
        const diff = serviceFeesResidual - itemizedSum;
        serviceFeeItems = [...itemizedServiceFees];
        if (diff > 0.05) {
          serviceFeeItems.push({ label: 'Other Uncategorized Fees', value: diff });
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
        totalUnitsSold,
        realOperatingExpenses,
        fbtFeesFromOrders: 0,
        gmvOriginalProductPrice: 0,
        gmvShippingFees: 0,
        gmvSellerDiscounts: 0,
        gmvPlatformDiscounts: 0,
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
        statementGrossSales,
        platformFees: platformFeesSum,
        fbtFees: 0,
        serviceFees: serviceFeesResidual,
        serviceFeeItems,
        totalTaxes,
        operatingExpenses: totalExpenses,
        operatingExpensesBeforeExclusion,
        grossProfitPct,
        operatingIncome,
        operatingIncomePct,
        heroGmvLines,
        heroGrossProfitLines,
        heroNetProfitLines,
      };
    }

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
    const manualAffiliateRetainers = affiliateSettlementsInRange.reduce((sum, s) => sum + Number(s.amount), 0);

    // Total affiliate payout (creator/affiliate fees + manual retainers) — deducted for gross profit, shown separately from product COGS in UI
    const totalAffiliateCost = autoAffiliateCommission + manualAffiliateRetainers;

    const plCustomBc = plData?.custom_line_items?.by_category;
    const customPlRevenue = Number(plCustomBc?.revenue ?? 0);
    const customPlCogs = Number(plCustomBc?.cogs ?? 0);
    const customPlOpEx = Number(plCustomBc?.expenses ?? 0) + Number(plCustomBc?.supplementary ?? 0);

    // Gross Profit = Net Revenue − Product COGS − Product shipping − Affiliate commission
    const grossProfit =
      netRevenue +
      customPlRevenue -
      totalCogs -
      customPlCogs -
      totalProductShippingCost -
      totalAffiliateCost;

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
      realOperatingExpenses = feesBase + shippingBase - shopAdsFees - autoAffiliateCommission + totalAgencyFees + customPlOpEx;
    } else {
      // Fallback: Estimates if no statement data
      realOperatingExpenses = tiktokCommission + shippingCosts + totalAgencyFees + customPlOpEx;
    }

    const heroGmvLines: { label: string; value: number }[] = [
      { label: 'Product price (before discounts)', value: gmvComponents.originalProductPrice },
      { label: 'Shipping fees', value: gmvComponents.shippingFees },
      { label: 'Seller discounts', value: -gmvComponents.sellerDiscounts },
      { label: 'Platform discounts', value: -gmvComponents.platformDiscounts },
    ];

    const heroGrossProfitLines: { label: string; value: number }[] = [
      { label: 'Net revenue (orders, after refunds)', value: netRevenue },
    ];
    if (Math.abs(customPlRevenue) >= PL_AMOUNT_EPS) {
      heroGrossProfitLines.push({ label: 'Custom P&L revenue', value: customPlRevenue });
    }
    heroGrossProfitLines.push(
      { label: 'Product COGS', value: -totalCogs },
    );
    if (Math.abs(customPlCogs) >= PL_AMOUNT_EPS) {
      heroGrossProfitLines.push({ label: 'Custom P&L COGS', value: -customPlCogs });
    }
    heroGrossProfitLines.push(
      { label: 'Product shipping cost', value: -totalProductShippingCost },
      { label: 'Affiliate commissions (auto + manual)', value: -totalAffiliateCost },
    );

    // Packaging/Supplies (manual input - not available yet, set to 0)
    const packagingSupplies = 0;

    // Calculate taxes sum from plData
    const totalTaxes = plData?.taxes ? Object.values(plData.taxes).reduce((sum, v) => sum + Math.abs(v), 0) : 0;

    // Operating Expenses = platform fees + shipping + agency fees + ad spend (affiliate commission handled in gross profit, not here)
    const totalExpenses = realOperatingExpenses + adSpend;
    /** Sum of OpEx-for-net-profit plus COGS and affiliate — reconciles adding every row in the Operating Expenses section. */
    const operatingExpensesBeforeExclusion = totalExpenses + totalCogs + customPlCogs + totalAffiliateCost;

    // Operating Income = Gross Profit - Operating Expenses
    const netProfit = grossProfit - totalExpenses;

    const heroNetProfitLines: { label: string; value: number; emphasis?: 'subtotal' | 'total' }[] = [
      { label: 'Net revenue (orders, after refunds)', value: netRevenue },
    ];
    if (Math.abs(customPlRevenue) >= PL_AMOUNT_EPS) {
      heroNetProfitLines.push({ label: 'Custom P&L revenue', value: customPlRevenue });
    }
    heroNetProfitLines.push(
      { label: 'Product COGS', value: -totalCogs },
    );
    if (Math.abs(customPlCogs) >= PL_AMOUNT_EPS) {
      heroNetProfitLines.push({ label: 'Custom P&L COGS', value: -customPlCogs });
    }
    heroNetProfitLines.push(
      { label: 'Product shipping cost', value: -totalProductShippingCost },
      { label: 'Affiliate commissions (auto + manual)', value: -totalAffiliateCost },
      { label: 'Gross profit', value: grossProfit, emphasis: 'subtotal' },
    );

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

    if (Math.abs(customPlOpEx) >= PL_AMOUNT_EPS) {
      heroNetProfitLines.push({ label: 'Custom P&L (expenses + supplementary)', value: -customPlOpEx });
    }

    heroNetProfitLines.push(
      { label: 'Marketing ad spend (synced)', value: -adSpend },
      { label: 'Net profit', value: netProfit, emphasis: 'total' },
    );
    const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
    const roi =
      (totalCogs + customPlCogs + totalProductShippingCost + totalAffiliateCost + totalExpenses) > 0
        ? (netProfit / (totalCogs + customPlCogs + totalProductShippingCost + totalAffiliateCost + totalExpenses)) * 100
        : 0;

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
        /**
         * Statement gross sales: Seller Center row = summed `subtotal_before_discount` from synced transactions,
         * not Σ `revenue_amount` (often equals Net sales).
         */
        statementGrossSales:
          typeof plData?.statement_totals?.total_gross_sales === 'number' &&
          Number.isFinite(plData.statement_totals.total_gross_sales)
            ? plData.statement_totals.total_gross_sales
            : (() => {
                if (!plData || !(Number(plData.transaction_count) > 0)) {
                  return plData?.statement_totals?.total_revenue ?? 0;
                }
                const rev = plData.revenue || {};
                const sb = Number(rev.subtotal_before_discount ?? 0);
                if (Math.abs(sb) >= PL_AMOUNT_EPS) return sb;
                const br =
                  sb + Number(rev.refund_subtotal_before_discount ?? 0);
                if (Math.abs(br) >= PL_AMOUNT_EPS) return br;
                const tr = Number(plData.total_revenue ?? 0);
                if (Math.abs(tr) >= PL_AMOUNT_EPS) return tr;
                return plData?.statement_totals?.total_revenue ?? 0;
              })(),
        platformFees: platformFeesSum,
        fbtFees: totalFbtFees,
        serviceFees: serviceFeesResidual,
        serviceFeeItems,
        totalTaxes,
        operatingExpenses: totalExpenses,
        operatingExpensesBeforeExclusion,
        grossProfitPct,
        operatingIncome,
        operatingIncomePct,
        heroGmvLines,
        heroGrossProfitLines,
        heroNetProfitLines,
      };
  }, [operationalShopData, orders, cogsStats, dateRange, dataVersion, affiliateSettlementsInRange, agencyFees, plData, includeCancelledFinancials, marketingDaily, timezone]);

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

  const restrictionNotice = plData?.restriction_notice || null;

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
    const todayStr = formatShopDateISO(new Date(), timezone);
    applyDateRange({ startDate: todayStr, endDate: todayStr });
  }, [timezone, applyDateRange]);

  const isTodayActive = () => {
    const todayStr = formatShopDateISO(new Date(), timezone);
    return dateRange.startDate === todayStr && dateRange.endDate === todayStr;
  };

  const handleYesterdayClick = useCallback(() => {
    const todayStr = formatShopDateISO(new Date(), timezone);
    const yesterdayStr = previousCalendarDayISO(todayStr, timezone);
    applyDateRange({ startDate: yesterdayStr, endDate: yesterdayStr });
  }, [timezone, applyDateRange]);

  const isYesterdayActive = () => {
    const todayStr = formatShopDateISO(new Date(), timezone);
    const yesterdayStr = previousCalendarDayISO(todayStr, timezone);
    return dateRange.startDate === yesterdayStr && dateRange.endDate === yesterdayStr;
  };

  // Export handler
  const handleExport = useCallback((format: 'csv' | 'excel' | 'pdf') => {
    // Prepare export data
    const exportData: ExportData = {
      headers: ['Metric', 'Value'],
      rows: [
        ['Date Range', `${dateRange.startDate} to ${dateRange.endDate}`],
        [
          'Date basis',
          'TikTok settlement block: settlement_time (matches Seller Center). Order-based sections: paid_time. Shop timezone.',
        ],
        ['Shop', account.name],
        ['Export Date', new Date().toLocaleDateString()],
        ['', ''],

        ...buildTiktokStatementExportRows(plData, {
          formatCurrency,
          dateRangeLabel: `${dateRange.startDate} to ${dateRange.endDate}`,
          timezoneLabel: timezone,
        }),

        ...(canViewCustomLineItems && !isRestricted('custom_line_items') && customPlPayload?.lines?.length
          ? ([
              ['═══ CUSTOM P&L (manual) ═══', ''],
              ...customPlPayload.lines.map((ln) => [ln.name, formatCurrency(ln.amount_in_range)] as [string, string]),
              ...((plData?.financial_visibility?.restricted_custom_pl_line_item_ids?.length ?? 0) > 0
                ? ([
                    [
                      'Visibility note',
                      'Some custom lines may be withheld for certain roles by line-level policy; omitted lines are not shown here.',
                    ],
                  ] as [string, string][])
                : []),
              ['', ''],
            ] as [string, string][])
          : []),

        ...(operationalShopData
          ? ([
        ['═══ REVENUE (order-based) ═══', ''],
        ['Gross Sales (GMV)', formatCurrency(financials.grossSalesGMV)],
        ['  Original Product Price', formatCurrency(financials.gmvOriginalProductPrice)],
        ['  Shipping Fees', formatCurrency(financials.gmvShippingFees)],
        ['  Seller Discounts', `-${formatCurrency(financials.gmvSellerDiscounts)}`],
        ['  Platform Discounts', `-${formatCurrency(financials.gmvPlatformDiscounts)}`],
        ['Returns & Refunds', `-${formatCurrency(financials.refunds)}`],
        ['Net Revenue', formatCurrency(financials.netRevenue)],
        ['', ''],
          ] as [string, string][])
          : ([
        ['═══ REVENUE (TikTok statements) ═══', ''],
        ['Gross sales (statement sync)', formatCurrency(financials.grossSalesGMV)],
        ['Net sales (statement sync)', formatCurrency(financials.netRevenue)],
        ['', ''],
          ] as [string, string][])),

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

        ['Total Operating Expenses (before exclusion, incl. COGS & affiliate)', `-${formatCurrency(financials.operatingExpensesBeforeExclusion)}`],
        ['Total Operating Expenses (after exclusion, OpEx for net profit)', `-${formatCurrency(financials.totalExpenses)}`],
        ['', ''],

        ...(operationalShopData
          ? ([
        ['FBT (Non-Shipping) Fees', `-${formatCurrency(financials.fbtFeesFromOrders || 0)}`],
        ['  FBT Orders with Fees', orders.filter(o => o.fbt_fulfillment_fee && o.fbt_fulfillment_fee > 0).length.toString()],
        ['', ''],
          ] as [string, string][])
          : []),

        ...(operationalShopData
          ? ([
        ['═══ PRODUCT COGS ═══', ''],
        ['Total product COGS', `-${formatCurrency(financials.totalCogs)}`],
        ['  Regular Orders COGS', `-${formatCurrency(financials.totalCogs - cogsStats.sampleOrders.totalCogsValue)}`],
        ['  Regular Orders Count', (orders.filter(o => !o.is_sample_order && getOrderTs(o) >= getShopDayStartTimestamp(dateRange.startDate, timezone) && getOrderTs(o) < getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400).length - cogsStats.sampleOrders.count).toString()],
        ['  Regular Orders Units', (financials.totalUnitsSold - cogsStats.sampleOrders.totalProducts).toString()],
        ['  Sample Orders COGS', `-${formatCurrency(cogsStats.sampleOrders.totalCogsValue)}`],
        ['  Sample Orders Count', cogsStats.sampleOrders.count.toString()],
        ['  Sample Orders Units', cogsStats.sampleOrders.totalProducts.toString()],
        ['', ''],
          ] as [string, string][])
          : []),
        ['═══ AFFILIATE COMMISSION ═══', ''],
        ['Total affiliate commission (auto + manual)', `-${formatCurrency(financials.totalAffiliateCost)}`],
        ['', ''],
        ...(operationalShopData
          ? ([
        ['Gross Profit', formatCurrency(financials.grossProfit)],
        ['Gross Margin', formatPercent(financials.grossMargin)],
        ['', ''],
          ] as [string, string][])
          : []),

        // ===== PROFITABILITY =====
        ['═══ PROFITABILITY ═══', ''],
        ...(operationalShopData
          ? ([
        ['TikTok statement gross sales (reference)', formatCurrency(financials.statementGrossSales)],
        ['TikTok statement net sales (reference)', formatCurrency(financials.statementNetSales)],
        ['Total Settlement Amount (TikTok)', formatCurrency(financials.settlementAmount)],
        ['Net Profit', formatCurrency(financials.netProfit)],
        ['ROI', formatPercent(financials.roi)],
          ] as [string, string][])
          : ([
        ['TikTok statement gross sales', formatCurrency(financials.statementGrossSales)],
        ['TikTok statement net sales', formatCurrency(financials.statementNetSales)],
        ['Total Settlement Amount (TikTok)', formatCurrency(financials.settlementAmount)],
        ['Order-based profit metrics', 'Omitted — shop order data not loaded for this role'],
          ] as [string, string][])),
        ['Ad ROAS', financials.adROAS.toFixed(2) + 'x'],
        ['', ''],

        ...(operationalShopData
          ? ([
        ['═══ ORDER STATISTICS ═══', ''],
        ['Total Units Sold', financials.totalUnitsSold.toString()],
        ['Regular Orders', (orders.filter(o => !o.is_sample_order && getOrderTs(o) >= getShopDayStartTimestamp(dateRange.startDate, timezone) && getOrderTs(o) < getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400).length - cogsStats.sampleOrders.count).toString()],
        ['Sample Orders', cogsStats.sampleOrders.count.toString()],
        ['FBT Orders', orders.filter(o => o.is_fbt).length.toString()],
        ['Seller Fulfilled Orders', orders.filter(o => !o.is_fbt).length.toString()],
          ] as [string, string][])
          : []),
      ]
    };

    const restrictionNoticeParts: string[] = [];

    if (!canViewCogs || !canViewMargin) {
      const blocked = new Set<string>();
      if (!canViewCogs) {
        blocked.add('═══ PRODUCT COGS ═══');
        blocked.add('Total product COGS');
        blocked.add('  Regular Orders COGS');
        blocked.add('  Sample Orders COGS');
        blocked.add('Product Costs (COGS)');
      }
      if (!canViewMargin) {
        blocked.add('Gross Margin');
      }
      exportData.rows = exportData.rows.filter((r) => !blocked.has(String(r[0])));
      restrictionNoticeParts.push('Some financial fields were excluded by seller visibility policy.');
    }
    if (!canViewCustomLineItems || isRestricted('custom_line_items')) {
      const customNames = new Set((customPlPayload?.lines ?? []).map((l) => l.name));
      customNames.add('═══ CUSTOM P&L (manual) ═══');
      exportData.rows = exportData.rows.filter((r) => {
        const k = String(r[0]);
        if (customNames.has(k)) return false;
        if (k === 'Visibility note' && String(r[1]).includes('line-level policy')) return false;
        return true;
      });
      restrictionNoticeParts.push('Custom P&L line detail was excluded by seller visibility policy.');
    }
    if (restrictionNoticeParts.length > 0) {
      exportData.rows.push(['', '']);
      exportData.rows.push(['Restriction Notice', restrictionNoticeParts.join(' ')]);
    }
    const restrictedFieldLabels: Record<string, string[]> = {
      platform_fees: ['Platform Fees'],
      agency_fees: ['Agency Fees'],
      ad_spend: ['Ad Spend'],
      shipping_costs: ['Shipping Costs'],
      affiliate_commissions: [
        'Affiliate Fees',
        'Affiliate Commissions',
        '═══ AFFILIATE COMMISSION ═══',
        'Total affiliate commission (auto + manual)',
      ],
      gross_profit: ['Gross Profit'],
      net_profit: ['Net Profit'],
      custom_line_items: [
        '═══ CUSTOM P&L (manual) ═══',
        'Visibility note',
        ...(customPlPayload?.lines ?? []).map((l) => l.name),
      ],
    };
    const policyFields = Array.isArray(plData?.financial_visibility?.restricted_fields)
      ? plData!.financial_visibility!.restricted_fields!
      : [];
    if (policyFields.length > 0) {
      const blockedByPolicy = new Set<string>();
      for (const f of policyFields) {
        for (const label of restrictedFieldLabels[f] || []) blockedByPolicy.add(label);
      }
      if (blockedByPolicy.size > 0) {
        exportData.rows = exportData.rows.filter((r) => !blockedByPolicy.has(String(r[0])));
      }
    }

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
          `${account.name} | ${dateRange.startDate} to ${dateRange.endDate}`,
          {
            brandName: sellerBrand.displayName || 'Mamba',
            primaryColor: sellerBrand.primaryColor,
            logoUrl: sellerBrand.logoSignedUrl || null,
          }
        );
        break;
    }
  }, [operationalShopData, dateRange, financials, account.name, cogsStats, plData, orders, timezone, sellerBrand.displayName, sellerBrand.primaryColor, canViewCogs, canViewMargin, canViewCustomLineItems, isRestricted, customPlPayload]);


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
    operatingExpensesBeforeExclusion,
    operatingIncome,
    operatingIncomePct,
    netProfit,
    heroGmvLines,
    heroGrossProfitLines,
    heroNetProfitLines,
    refunds,
  } = financials;

  const toggleHero = useCallback((k: 'gmv' | 'grossProfit' | 'netProfit') => {
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
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(plSignedMetricClass(advertiserInfo.balance))}`}>
                <Wallet className="w-3.5 h-3.5 shrink-0" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Ads Balance</span>
                <span className={`text-sm font-bold ${plSignedMetricClass(advertiserInfo.balance)}`}>{formatCurrency(advertiserInfo.balance)}</span>
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
            className="flex items-center space-x-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            <RotateCcw size={16} className={cacheMetadata.isSyncing ? "animate-spin" : ""} />
            <span>Full Sync</span>
          </button>

          {/* Export Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
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

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleTodayClick}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all border ${isTodayActive()
                ? 'bg-mamba-green hover:bg-mamba-deep text-mamba-dark border-mamba-green shadow-md shadow-mamba-green/35'
                : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white hover:border-gray-600'
                }`}
            >
              <Calendar className={`w-4 h-4 ${isTodayActive() ? 'text-mamba-dark' : 'text-gray-400'}`} />
              Today
            </button>
            <button
              type="button"
              onClick={handleYesterdayClick}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all border ${isYesterdayActive()
                ? 'bg-mamba-green hover:bg-mamba-deep text-mamba-dark border-mamba-green shadow-md shadow-mamba-green/35'
                : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white hover:border-gray-600'
                }`}
            >
              <Calendar className={`w-4 h-4 ${isYesterdayActive() ? 'text-mamba-dark' : 'text-gray-400'}`} />
              Yesterday
            </button>

            <div className="relative inline-flex min-h-[2.5rem] items-stretch self-center">
              <DateRangePicker value={dateRange} onChange={applyDateRange} timezone={timezone} />
              {ordersLoadStatusText && (
                <div
                  className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-gray-950/70 backdrop-blur-[1px] ring-1 ring-gray-600/40"
                  aria-live="polite"
                  role="status"
                >
                  <span className="px-2 text-center text-xs font-medium tabular-nums text-white">
                    {ordersLoadStatusText}
                  </span>
                </div>
              )}
            </div>
           
          </div>
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

      {restrictionNotice && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5 text-amber-300" />
            <p className="text-amber-200 text-sm">{restrictionNotice}</p>
          </div>
        </div>
      )}

      {/* Loading state - only shown on initial load when no cached data exists */}
      {plLoading && !plData && (
        <div className="flex flex-col justify-center items-center h-64 gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-500 border-t-transparent" />
          {ordersLoadStatusText && (
            <p className="text-sm text-gray-300 tabular-nums text-center max-w-md px-4">{ordersLoadStatusText}</p>
          )}
        </div>
      )}

      {/* Always show content - no plData check needed for order-based calculations */}
      <>

        {/* COGS Warning — requires order-level product sales */}
        {operationalShopData && canViewCogs && cogsStats.total > 0 && cogsStats.withCogs < cogsStats.total && (
          <div className="brand-secondary-card rounded-xl p-4 border" style={{ borderColor: 'var(--brand-warning-border)' }}>
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0 brand-icon-tile-zero">
                <AlertTriangle className="w-6 h-6 shrink-0" />
              </div>
              <div className="flex-1">
                <h3 className="brand-text font-semibold mb-1">
                  Product Costs (COGS) Required for Accurate Calculations
                </h3>
                <p className="text-gray-400 text-sm mb-3">
                  {cogsStats.total - cogsStats.withCogs} of {cogsStats.total} products with sales are missing COGS data.
                  Your profit calculations are incomplete without this information.
                </p>
                <div className="flex items-center gap-4">
                  <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${cogsStats.total > 0 ? (cogsStats.withCogs / cogsStats.total) * 100 : 0}%`,
                        backgroundColor: 'var(--brand-warning-text)',
                        opacity: 0.85,
                      }}
                    />
                  </div>
                  <span className="brand-text text-sm font-medium whitespace-nowrap">
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

        {operationalShopData && canViewCogs && cogsStats.total > 0 && cogsStats.withCogs === cogsStats.total && (
          <div className="brand-secondary-card rounded-xl p-3 border">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass('brand-profit')}`}>
                <DollarSign className="w-4 h-4 shrink-0" />
              </div>
              <p className="brand-profit text-sm font-medium">
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

          {/* Top metrics: GMV, Gross Profit, Net Profit (expandable breakdowns) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* GMV Card */}
            <div className="brand-card rounded-2xl overflow-hidden">
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
                className="w-full p-6 md:p-8 text-left cursor-pointer brand-row-hover transition-colors focus:outline-none brand-focus-ring"
                aria-expanded={expandedHero === 'gmv'}
              >
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 rounded-xl shrink-0 brand-state-info">
                      <DollarSign className="w-6 h-6" />
                    </div>
                    <p className="brand-muted text-sm font-semibold uppercase tracking-widest">
                      {operationalShopData ? 'Gross Merchandise Value' : 'Gross sales (statements)'}
                    </p>
                  </div>
                  <ChevronDown className={`w-5 h-5 shrink-0 brand-muted mt-1 transition-transform ${expandedHero === 'gmv' ? 'rotate-180' : ''}`} aria-hidden />
                </div>
                <p className="text-5xl font-bold brand-text tracking-tight">{formatCurrency(financials.grossSalesGMV)}</p>
                <p className="brand-muted text-sm mt-3">
                  {operationalShopData
                    ? 'Total revenue generated from all orders · click for breakdown'
                    : 'From synced TikTok settlement transactions · order-level GMV is not loaded for your role'}
                </p>
              </div>
              {expandedHero === 'gmv' && (
                <div className="px-6 md:px-8 pb-6 md:pb-8 pt-0 border-t space-y-2 text-sm" style={{ borderColor: 'var(--brand-card-border)' }}>
                  <p className="brand-muted text-xs uppercase tracking-wide mb-2">
                    {operationalShopData
                      ? 'How this total is built (orders in date range)'
                      : 'Rollup from statement transaction revenue'}
                  </p>
                  {heroGmvLines.map((row, i) => (
                    <div key={i} className="flex justify-between gap-3">
                      <span className="brand-muted">{row.label}</span>
                      <span className={`font-mono tabular-nums ${row.value < 0 ? 'brand-loss' : 'brand-text'}`}>
                        {row.value < 0 ? '-' : ''}{formatCurrency(Math.abs(row.value))}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-3 pt-2 border-t mt-2 font-semibold" style={{ borderColor: 'var(--brand-card-border)' }}>
                    <span className="brand-text">
                      {operationalShopData ? 'Gross Merchandise Value' : 'Gross sales (statements)'}
                    </span>
                    <span className="font-mono tabular-nums brand-text">{formatCurrency(financials.grossSalesGMV)}</span>
                  </div>
                  {operationalShopData && refunds > 0.005 && (
                    <>
                      <div className="flex justify-between gap-3 pt-2">
                        <span className="brand-muted">Refunds (cancelled/refunded orders)</span>
                        <span className="font-mono tabular-nums brand-loss">-{formatCurrency(refunds)}</span>
                      </div>
                      <div className="flex justify-between gap-3 font-medium">
                        <span className="brand-text">Net revenue (used downstream)</span>
                        <span className="font-mono tabular-nums brand-profit">{formatCurrency(netRevenue)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Gross profit (orders) or Net sales (statements only) */}
            <div className="brand-card rounded-2xl overflow-hidden">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleHero('grossProfit')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleHero('grossProfit');
                  }
                }}
                className="w-full p-6 md:p-8 text-left cursor-pointer brand-row-hover transition-colors focus:outline-none brand-focus-ring"
                aria-expanded={expandedHero === 'grossProfit'}
              >
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 rounded-xl shrink-0 brand-state-info">
                      <Wallet className="w-6 h-6" />
                    </div>
                    <p className="brand-muted text-sm font-semibold uppercase tracking-widest truncate">
                      {operationalShopData ? 'Gross Profit' : 'Net Sales'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span onClick={e => e.stopPropagation()} className="inline-flex">
                      <CalculationTooltip
                        source={operationalShopData ? 'Calculated in app' : 'TikTok Shop statements'}
                        calculation={
                          operationalShopData
                            ? 'Net revenue (orders, after refunds) − product COGS − product shipping cost − affiliate commission.'
                            : 'Net sales from synced settlement data (TikTok statement rollup). No order or COGS allocation.'
                        }
                        api={
                          operationalShopData
                            ? 'TikTok API: none (computed from orders + synced fee rollups)'
                            : 'GET /finance/pl-data → statement_totals.total_net_sales'
                        }
                      />
                    </span>
                    <ChevronDown className={`w-5 h-5 brand-muted transition-transform ${expandedHero === 'grossProfit' ? 'rotate-180' : ''}`} aria-hidden />
                  </div>
                </div>
                {isRestricted('gross_profit') && operationalShopData ? (
                  <>
                    <p className="text-5xl font-bold tracking-tight text-gray-400">Restricted</p>
                    <p className="brand-muted text-sm mt-3">Hidden by seller visibility policy</p>
                  </>
                ) : (
                  <>
                    <p className={`text-5xl font-bold tracking-tight ${
                      operationalShopData
                        ? (financials.grossProfit >= 0 ? 'brand-profit' : 'brand-loss')
                        : (financials.statementNetSales >= 0 ? 'brand-profit' : 'brand-loss')
                    }`}>
                      {(operationalShopData ? financials.grossProfit : financials.statementNetSales) < 0 ? '-' : ''}
                      {formatCurrency(
                        Math.abs(operationalShopData ? financials.grossProfit : financials.statementNetSales),
                      )}
                    </p>
                    <p className="brand-muted text-sm mt-3">
                      {operationalShopData
                        ? 'After product COGS, shipping, and affiliate · click for breakdown'
                        : 'From TikTok statement sync · click for revenue detail'}
                    </p>
                  </>
                )}
              </div>
              {expandedHero === 'grossProfit' && (!isRestricted('gross_profit') || !operationalShopData) && (
                <div className="px-6 md:px-8 pb-6 md:pb-8 pt-0 border-t space-y-2 text-sm" style={{ borderColor: 'var(--brand-card-border)' }}>
                  <p className="brand-muted text-xs uppercase tracking-wide mb-2">
                    {operationalShopData ? 'How gross profit is built' : 'Net sales detail (statement transactions)'}
                  </p>
                  {heroGrossProfitLines.map((row, i) => {
                    const isTot = 'emphasis' in row && row.emphasis === 'total';
                    const neg = row.value < -0.005;
                    const cls = isTot
                      ? 'brand-text font-bold text-base pt-2 border-t mt-1'
                      : '';
                    return (
                      <div key={i} className={`flex justify-between gap-3 ${cls}`}>
                        <span className={isTot ? 'brand-text' : 'brand-muted'}>{row.label}</span>
                        <span
                          className={`font-mono tabular-nums ${
                            isTot
                              ? (row.value >= 0 ? 'brand-profit' : 'brand-loss')
                              : neg
                                ? 'brand-loss'
                                : row.value > 0.005
                                  ? 'brand-profit'
                                  : 'brand-text'
                          }`}
                        >
                          {row.value < 0 ? '-' : ''}{formatCurrency(Math.abs(row.value))}
                        </span>
                      </div>
                    );
                  })}
                  {operationalShopData && (
                    <div className="flex justify-between gap-3 pt-2 border-t mt-2 font-semibold" style={{ borderColor: 'var(--brand-card-border)' }}>
                      <span className="brand-text">Gross profit</span>
                      <span className={`font-mono tabular-nums ${financials.grossProfit >= 0 ? 'brand-profit' : 'brand-loss'}`}>
                        {financials.grossProfit < 0 ? '-' : ''}{formatCurrency(Math.abs(financials.grossProfit))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Net profit (orders) or Total settlement (statements only) */}
            <div
              className={operationalShopData ? 'rounded-2xl overflow-hidden border' : 'brand-card rounded-2xl overflow-hidden'}
              style={
                operationalShopData
                  ? {
                      backgroundColor: netProfit >= 0 ? 'var(--brand-success-bg)' : 'var(--brand-danger-bg)',
                      borderColor: netProfit >= 0 ? 'var(--brand-success-border)' : 'var(--brand-danger-border)',
                    }
                  : undefined
              }
            >
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
                className="w-full p-6 md:p-8 text-left cursor-pointer transition-colors focus:outline-none brand-row-hover brand-focus-ring"
                aria-expanded={expandedHero === 'netProfit'}
              >
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2.5 rounded-xl shrink-0 ${
                        operationalShopData
                          ? netProfit >= 0
                            ? 'brand-state-success'
                            : 'brand-state-danger'
                          : financials.settlementAmount >= 0
                            ? 'brand-state-success'
                            : 'brand-state-danger'
                      }`}
                    >
                      {(operationalShopData ? netProfit : financials.settlementAmount) >= 0 ? (
                        <TrendingUp className="w-6 h-6" />
                      ) : (
                        <TrendingDown className="w-6 h-6" />
                      )}
                    </div>
                    <p className="brand-muted text-sm font-semibold uppercase tracking-widest">
                      {operationalShopData ? 'Net Profit' : 'Total Settlement'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!operationalShopData && (
                      <span onClick={e => e.stopPropagation()} className="inline-flex">
                        <CalculationTooltip
                          source="TikTok Shop statements"
                          calculation="Total settlement amount from Seller Center settlement files for the selected range (not a recomputed profit line)."
                          api="GET /finance/pl-data → statement_totals.total_settlement"
                        />
                      </span>
                    )}
                    <ChevronDown className={`w-5 h-5 shrink-0 brand-muted mt-1 transition-transform ${expandedHero === 'netProfit' ? 'rotate-180' : ''}`} aria-hidden />
                  </div>
                </div>
                {isRestricted('net_profit') && operationalShopData ? (
                  <>
                    <p className="text-5xl font-bold tracking-tight text-gray-400">Restricted</p>
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                      <span className="text-sm font-medium text-gray-400">Hidden by seller visibility policy</span>
                    </div>
                  </>
                ) : (
                  <>
                    <p
                      className={`text-5xl font-bold tracking-tight ${
                        (operationalShopData ? netProfit : financials.settlementAmount) >= 0 ? 'brand-profit' : 'brand-loss'
                      }`}
                    >
                      {(operationalShopData ? netProfit : financials.settlementAmount) < 0 ? '-' : ''}
                      {formatCurrency(Math.abs(operationalShopData ? netProfit : financials.settlementAmount))}
                    </p>
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                      {operationalShopData ? (
                        <>
                          <span className={`text-sm font-medium ${netProfit >= 0 ? 'brand-profit' : 'brand-loss'}`}>
                            {operatingIncomePct.toFixed(1)}% of net revenue
                          </span>
                          <span className="brand-muted text-xs">
                            · After product costs, affiliate, and operating expenses · click for math
                          </span>
                        </>
                      ) : (
                        <span className="brand-muted text-xs">
                          TikTok statement rollup · click for fees, shipping, and adjustments reference
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
              {expandedHero === 'netProfit' && (!isRestricted('net_profit') || !operationalShopData) && (
                <div className="px-6 md:px-8 pb-6 md:pb-8 pt-0 border-t space-y-2 text-sm" style={{ borderColor: 'var(--brand-card-border)' }}>
                  <p className="brand-muted text-xs uppercase tracking-wide mb-2">
                    {operationalShopData ? 'Net profit calculation' : 'Statement settlement rollup (reference)'}
                  </p>
                  {heroNetProfitLines.map((row, i) => {
                    const isSub = row.emphasis === 'subtotal';
                    const isTot = row.emphasis === 'total';
                    const neg = row.value < -0.005;
                    const cls = isTot
                      ? 'brand-text font-bold text-base pt-2 border-t mt-1'
                      : isSub
                        ? 'brand-text font-semibold pt-2 border-t mt-1'
                        : '';
                    const totalForTone = operationalShopData ? netProfit : financials.settlementAmount;
                    return (
                      <div key={i} className={`flex justify-between gap-3 ${cls}`}>
                        <span className={isTot || isSub ? 'brand-text' : 'brand-muted'}>{row.label}</span>
                        <span
                          className={`font-mono tabular-nums ${
                            isTot
                              ? totalForTone >= 0
                                ? 'brand-profit'
                                : 'brand-loss'
                              : neg
                                ? 'brand-loss'
                                : row.value > 0.005
                                  ? 'brand-profit'
                                  : 'brand-text'
                          }`}
                          style={isSub ? { color: 'var(--brand-info-text)' } : undefined}
                        >
                          {row.value < 0 ? '-' : ''}{formatCurrency(Math.abs(row.value))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {operationalShopData && (
          <>
          {/* ═══════════════════ REVENUE SECTION ═══════════════════ */}
          <div className="brand-card rounded-xl p-6">
            <h3 className="text-lg font-semibold brand-text mb-2">Revenue</h3>
            <p className="brand-muted text-sm mb-4">Breakdown of GMV (Gross Merchandise Value) = (Price × Items Sold) + Shipping Fees - Seller Discounts - Platform Discounts</p>
            <div className="space-y-1">

              {/* Original Product Price (Price × Items Sold) */}
              <ExpandableItem
                icon={<Package className="w-5 h-5 shrink-0" />}
                title="Product Price (Before Discounts)"
                subtitle="Price × Items Sold"
                value={formatCurrency(financials.gmvOriginalProductPrice)}
                valueColor={plSignedMetricClass(financials.gmvOriginalProductPrice)}
                tooltip={{
                  source: "Orders",
                  calculation: "Sum(original_total_product_price)",
                  api: "GET /orders/search"
                }}
              />

              {/* Shipping Fees */}
              <ExpandableItem
                icon={<Truck className="w-5 h-5 shrink-0" />}
                title="Shipping Fees"
                subtitle="Total shipping charges"
                value={formatCurrency(financials.gmvShippingFees)}
                valueColor={plSignedMetricClass(financials.gmvShippingFees)}
                tooltip={{
                  source: "Orders",
                  calculation: "Sum(shipping_fee)",
                  api: "GET /orders/search"
                }}
              />

              {/* Seller Discounts */}
              {financials.gmvSellerDiscounts > 0 && (
                <ExpandableItem
                  icon={<DollarSign className="w-5 h-5 shrink-0" />}
                  title="Seller Discounts"
                  subtitle="Promotional discounts by seller"
                  value={formatCurrency(financials.gmvSellerDiscounts)}
                  valueColor={plExpenseMetricClass(financials.gmvSellerDiscounts)}
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
                  icon={<DollarSign className="w-5 h-5 shrink-0" />}
                  title="Platform Discounts"
                  subtitle="Co-funded promotional discounts"
                  value={formatCurrency(financials.gmvPlatformDiscounts)}
                  valueColor={plExpenseMetricClass(financials.gmvPlatformDiscounts)}
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
                  icon={<DollarSign className="w-5 h-5 shrink-0" />}
                  title="Returns/Refunds"
                  subtitle="Cancelled and refunded orders (Ex. Tax)"
                  value={formatCurrency(financials.refunds)}
                  valueColor={plExpenseMetricClass(financials.refunds)}
                  isNegative
                  tooltip={{
                    source: "Orders",
                    calculation: "Sum of GMV for cancelled/refunded orders",
                    api: "GET /orders/search"
                  }}
                />
              )}

              {/* Total GMV — matches Overview GMV (grossSalesGMV = price + shipping - discounts) */}
              <div className="flex items-center justify-between py-4 brand-card rounded-lg px-4 mt-2">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(plSignedMetricClass(financials.grossSalesGMV))}`}>
                    <TrendingUp className="w-5 h-5 shrink-0" />
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
                <p className={`text-2xl font-bold ${plSignedMetricClass(financials.grossSalesGMV)}`}>{formatCurrency(financials.grossSalesGMV)}</p>
              </div>
            </div>
          </div>
          </>
          )}

          {/* ═══════════════════ OPERATING EXPENSES ═══════════════════ */}
          <div className="brand-card rounded-xl p-6">
            <h3 className="text-lg font-semibold brand-text mb-2">Operating Expenses</h3>
            <p className="brand-muted text-sm mb-4">
              {!operationalShopData
                ? hasTransactionData
                  ? 'Fees, shipping, marketing, and agency lines from synced TikTok statements. Order-based revenue and product COGS are not shown because shop order data is not loaded for your role.'
                  : 'Summary from settlement statements — sync finance to load itemized breakdowns.'
                : hasTransactionData
                  ? 'Platform, shipping, marketing, and agency lines from statement transactions. COGS and affiliate commissions appear below for drill-down; they reduce gross profit first. The summary at the bottom shows operating expense totals before and after excluding those direct costs.'
                  : 'Summary from settlement statements — sync to get itemized breakdowns. COGS and affiliate commissions are listed below when visible; the footer compares the full rollup (before exclusion) with OpEx-only (after exclusion) for net profit.'}
            </p>
            <div className="space-y-1">
              {/* Platform Fees & Commissions */}
              {!isRestricted('platform_fees') && (
              <ExpandableItem
                icon={<Receipt className="w-5 h-5 shrink-0" />}
                title="Platform Fees"
                subtitle={hasTransactionData ? 'Itemized from transactions' : 'From settlement data'}
                value={formatCurrency(hasTransactionData ? Math.abs(platformFees) : totalFees)}
                valueColor={plExpenseMetricClass(hasTransactionData ? Math.abs(platformFees) : totalFees)}
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
                    />
                  ) : (
                    <p className="brand-muted text-sm">Sync finance data to see itemized fee breakdown</p>
                  )
                }
              />
              )}

              {/* Agency Fees */}
              {!isRestricted('agency_fees') && !isRestricted('custom_line_items') && (
              <ExpandableItem
                icon={<Building2 className="w-5 h-5 shrink-0" />}
                title="Agency Fees"
                subtitle="Manual agency service fees"
                value={formatCurrency(totalAgencyFees)}
                valueColor={plExpenseMetricClass(totalAgencyFees)}
                isNegative
                tooltip={{
                  source: "Manual Entry (prorated)",
                  calculation: "Retainer: daily share of period amount on each shop-calendar day in range. Commission: % × (GMV | net revenue | gross profit) × active days ÷ range days.",
                  api: "Supabase agency_fees + in-app rollup",
                }}
                expandedContent={
                  <div className="space-y-4">
                    <div className="brand-card rounded-lg p-3 space-y-2">
                      <p className="text-xs font-semibold brand-text uppercase tracking-wide">How this is calculated</p>
                      <ul className="text-xs brand-muted space-y-1.5 list-disc pl-4 leading-relaxed">
                        {agencyFeeSummaryNotes.map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ul>
                    </div>

                    {agencyFeeLines.length > 0 && (
                      <div className="rounded-lg border p-3 space-y-3 brand-card">
                        <p className="text-xs font-medium brand-text">
                          Amounts for {dateRange.startDate} → {dateRange.endDate}
                        </p>
                        {agencyFeeLines.map((line) => (
                          <div key={line.id} className="border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: 'var(--brand-card-border)' }}>
                            <div className="flex justify-between gap-2 items-start">
                              <div>
                                <p className="text-sm font-medium brand-text">{line.agencyName}</p>
                                <p className="text-[11px] brand-muted mt-0.5">
                                  Starts {line.feeStartDate} · {line.feeType}
                                  {line.feeType !== 'commission' ? ` · ${line.recurrence}` : ''}
                                </p>
                              </div>
                              <span className="text-sm font-semibold brand-loss shrink-0">{formatCurrency(line.total)}</span>
                            </div>
                            <ul className="mt-2 space-y-1 text-[11px] brand-muted leading-snug">
                              {line.notes.map((n, j) => (
                                <li key={j}>{n}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="brand-card rounded-lg p-3">
                      <p className="brand-muted text-xs leading-relaxed">
                        These costs reduce net profit after gross profit. Edit definitions below; the card total always reflects proration for the selected range.
                      </p>
                    </div>

                    {/* Manual Agency Fees List */}
                    <div className="border-t pt-4" style={{ borderColor: 'var(--brand-card-border)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium brand-text">Configured fees</h4>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canMutateShop) setIsAgencyModalOpen(true);
                          }}
                          disabled={!canMutateShop}
                          title={!canMutateShop ? 'Read-only for your role' : undefined}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors border disabled:opacity-40 disabled:pointer-events-none"
                          style={{ backgroundColor: 'var(--brand-info-bg)', color: 'var(--brand-info-text)', borderColor: 'var(--brand-info-border)' }}
                        >
                          <Plus size={14} />
                          Add Fee
                        </button>
                      </div>

                      {agencyFees.length === 0 ? (
                        <p className="brand-muted text-xs italic">No manual agency fees on file for this shop (through {dateRange.endDate}).</p>
                      ) : (
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                          {agencyFees.map((fee) => {
                            const rolled = agencyFeeLines.find((l) => l.id === fee.id);
                            const periodAmt = rolled?.total ?? 0;
                            return (
                              <div key={fee.id} className="flex items-center justify-between p-2 rounded border gap-2 brand-card">
                                <div className="min-w-0">
                                  <p className="text-sm brand-text font-medium truncate">{fee.agency_name}</p>
                                  <div className="flex flex-wrap items-center gap-x-2 text-xs brand-muted">
                                    <span>Starts {fee.date}</span>
                                    {fee.description && (
                                      <>
                                        <span>•</span>
                                        <span className="truncate max-w-[140px]">{fee.description}</span>
                                      </>
                                    )}
                                  </div>
                                  <p className="text-[11px] brand-muted mt-1">
                                    This range: <span className="brand-loss">{formatCurrency(periodAmt)}</span>
                                    {fee.fee_type !== 'commission' &&
                                      Number(fee.retainer_amount ?? fee.amount ?? 0) > 0 && (
                                      <span className="brand-muted">
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
                                    className="brand-muted transition-colors p-1 disabled:opacity-30 disabled:pointer-events-none"
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
              )}

              {canViewCustomLineItems && !isRestricted('custom_line_items') && (
                <ExpandableItem
                  icon={<ListOrdered className="w-5 h-5 shrink-0" />}
                  title="Custom P&L lines"
                  subtitle="Seller-defined · UTC calendar dates · overlap the report range; long segments are prorated by calendar days in range"
                  value={formatCurrency(customPlNetDisplay)}
                  valueColor={plSignedMetricClass(customPlNetDisplay)}
                  isNegative={customPlNetDisplay < 0}
                  tooltip={{
                    source: 'Manual (database)',
                    calculation:
                      'Line structure from pl_custom_line_items; amounts from pl_custom_line_item_values where the value date range overlaps the P&L period (inclusive, UTC calendar). If a value covers more calendar days than the selected report, only the overlapping portion counts — prorated by calendar days in range vs segment length.',
                    api: 'GET /finance/pl-data (custom_line_items)',
                  }}
                  expandedContent={
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs brand-muted">
                          Manage structure and dated amounts for this shop (UTC calendar).
                        </p>
                        {canMutateShop && shopId && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setIsCustomPlModalOpen(true);
                            }}
                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
                            style={{
                              backgroundColor: 'var(--brand-interactive-hover-bg)',
                              color: 'var(--brand-primary)',
                              borderColor: 'var(--brand-card-border)',
                            }}
                          >
                            Manage lines & values
                          </button>
                        )}
                      </div>
                        {canMutateShop && shopId && customPlPayload && (
                          <div
                            className="flex flex-wrap items-center gap-2 pt-2 mt-1 border-t text-xs"
                            style={{ borderColor: 'var(--brand-card-border)' }}
                          >
                            <span className="brand-muted shrink-0">No value in this date range:</span>
                            <div className="inline-flex rounded-md border overflow-hidden shrink-0" style={{ borderColor: 'var(--brand-card-border)' }}>
                              <button
                                type="button"
                                disabled={customPlEmptyDisplaySaving}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void saveCustomPlEmptyDisplay('zero');
                                }}
                                className={`px-2 py-1 font-medium transition-colors ${
                                  (customPlPayload.empty_amount_in_range_display ?? 'zero') === 'zero'
                                    ? 'brand-text'
                                    : 'brand-muted hover:opacity-90'
                                }`}
                                style={{
                                  backgroundColor:
                                    (customPlPayload.empty_amount_in_range_display ?? 'zero') === 'zero'
                                      ? 'var(--brand-interactive-hover-bg)'
                                      : 'transparent',
                                }}
                              >
                                Show $0.00
                              </button>
                              <button
                                type="button"
                                disabled={customPlEmptyDisplaySaving}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void saveCustomPlEmptyDisplay('null');
                                }}
                                className={`px-2 py-1 font-medium border-l transition-colors ${
                                  customPlPayload.empty_amount_in_range_display === 'null'
                                    ? 'brand-text'
                                    : 'brand-muted hover:opacity-90'
                                }`}
                                style={{
                                  borderColor: 'var(--brand-card-border)',
                                  backgroundColor:
                                    customPlPayload.empty_amount_in_range_display === 'null'
                                      ? 'var(--brand-interactive-hover-bg)'
                                      : 'transparent',
                                }}
                              >
                                Show blank (—)
                              </button>
                            </div>
                          </div>
                        )}
                      {!customPlPayload?.lines?.length ? (
                        <p className="brand-muted text-sm italic">No custom lines configured for this shop.</p>
                      ) : (
                        <div className="space-y-2">
                          {customPlPayload.lines.map(row => (
                            <div
                              key={row.id}
                              className="flex justify-between gap-2 text-sm border-b pb-2 last:border-0"
                              style={{ borderColor: 'var(--brand-card-border)' }}
                            >
                              <div className="min-w-0">
                                <p className="brand-text font-medium truncate">
                                  {row.name}
                                  {!row.is_active && <span className="text-xs brand-muted ml-1">(inactive)</span>}
                                </p>
                                <p className="text-xs brand-muted capitalize">{row.category.replace(/_/g, ' ')}</p>
                              </div>
                              <span
                                className={`font-mono tabular-nums shrink-0 ${
                                  row.amount_in_range === null ? 'brand-muted' : plSignedMetricClass(row.amount_in_range)
                                }`}
                              >
                                {formatCurrency(row.amount_in_range)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  }
                />
              )}

              {/* Ad Spend / Marketing */}
              {!isRestricted('ad_spend') && (
              <ExpandableItem
                icon={<Megaphone className="w-5 h-5 shrink-0" />}
                title="Marketing / Ad Spend"
                subtitle={adsConnected
                  ? `TikTok Ads API + Shop Settlement Deductions`
                  : "TikTok advertising costs (connect Ads account to populate)"}
                value={formatCurrency(adSpend)}
                valueColor={plExpenseMetricClass(adSpend)}
                isNegative={adSpend > 0}
                tooltip={{
                  source: adsConnected ? "TikTok Business API + Shop Settlements" : "Not Available",
                  calculation: "Marketing API Spend + Shop Ads Fees (TAP from settlements); affiliate ads amounts appear under Affiliate commission",
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
                    />
                  ) : (
                    <p className="brand-muted text-sm">Connect your TikTok Ads account in the Marketing tab to include ad spend in your P&L.</p>
                  )
                }
              />
              )}

              {/* Service Fees */}
              {serviceFees > 0 && !isRestricted('platform_fees') && (
                <ExpandableItem
                  icon={<DollarSign className="w-5 h-5 shrink-0" />}
                  title="Service Fees"
                  subtitle="TikTok service and promotion fees"
                  value={formatCurrency(serviceFees)}
                  valueColor={plExpenseMetricClass(serviceFees)}
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
                      />
                    ) : (
                      <p className="brand-muted text-sm">No detailed itemization available for these service fees.</p>
                    )
                  }
                />
              )}

              {/* Shipping Costs (includes FBT Fulfillment Fees) */}
              {!isRestricted('shipping_costs') && (
              <ExpandableItem
                icon={<Truck className="w-5 h-5 shrink-0" />}
                title="Shipping Costs"
                subtitle={`${hasTransactionData ? 'Itemized shipping breakdown' : 'From settlement data'} (excl. FBT)`}
                value={totalShipping > 0 ? formatCurrency(totalShipping) : '$0.00'}
                valueColor={plExpenseMetricClass(totalShipping)}
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
                      />
                    ) : (
                      <p className="brand-muted text-sm">Sync finance data to see itemized shipping breakdown</p>
                    )}
                    {/* Shipping subtotal (included in OpEx) */}
                    {totalShipping > 0 && (
                      <div className="flex justify-between text-xs brand-muted pt-1 border-t mt-2" style={{ borderColor: 'var(--brand-card-border)' }}>
                        <span>Shipping subtotal (in OpEx)</span>
                        <span>{formatCurrency(totalShipping)}</span>
                      </div>
                    )}
                    {/* FBT fees — shown for reference, excluded from OpEx calculation */}
                    {operationalShopData && fbtFees > 0 && (
                      <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--brand-card-border)' }}>
                        <p className="text-xs brand-muted mb-2 uppercase tracking-wide">FBT Fees (excluded from OpEx)</p>
                        <div className="flex justify-between text-sm opacity-50">
                          <span className="line-through brand-muted">FBT Fulfillment Fee</span>
                          <span className="line-through brand-muted">{formatCurrency(fbtFees)}</span>
                        </div>
                        <p className="brand-muted text-xs mt-1 line-through">
                          From {orders.filter((o: any) => o.fbt_fulfillment_fee && o.fbt_fulfillment_fee > 0).length} FBT orders
                        </p>
                        <div className="flex justify-between text-xs brand-muted pt-2 mt-1 border-t" style={{ borderColor: 'var(--brand-card-border)' }}>
                          <span>Total incl. FBT (reference only)</span>
                          <span>{formatCurrency(totalShipping + fbtFees)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                }
              />
              )}

              {/* COGS & affiliate: same economics as gross profit (not included in OpEx total below) */}
              {operationalShopData && canViewCogs && (
              <ExpandableItem
                icon={<Package className="w-5 h-5 shrink-0" />}
                title="Cost of Goods Sold (COGS)"
                subtitle={cogsStats.total > 0
                  ? (cogsStats.withCogs > 0
                    ? `${cogsStats.withCogs}/${cogsStats.total} products with COGS · reduces gross profit`
                    : 'No COGS data set — add COGS to products')
                  : 'No products with sales found'}
                value={cogsStats.withCogs > 0 ? formatCurrency(totalCogs) : '$0.00'}
                valueColor={plExpenseMetricClass(totalCogs)}
                isNegative={totalCogs > 0}
                tooltip={{
                  source: 'Product Catalog',
                  calculation: 'Sum(product COGS × quantity sold); excluded from total operating expenses (flows through gross profit)',
                  api: 'Manual input on products',
                }}
                expandedContent={
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="brand-muted">Products with COGS</span>
                      <span className="brand-profit">{cogsStats.withCogs}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="brand-muted">Products missing COGS</span>
                      <span className="brand-loss">{cogsStats.total - cogsStats.withCogs}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="brand-muted">Total products with sales</span>
                      <span className="brand-text">{cogsStats.total}</span>
                    </div>

                    <details
                      className="rounded-lg border overflow-hidden group"
                      style={{ borderColor: 'var(--brand-card-border)' }}
                    >
                      <summary className="cursor-pointer select-none px-3 py-2.5 flex justify-between items-center gap-2 brand-row-hover list-none [&::-webkit-details-marker]:hidden">
                        <span className="font-medium brand-text">Calculated product COGS — how this total is computed</span>
                        <ChevronDown className="w-4 h-4 shrink-0 brand-muted transition-transform group-open:rotate-180" aria-hidden />
                      </summary>
                      <div className="px-3 pb-3 pt-1 space-y-3 border-t text-xs leading-relaxed" style={{ borderColor: 'var(--brand-card-border)' }}>
                        <p className="brand-muted">
                          Sum of <span className="brand-text font-medium">unit COGS × quantity</span> for every line item on{' '}
                          <span className="brand-text font-medium">{cogsStats.regularOrdersCogsDetail.qualifyingOrders}</span>{' '}
                          qualifying paid orders ({cogsStats.regularOrdersCogsDetail.lineItems} line items). Orders exclude{' '}
                          <span className="brand-text">returns</span>, <span className="brand-text">samples</span>, and{' '}
                          <span className="brand-text">cancelled/refunded</span> (same window as this COGS total).
                        </p>
                        <p className="brand-muted">
                          <span className="font-medium brand-text">Unit COGS</span> uses the amount{' '}
                          <span className="brand-text">stored on the order line</span> when TikTok synced it (historical snapshot).
                          If missing, Mamba uses <span className="brand-text">current catalog COGS</span>, preferring{' '}
                          <span className="brand-text">SKU-level COGS</span> when the line has a seller SKU match.
                        </p>
                        <div className="rounded-md brand-card p-2.5 space-y-1.5">
                          <div className="flex justify-between gap-3">
                            <span className="brand-muted">Portion from order snapshot COGS</span>
                            <span className="font-mono tabular-nums brand-loss shrink-0">
                              {formatCurrency(cogsStats.regularOrdersCogsDetail.fromOrderSnapshot)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="brand-muted">Portion from catalog / SKU fallback</span>
                            <span className="font-mono tabular-nums brand-loss shrink-0">
                              {formatCurrency(cogsStats.regularOrdersCogsDetail.fromCatalogFallback)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-3 pt-1.5 border-t font-medium text-sm" style={{ borderColor: 'var(--brand-card-border)' }}>
                            <span className="brand-text">Total calculated product COGS</span>
                            <span className="font-mono tabular-nums brand-loss shrink-0">{formatCurrency(totalCogs)}</span>
                          </div>
                        </div>

                        {cogsStats.regularOrdersCogsDetail.breakdown.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-[11px] font-semibold brand-text uppercase tracking-wide">By SKU / product (sorted by cost)</p>
                            <div className="max-h-56 overflow-y-auto pr-1 custom-scrollbar rounded-md border brand-card" style={{ borderColor: 'var(--brand-card-border)' }}>
                              <div className="flex items-center gap-2 text-[10px] brand-muted uppercase tracking-wider px-2 py-1.5 border-b sticky top-0 bg-[var(--brand-card-bg)] z-[1]" style={{ borderColor: 'var(--brand-card-border)' }}>
                                <span className="flex-1 min-w-0">Product / SKU</span>
                                <span className="w-10 text-center shrink-0">Qty</span>
                                <span className="w-[4.5rem] text-right shrink-0">Unit</span>
                                <span className="w-[4.5rem] text-right shrink-0">Total</span>
                                <span className="w-16 text-right shrink-0 hidden sm:inline">Source</span>
                              </div>
                              <div className="divide-y" style={{ borderColor: 'var(--brand-card-border)' }}>
                                {cogsStats.regularOrdersCogsDetail.breakdown.map((row) => {
                                  const src =
                                    row.fromSnapshot > 0.01 && row.fromCatalog > 0.01
                                      ? 'Mixed'
                                      : row.fromSnapshot > 0.01
                                        ? 'Snapshot'
                                        : 'Catalog';
                                  return (
                                    <div key={row.skuKey} className="flex items-start gap-2 px-2 py-1.5 text-[11px]">
                                      <div className="flex items-start gap-2 flex-1 min-w-0 pt-0.5">
                                        {row.skuImage ? (
                                          <img src={row.skuImage} alt="" className="w-7 h-7 rounded object-cover shrink-0 mt-0.5" />
                                        ) : (
                                          <div className="w-7 h-7 rounded brand-card flex items-center justify-center shrink-0 mt-0.5">
                                            <Package className="w-3.5 h-3.5 brand-muted" />
                                          </div>
                                        )}
                                        <div className="min-w-0">
                                          <p className="brand-text truncate">{row.productName}</p>
                                          {(row.skuName || row.skuKey) && (
                                            <p className="brand-muted truncate text-[10px]">{row.skuName || row.skuKey}</p>
                                          )}
                                        </div>
                                      </div>
                                      <span className="w-10 text-center brand-text font-medium shrink-0 pt-1">{row.quantity}</span>
                                      <span className="w-[4.5rem] text-right brand-muted shrink-0 font-mono tabular-nums pt-1">
                                        {formatCurrency(row.unitCogs)}
                                      </span>
                                      <span className="w-[4.5rem] text-right brand-loss font-medium shrink-0 font-mono tabular-nums pt-1">
                                        {formatCurrency(row.totalCogs)}
                                      </span>
                                      <span className="w-16 text-right brand-muted shrink-0 pt-1 hidden sm:inline">{src}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="brand-muted italic">No qualifying line items in this range.</p>
                        )}
                      </div>
                    </details>

                    <p className="brand-muted text-xs">Go to Products → open a product → add COGS.</p>
                  </div>
                }
              />
              )}

              {!hideAffiliatePlSection && (
              <ExpandableItem
                icon={<Users className="w-5 h-5 shrink-0" />}
                title="Affiliate Commissions"
                subtitle="Automatic (statement) + manual retainers · reduces gross profit"
                value={formatCurrency(totalAffiliateCost)}
                valueColor={plExpenseMetricClass(totalAffiliateCost)}
                isNegative={totalAffiliateCost > 0}
                tooltip={{
                  source: 'Statement Transactions + Manual',
                  calculation: 'Affiliate-related fee lines from synced statements (net of reversals) + manual retainers; excluded from total operating expenses (flows through gross profit)',
                  api: 'GET /finance/pl-data',
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
                              value: Math.abs(plData.fees[k] || 0),
                            }))
                          : [{ label: 'Automatic Commission (TikTok)', value: autoAffiliateCommission }]
                        ),
                        { label: 'Manual Retainers', value: manualAffiliateRetainers },
                      ]}
                    />

                    <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--brand-card-border)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium brand-text">Manual Retainers</h4>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canMutateShop) setIsAffiliateModalOpen(true);
                          }}
                          disabled={!canMutateShop}
                          title={!canMutateShop ? 'Read-only for your role' : undefined}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors border disabled:opacity-40 disabled:pointer-events-none"
                          style={{ backgroundColor: 'var(--brand-interactive-hover-bg)', color: 'var(--brand-primary)', borderColor: 'var(--brand-card-border)' }}
                        >
                          <Plus size={14} />
                          Add Retainer
                        </button>
                      </div>

                      {affiliateSettlementsInRange.length === 0 ? (
                        <p className="brand-muted text-xs italic">No manual retainers for this period.</p>
                      ) : (
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                          {affiliateSettlementsInRange.map(settlement => (
                            <div key={settlement.id} className="flex items-center justify-between p-2 rounded border brand-card">
                              <div>
                                <p className="text-sm brand-text font-medium">{settlement.affiliate_name}</p>
                                <div className="flex items-center gap-2 text-xs brand-muted">
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
                                <span className="brand-loss text-sm font-medium">{formatCurrency(settlement.amount)}</span>
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteRetainer(settlement.id, e)}
                                  disabled={!canMutateShop}
                                  title={!canMutateShop ? 'Read-only for your role' : 'Delete Retainer'}
                                  className="brand-muted transition-colors p-1 disabled:opacity-30 disabled:pointer-events-none"
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
              )}

              {/* Operating expense totals + operating income — order-level gross profit bridge only */}
              {operationalShopData && (
              <>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between py-4 rounded-lg px-4 mt-2 brand-state-danger">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(plExpenseMetricClass(operatingExpenses))}`}>
                    <TrendingDown className="w-5 h-5 shrink-0" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-lg font-bold brand-text">Operating expense totals</p>
                      <CalculationTooltip
                        source="Calculated"
                        calculation="Before exclusion = OpEx for net profit + product COGS + affiliate commissions (matches summing every row in this section). After exclusion = fees, shipping (excl. FBT), marketing, and agency only — this is subtracted from gross profit for operating income."
                        api="Calculated"
                      />
                    </div>
                    <p className="text-xs brand-muted mt-0.5">
                      Before exclusion adds COGS and affiliate to the OpEx total. After exclusion is what drives operating income (same as gross profit math).
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-3 text-right shrink-0 sm:min-w-[13rem]">
                  <div>
                    <p className="text-[11px] font-medium brand-muted uppercase tracking-wide">Before exclusion</p>
                    <p className="text-xs brand-muted mb-0.5">Incl. COGS &amp; affiliate</p>
                    <p className={`text-xl font-bold font-mono tabular-nums ${plExpenseMetricClass(operatingExpensesBeforeExclusion)}`}>
                      -{formatCurrency(operatingExpensesBeforeExclusion)}
                    </p>
                  </div>
                  <div className="pt-2 border-t" style={{ borderColor: 'var(--brand-card-border)' }}>
                    <p className="text-[11px] font-medium brand-muted uppercase tracking-wide">After exclusion</p>
                    <p className="text-xs brand-muted mb-0.5">OpEx for operating income</p>
                    <p className={`text-2xl font-bold font-mono tabular-nums ${plExpenseMetricClass(operatingExpenses)}`}>
                      -{formatCurrency(operatingExpenses)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Operating Income */}
              <div className={`flex items-center justify-between py-4 rounded-lg px-4 mt-2 ${operatingIncome >= 0 ? 'brand-state-success' : 'brand-state-danger'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(plSignedMetricClass(operatingIncome))}`}>
                    {operatingIncome > PL_AMOUNT_EPS ? (
                      <TrendingUp className="w-5 h-5 shrink-0" />
                    ) : operatingIncome < -PL_AMOUNT_EPS ? (
                      <TrendingDown className="w-5 h-5 shrink-0" />
                    ) : (
                      <Minus className="w-5 h-5 shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-bold brand-text">Operating Income</p>
                    <CalculationTooltip
                      source="Calculated"
                      calculation="Gross Profit − Operating Expenses (after exclusion — excludes COGS and affiliate, which were already deducted in gross profit)"
                      api="Calculated"
                    />
                  </div>
                </div>
                <div className="text-right">
                  {isRestricted('net_profit') ? (
                    <>
                      <p className="text-2xl font-bold text-gray-400">Restricted</p>
                      <p className="text-sm font-medium text-gray-400">Hidden by seller policy</p>
                    </>
                  ) : (
                    <>
                      <p className={`text-2xl font-bold ${plSignedMetricClass(operatingIncome)}`}>
                        {operatingIncome < 0 ? '-' : ''}{formatCurrency(operatingIncome)}
                      </p>
                      <p className={`text-sm font-medium ${plSignedPctClass(operatingIncomePct)}`}>
                        {formatPercent(operatingIncomePct)}
                      </p>
                    </>
                  )}
                </div>
              </div>
              </>
              )}
            </div>
          </div>

          {/* ═══════════════════ SAMPLE ORDERS ═══════════════════ */}
          <div className="brand-card rounded-xl p-6">
            <h3 className="text-lg font-semibold brand-text mb-2">Sample Orders</h3>
            <p className="brand-muted text-sm mb-4">Orders marked as samples (excluded from P&L calculations)</p>

            {cogsStats.sampleOrders.count === 0 ? (
              <div className="brand-state-info rounded-lg p-4">
                <p className="brand-text text-sm text-center">
                  No sample orders found in this date range
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <ExpandableItem
                  icon={<Package className="w-5 h-5 shrink-0" />}
                  title="Sample Order Count"
                  subtitle={`${cogsStats.sampleOrders.count} sample order${cogsStats.sampleOrders.count !== 1 ? 's' : ''} across ${cogsStats.sampleOrders.skuBreakdown.length} SKU${cogsStats.sampleOrders.skuBreakdown.length !== 1 ? 's' : ''}`}
                  value={cogsStats.sampleOrders.count.toString()}
                  valueColor="brand-text"
                  tooltip={{
                    source: "Orders",
                    calculation: "Count(orders where is_sample_order=true)",
                    api: "GET /orders/search"
                  }}
                  expandedContent={
                    cogsStats.sampleOrders.skuBreakdown.length > 0 ? (
                      <div className="space-y-2 text-sm">
                        {/* Header */}
                        <div className="flex items-center gap-3 text-xs brand-muted uppercase tracking-wider pb-1 border-b" style={{ borderColor: 'var(--brand-card-border)' }}>
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
                                <div className="w-7 h-7 rounded brand-card flex items-center justify-center flex-shrink-0">
                                  <Package className="w-3.5 h-3.5 brand-muted" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="brand-text truncate text-xs">{sku.productName}</p>
                                {sku.skuName && (
                                  <p className="brand-muted truncate text-xs">{sku.skuName}</p>
                                )}
                              </div>
                            </div>
                            <span className="w-12 text-center brand-text font-medium">x{sku.quantity}</span>
                            <span className={`w-20 text-right ${sku.unitCogs > 0 ? 'brand-loss' : 'brand-muted'}`}>
                              {sku.unitCogs > 0 ? formatCurrency(sku.unitCogs) : 'N/A'}
                            </span>
                            <span className={`w-20 text-right font-medium ${sku.totalCogs > 0 ? 'brand-loss' : 'brand-muted'}`}>
                              {sku.totalCogs > 0 ? formatCurrency(sku.totalCogs) : '-'}
                            </span>
                          </div>
                        ))}
                        {/* Footer total */}
                        <div className="flex items-center gap-3 pt-2 border-t font-medium" style={{ borderColor: 'var(--brand-card-border)' }}>
                          <span className="flex-1 brand-text">Total</span>
                          <span className="w-12 text-center brand-text">
                            x{cogsStats.sampleOrders.skuBreakdown.reduce((sum, s) => sum + s.quantity, 0)}
                          </span>
                          <span className="w-20"></span>
                          <span className="w-20 text-right brand-loss">
                            {formatCurrency(cogsStats.sampleOrders.totalCogsValue)}
                          </span>
                        </div>
                      </div>
                    ) : undefined
                  }
                />

                <ExpandableItem
                  icon={<DollarSign className="w-5 h-5 shrink-0" />}
                  title="Sample Order Value"
                  subtitle="Cost of goods given away (Quantity × COGS)"
                  value={`${cogsStats.sampleOrders.gmv < 0 ? '-' : ''}${formatCurrency(cogsStats.sampleOrders.gmv)}`}
                  valueColor="brand-loss"
                  tooltip={{
                    source: "Orders & Products",
                    calculation: "Value = Quantity × COGS (negative because it's a cost)",
                    api: "GET /orders/search + product.cogs"
                  }}
                  expandedContent={
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="brand-muted">Total Sample Orders</span>
                        <span className="brand-text">{cogsStats.sampleOrders.count}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="brand-muted">Orders with COGS set</span>
                        <span className="brand-profit">{cogsStats.sampleOrders.ordersWithCogs}</span>
                      </div>
                      <div className="border-t pt-2 flex justify-between font-medium" style={{ borderColor: 'var(--brand-card-border)' }}>
                        <span className="brand-text">Sample Order Value (Cost)</span>
                        <span className="brand-loss">
                          {cogsStats.sampleOrders.gmv < 0 ? '-' : ''}{formatCurrency(cogsStats.sampleOrders.gmv)}
                        </span>
                      </div>
                    </div>
                  }
                />

                {/* Note about exclusion */}
                {operationalShopData && (
                <div className="mt-4 rounded-lg p-4 brand-state-info">
                  <p className="brand-text text-sm">
                    <strong>Note:</strong> Sample orders are excluded from all P&L calculations including Revenue, COGS, and Net Profit to provide accurate financial reporting.
                  </p>
                </div>
                )}
              </div>
            )}
          </div>

          {/* ═══════════════════ PROFITABILITY SUMMARY ═══════════════════ */}
          <div className="brand-card rounded-xl p-6 border">
            <h3 className="text-lg font-semibold brand-text mb-6">
              {operationalShopData ? 'Profitability Summary' : 'Statement totals'}
            </h3>
            <p className="text-sm brand-muted mb-4 -mt-2">
              {operationalShopData
                ? 'Top row: order GMV plus three TikTok statement totals. Second row: margins and profit vs order net revenue.'
                : 'Gross sales, net sales, and total settlement from TikTok statement sync only — no order-level GMV or profit metrics.'}
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {operationalShopData && (
              <div className="brand-card rounded-lg p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(plSignedMetricClass(financials.grossSalesGMV))}`}>
                    <DollarSign className="w-5 h-5 shrink-0" />
                  </div>
                  <p className="brand-muted text-sm font-medium">GMV</p>
                </div>
                <p className={`text-2xl font-bold ${plSignedMetricClass(financials.grossSalesGMV)}`}>{formatCurrency(financials.grossSalesGMV)}</p>
                <p className="text-xs brand-muted mt-1">Gross merchandise value (paid orders)</p>
              </div>
              )}

              {/* Net sales (TikTok statements) */}
              <div className="brand-card rounded-lg p-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(plSignedMetricClass(financials.statementNetSales))}`}>
                      <Receipt className="w-5 h-5 shrink-0" />
                    </div>
                    <p className="brand-muted text-sm font-medium truncate">Net Sales</p>
                  </div>
                  <CalculationTooltip
                    source="TikTok Shop settlements"
                    calculation="Sum of net_sales_amount for all statements in the selected date range (synced from TikTok)."
                    api="GET /finance/pl-data → statement_totals.total_net_sales"
                  />
                </div>
                <p className={`text-2xl font-bold ${plSignedMetricClass(financials.statementNetSales)}`}>{formatCurrency(financials.statementNetSales)}</p>
                <p className="text-xs brand-muted mt-1">Statements (TikTok)</p>
              </div>

              {/* Gross sales (TikTok statements) */}
              <div className="brand-card rounded-lg p-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(plSignedMetricClass(financials.statementGrossSales))}`}>
                      <Package className="w-5 h-5 shrink-0" />
                    </div>
                    <p className="brand-muted text-sm font-medium truncate">Gross Sales</p>
                  </div>
                  <CalculationTooltip
                    source="TikTok Shop settlements"
                    calculation="Matches Seller Center’s Gross sales line: sum of revenue breakdown Subtotal before discount (`subtotal_before_discount`) across synced statement transactions. We deliberately do not use Σ transaction revenue_amount — on TikTok that total often equals Net sales (same as Net sales tile)."
                    api="GET /finance/pl-data → statement_totals.total_gross_sales"
                  />
                </div>
                <p className={`text-2xl font-bold ${plSignedMetricClass(financials.statementGrossSales)}`}>{formatCurrency(financials.statementGrossSales)}</p>
                <p className="text-xs brand-muted mt-1">Statements (TikTok)</p>
              </div>

              {/* Total settlement amount */}
              <div className="brand-card rounded-lg p-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(plSignedMetricClass(financials.settlementAmount))}`}>
                      <CircleDollarSign className="w-5 h-5 shrink-0" />
                    </div>
                    <p className="brand-muted text-sm font-medium truncate">Total Settlement</p>
                  </div>
                  <CalculationTooltip
                    source="TikTok Shop settlements"
                    calculation="Sum of statement settlement amounts for the date range. Uses settlement_data.settlement_amount from the Finance API when present (matches Seller Center); otherwise transaction summary or net_amount."
                    api="GET /finance/pl-data → statement_totals.total_settlement"
                  />
                </div>
                <p className={`text-2xl font-bold ${plSignedMetricClass(financials.settlementAmount)}`}>{formatCurrency(financials.settlementAmount)}</p>
                <p className="text-xs brand-muted mt-1">Statements (TikTok)</p>
              </div>

              {operationalShopData && (
              <>
              {/* Gross Profit */}
              <div className="brand-card rounded-lg p-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(isRestricted('gross_profit') ? 'brand-muted' : plSignedMetricClass(financials.grossProfit))}`}>
                      <Wallet className="w-5 h-5 shrink-0" />
                    </div>
                    <p className="brand-muted text-sm font-medium truncate">Gross Profit</p>
                  </div>
                  <CalculationTooltip
                    source="Calculated in app"
                    calculation="Net Revenue − Product COGS − Product Shipping − Affiliate commission"
                    api="TikTok API: none (computed from orders + statement fee rollups)"
                  />
                </div>
                {isRestricted('gross_profit') ? (
                  <>
                    <p className="text-2xl font-bold text-gray-400">Restricted</p>
                    <p className="text-xs text-gray-500 mt-1">Hidden by seller visibility policy</p>
                  </>
                ) : (
                  <>
                    <p className={`text-2xl font-bold ${plSignedMetricClass(financials.grossProfit)}`}>
                      {financials.grossProfit < 0 ? '-' : ''}{formatCurrency(financials.grossProfit)}
                    </p>
                    <p className="text-xs brand-muted mt-1">After product COGS, shipping, and affiliate</p>
                  </>
                )}
              </div>

              {/* Gross Margin */}
              <div className="brand-card rounded-lg p-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(canViewMargin ? plSignedPctClass(financials.grossMargin) : 'brand-muted')}`}>
                      <Percent className="w-5 h-5 shrink-0" />
                    </div>
                    <p className="brand-muted text-sm font-medium truncate">Gross Margin</p>
                  </div>
                  <CalculationTooltip
                    source="Calculated in app"
                    calculation="(Gross Profit ÷ Net Revenue) × 100 — 0% when Net Revenue is 0"
                    api="TikTok API: none (computed)"
                  />
                </div>
                {canViewMargin ? (
                  <>
                    <p className={`text-2xl font-bold ${plSignedPctClass(financials.grossMargin)}`}>
                      {financials.grossMargin.toFixed(1)}%
                    </p>
                    <p className="text-xs brand-muted mt-1">Gross Profit ÷ Net Revenue</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-gray-400">Restricted</p>
                    <p className="text-xs text-gray-500 mt-1">Margin visibility restricted by seller policy</p>
                  </>
                )}
              </div>

              {/* Net Profit $ */}
              <div className="brand-card rounded-lg p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(isRestricted('net_profit') ? 'brand-muted' : plSignedMetricClass(netProfit))}`}>
                    {netProfit > PL_AMOUNT_EPS ? (
                      <TrendingUp className="w-5 h-5 shrink-0" />
                    ) : netProfit < -PL_AMOUNT_EPS ? (
                      <TrendingDown className="w-5 h-5 shrink-0" />
                    ) : (
                      <Minus className="w-5 h-5 shrink-0" />
                    )}
                  </div>
                  <p className="brand-muted text-sm font-medium">Net Profit</p>
                </div>
                {isRestricted('net_profit') ? (
                  <>
                    <p className="text-2xl font-bold text-gray-400">Restricted</p>
                    <p className="text-xs text-gray-500 mt-1">Hidden by seller visibility policy</p>
                  </>
                ) : (
                  <>
                    <p className={`text-2xl font-bold ${plSignedMetricClass(netProfit)}`}>
                      {netProfit < 0 ? '-' : ''}{formatCurrency(netProfit)}
                    </p>
                    <p className="text-xs brand-muted mt-1">Net revenue after all expenses</p>
                  </>
                )}
              </div>

              {/* Net Profit % */}
              <div className="brand-card rounded-lg p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${plSemanticToIconTileClass(isRestricted('net_profit') ? 'brand-muted' : plSignedPctClass(operatingIncomePct))}`}>
                    <PieChart className="w-5 h-5 shrink-0" />
                  </div>
                  <p className="brand-muted text-sm font-medium">Net Profit %</p>
                </div>
                {isRestricted('net_profit') ? (
                  <>
                    <p className="text-2xl font-bold text-gray-400">Restricted</p>
                    <p className="text-xs text-gray-500 mt-1">Hidden by seller visibility policy</p>
                  </>
                ) : (
                  <>
                    <p className={`text-2xl font-bold ${plSignedPctClass(operatingIncomePct)}`}>
                      {operatingIncomePct.toFixed(1)}%
                    </p>
                    <p className="text-xs brand-muted mt-1">Net Profit ÷ Net Revenue</p>
                  </>
                )}
              </div>
              </>
              )}

            </div>
          </div>

          {operationalShopData && (
          <>
          {/* ═══════════════════ PROFITABILITY CALCULATOR ═══════════════════ */}
          <div className="brand-card rounded-xl overflow-hidden">
            {/* Header — always visible */}
            <button
              type="button"
              onClick={() => setCalcOpen(!calcOpen)}
              className="w-full flex items-center justify-between p-6 transition-colors brand-row-hover rounded-none"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 brand-icon-tile-neutral">
                  <SlidersHorizontal className="w-5 h-5 shrink-0" />
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-semibold brand-text">Profitability Calculator</h3>
                  <p className="text-sm brand-muted">Adjust variables to find your break-even & profit targets</p>
                </div>
              </div>
              {calcOpen ? <ChevronUp className="w-5 h-5 brand-muted" /> : <ChevronDown className="w-5 h-5 brand-muted" />}
            </button>

            {/* Collapsible body */}
            {calcOpen && (
              <div className="border-t p-6 space-y-6" style={{ borderColor: 'var(--brand-card-border)' }}>
                {/* Reset button */}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={resetCalculator}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium brand-muted hover:brand-text rounded-lg transition-colors brand-card border"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset to Actual
                  </button>
                </div>

                {/* Slider Groups */}
                <div className="space-y-5">
                  {/* Per-Unit Economics */}
                  <div className="brand-card rounded-lg p-4">
                    <h4 className="text-sm font-semibold brand-text mb-4 flex items-center gap-2">
                      <DollarSign className="w-4 h-4 brand-muted" />
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
                  <div className="brand-card rounded-lg p-4">
                    <h4 className="text-sm font-semibold brand-text mb-4 flex items-center gap-2">
                      <Package className="w-4 h-4 brand-muted" />
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
                  <div className="brand-card rounded-lg p-4">
                    <h4 className="text-sm font-semibold brand-text mb-4 flex items-center gap-2">
                      <Wallet className="w-4 h-4 brand-muted" />
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

                {/* Simulated Results — brand-card avoids agency secondary-card accent floods */}
                <div className="brand-card rounded-xl p-5 border">
                  <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                    <h4 className="text-sm font-semibold brand-text">Simulated P&L</h4>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold shrink-0 ${simulatedPL.isProfitable ? 'brand-state-success' : 'brand-state-danger'}`}
                    >
                      {simulatedPL.isProfitable ? 'PROFITABLE' : 'AT LOSS'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <SimResultCard
                      label="Revenue"
                      value={simulatedPL.revenue}
                      delta={simulatedPL.revenueDelta}
                      formatValue={formatCurrency}
                      variant="signed"
                    />
                    <SimResultCard
                      label="COGS"
                      value={simulatedPL.cogs}
                      delta={simulatedPL.cogsDelta}
                      formatValue={formatCurrency}
                      variant="expense"
                    />
                    <SimResultCard
                      label="Gross Profit"
                      value={simulatedPL.grossProfit}
                      delta={simulatedPL.grossProfitDelta}
                      formatValue={formatCurrency}
                      variant="signed"
                    />
                    <SimResultCard
                      label="Expenses"
                      value={simulatedPL.totalExpenses}
                      delta={simulatedPL.totalExpenses - totalExpenses}
                      formatValue={formatCurrency}
                      variant="expense"
                    />
                    <SimResultCard
                      label="Net Profit"
                      value={simulatedPL.netProfit}
                      delta={simulatedPL.netProfitDelta}
                      formatValue={formatCurrency}
                      variant="signed"
                    />
                    <SimResultCard
                      label="Net Margin"
                      value={simulatedPL.margin}
                      delta={simulatedPL.marginDelta}
                      formatValue={(n) => `${n.toFixed(1)}%`}
                      variant="percent"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          </>
          )}

          {/* Data source info */}
          <div className="text-center text-gray-600 text-xs pb-4">
            {operationalShopData
              ? `Based on ${orders.length} orders in date range`
              : 'Figures from TikTok statement sync — shop orders are not loaded for your role'}
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

      {canMutateShop &&
        shopId &&
        canViewCustomLineItems &&
        !isRestricted('custom_line_items') && (
          <CustomPlManageModal
            isOpen={isCustomPlModalOpen}
            onClose={() => setIsCustomPlModalOpen(false)}
            account={account}
            shopId={shopId}
            dateRange={dateRange}
            timezone={timezone}
            lines={customPlPayload?.lines ?? []}
            onAfterSave={refreshCustomPlAfterModalSave}
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
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${delta > 0 ? 'brand-profit bg-black/15' : 'brand-loss bg-black/15'}`}>
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
        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-gray-400
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-400 [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgb(156_163_175_/_0.35)]
          [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-gray-400 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
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
  variant: 'signed' | 'expense' | 'percent';
}

function SimResultCard({ label, value, delta, formatValue, variant }: SimResultCardProps) {
  const hasDelta = Math.abs(delta) > 0.01;
  const deltaIsGood = variant === 'expense' ? delta < 0 : delta > 0;
  const valueClass =
    variant === 'expense'
      ? plExpenseMetricClass(value)
      : variant === 'percent'
        ? plSignedPctClass(value)
        : plSignedMetricClass(value);
  const deltaSemantic = deltaIsGood ? plSignedMetricClass(1) : plSignedMetricClass(-1);
  const deltaText =
    variant === 'percent'
      ? formatValue(delta)
      : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${formatValue(Math.abs(delta))}`;

  return (
    <div className="brand-card rounded-lg p-3">
      <p className="text-xs brand-muted mb-1">{label}</p>
      <p className={`text-lg font-bold ${valueClass}`}>
        {value < 0 ? '-' : ''}{formatValue(Math.abs(value))}
      </p>
      {hasDelta && (
        <p className={`text-xs font-medium mt-0.5 ${deltaSemantic}`}>{deltaText}</p>
      )}
    </div>
  );
}
