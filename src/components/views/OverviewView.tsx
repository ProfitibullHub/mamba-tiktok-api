
import { TrendingUp, Star, RefreshCw, AlertCircle, Trash2, Calendar, Settings2, X, Plus, Zap, Bell, Mail, CheckCircle } from 'lucide-react';
import { TimezoneSelector } from '../TimezoneSelector';
import { AffiliateCommissionCard } from '../AffiliateCommissionCard';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Account } from '../../lib/supabase';
import { supabase } from '../../lib/supabase';
import { apiFetch } from '../../lib/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantContext } from '../../contexts/TenantContext';
import { RefreshPrompt } from '../RefreshPrompt';
import { useShopStore, Order } from '../../store/useShopStore';
import { useTikTokAdsStore } from '../../store/useTikTokAdsStore';
import { getPreviousPeriodRange } from '../../utils/dateUtils';
import { calculateOrderGMV } from '../../utils/gmvCalculations';
import { LOAD_DAY_OPTIONS, DEFAULT_LOAD_DAYS } from '../../config/dataRetention';
import { useNotificationStore } from '../../store/useNotificationStore';
import { useShopAccessFlags } from '../../hooks/useShopMutationAccess';
import { isCancelledOrRefunded } from '../../utils/orderFinancials';
import {
  affiliateCogsFeeKeys,
  tiktokEstCommissionFeeKeys,
  tiktokEstCommissionLineLabels,
  affiliateCogsLineLabels,
  adSpendFeeKeys,
  netByKeys,
  expenseFromNet,
  shippingTotalForOperatingExpenses,
  mergeStatementFees,
  mergeStatementShipping,
  feesBaseFromStatements,
} from '../../utils/plFeeAggregation';

// Use paid_time for filtering (matches backend which loads by paid_time)
const getOrderTs = (o: Order): number => Number(o.paid_time || o.created_time);

import { DateRangePicker, DateRange } from '../DateRangePicker';
import { TokenExpirationWarning } from '../TokenExpirationWarning';
import { parseLocalDate, getShopDayStartTimestamp, getShopDayEndExclusiveTimestamp, formatShopDateISO, formatShopTimeOnly } from '../../utils/dateUtils';
import { ComparisonCharts } from '../ComparisonCharts';

interface OverviewViewProps {
  account: Account;
  shopId?: string;
  timezone?: string; // Shop timezone for date calculations
  onTimezoneChange?: (timezone: string) => void;
  onTabChange?: (tab: string) => void;
}

const getDefaultDateRange = (timezone: string): DateRange => {
  const today = new Date();
  const todayStr = formatShopDateISO(today, timezone);
  return {
    startDate: todayStr,
    endDate: todayStr
  };
};

// Date Presets
const DATE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 Days' },
  { id: 'last30', label: 'Last 30 Days' },
  { id: 'mtd', label: 'Month to Date' },
  { id: 'lastMonth', label: 'Last Month' },
];

/** Key Metrics trend pills: two decimal places (e.g. 5.16% not 5.2%). */
function formatKeyMetricTrendPercent(pct: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(pct));
}

export function OverviewView({ account, shopId, timezone = 'America/Los_Angeles', onTimezoneChange, onTabChange }: OverviewViewProps) {
  const { user } = useAuth();
  const { loading: tenantCtxLoading, isAccountManagerAssignedToSeller } = useTenantContext();
  const canEmailDashboardExport =
    !tenantCtxLoading &&
    !!shopId &&
    !!account.tenant_id &&
    isAccountManagerAssignedToSeller(account.tenant_id);
  const { canMutateShop, canSyncShop } = useShopAccessFlags(account);

  const metrics = useShopStore(state => state.metrics);
  const unreadCount = useNotificationStore(state => state.unreadCount);

  const error = useShopStore(state => state.error);
  const fetchShopData = useShopStore(state => state.fetchShopData);
  const syncData = useShopStore(state => state.syncData);
  const cacheMetadata = useShopStore(state => state.cacheMetadata);
  const syncProgress = useShopStore(state => state.syncProgress);
  const dismissRefreshPrompt = useShopStore(state => state.dismissRefreshPrompt);

  const orders = useShopStore(state => state.orders);
  const products = useShopStore(state => state.products);
  const finance = useShopStore(state => state.finance);
  const dataVersion = useShopStore(state => state.dataVersion);
  const plData = useShopStore(state => state.plData);
  const fetchPLData = useShopStore(state => state.fetchPLData);

  // TikTok Ads store


  // Load default date preset from localStorage
  const [defaultDatePreset, setDefaultDatePreset] = useState<string>(() => {
    try {
      return localStorage.getItem(`mamba:default_date_preset:${shopId || 'default'}`) || 'today';
    } catch {
      return 'today';
    }
  });

  // Initialize date range based on saved preset
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange(timezone));

  // Default Load Days — how many days to initially fetch from Supabase
  const [defaultLoadDays, setDefaultLoadDays] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(`mamba:default_load_days:${shopId || 'default'}`);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (LOAD_DAY_OPTIONS.some(o => o.value === parsed)) return parsed;
      }
    } catch { }
    return DEFAULT_LOAD_DAYS;
  });

  const [showClearDataConfirm, setShowClearDataConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [loadDaysToast, setLoadDaysToast] = useState<{ days: number; visible: boolean } | null>(null);

  const [emailModalOpen, setEmailModalOpen] = useState(false);
  /** After send / schedule save we show a confirmation step instead of closing immediately. */
  const [emailModalStep, setEmailModalStep] = useState<'form' | 'sent' | 'scheduleSaved'>('form');
  const [emailSentTo, setEmailSentTo] = useState('');
  const [emailWasDelivered, setEmailWasDelivered] = useState(true);
  const [emailTo, setEmailTo] = useState('');
  const [emailIncludeOrder, setEmailIncludeOrder] = useState(true);
  const [emailIncludePl, setEmailIncludePl] = useState(true);
  const [digestHourUtc, setDigestHourUtc] = useState(14);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailErr, setEmailErr] = useState<string | null>(null);

  const [liveClock, setLiveClock] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setLiveClock(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Cancelled orders toggle mirror from P&L view
  const includeCancelledInTotal = true; // Total Orders Raw/Count always includes cancelled natively
  const [includeCancelledFinancials] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(`mamba:view_settings:cancelled_financials:${shopId || 'default'}`);
      return saved !== null ? saved === 'true' : true; // EXACT DEFAULT MATCH TO P&L
    } catch { return true; }
  });

  // Hybrid Timezone Logic (Default: true)
  // Toggle ON  → Applies 8-hour offset to previous period for America/Los_Angeles
  // Toggle OFF → Standard previous period calculation
  const [useHybridTimezone, setUseHybridTimezone] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(`mamba:view_settings:hybrid_timezone:${shopId || 'default'}`);
      return saved !== null ? saved === 'true' : true;
    } catch { return true; }
  });

  // Persist toggles and broadcast to other views in the same tab
  useEffect(() => {
    try {
      localStorage.setItem(`mamba:view_settings:hybrid_timezone:${shopId || 'default'}`, String(useHybridTimezone));
    } catch { }
  }, [useHybridTimezone, shopId]);

  // Token health state for expiration warning
  const [tokenHealth, setTokenHealth] = useState<{
    accessTokenExpiresIn: number | null;
    refreshTokenExpiresIn: number | null;
    status: 'healthy' | 'warning' | 'critical' | 'expired';
    message: string | null;
  }>({
    accessTokenExpiresIn: null,
    refreshTokenExpiresIn: null,
    status: 'healthy',
    message: null
  });
  const [tokenWarningDismissed, setTokenWarningDismissed] = useState(false);

  // Affiliate Settlements
  const fetchAffiliateSettlements = useShopStore(state => state.fetchAffiliateSettlements);
  const affiliateSettlements = useShopStore(state => state.finance.affiliateSettlements);

  // Agency Fees
  const fetchAgencyFees = useShopStore(state => state.fetchAgencyFees);
  const agencyFees = useShopStore(state => state.finance.agencyFees);

  // TikTok Ads (for ad spend)
  const { spendData: adsSpendData, fetchSpendData: fetchAdsSpend } = useTikTokAdsStore();

  // Fetch token health status
  useEffect(() => {
    const fetchTokenHealth = async () => {
      try {
        const response = await apiFetch(`/api/tiktok-shop/auth/status/${account.id}`);
        const data = await response.json();
        if (data.success && data.tokenHealth) {
          setTokenHealth(data.tokenHealth);
        }
      } catch (err) {
        console.error('Error fetching token health:', err);
      }
    };

    if (account.id) {
      fetchTokenHealth();
    }
  }, [account.id]);

  // Memoize the fetch function to prevent duplicate calls
  const handleDateRangeChange = useCallback((start: string, end: string) => {
    if (shopId && start && end) {
      // Use includePreviousPeriod: true so the store handles fetching the historical data needed for trends
      // Pass initialLoadDays so the store uses the user's preferred default (matters for initial/no-date calls)
      console.log(`[OverviewView] Fetching ${start} to ${end} (with extended history for trends, defaultLoad=${defaultLoadDays}d)`);
      fetchShopData(account.id, shopId, { skipSyncCheck: true, includePreviousPeriod: true, initialLoadDays: defaultLoadDays, timezone }, start, end);
      fetchAffiliateSettlements(account.id, shopId, start, end);
      fetchAgencyFees(account.id, shopId, start, end);
      fetchAdsSpend(account.id, start, end);
      // Same P&L payload as ProfitLossView — powers Affiliate Commissions card (plData.fees)
      void fetchPLData(account.id, shopId, start, end, false, timezone);
    }
  }, [shopId, account.id, fetchShopData, fetchAffiliateSettlements, fetchAgencyFees, fetchAdsSpend, fetchPLData, defaultLoadDays, timezone]);

  // Keep a ref to the latest handleDateRangeChange so the mount effect always
  // calls the current version without needing it in the dependency array.
  const handleDateRangeChangeRef = useRef(handleDateRangeChange);
  handleDateRangeChangeRef.current = handleDateRangeChange;

  // Keep a ref to the current dateRange so the mount effect reads the value
  // that was active when the effect fires, not a stale closure value.
  const dateRangeRef = useRef(dateRange);
  dateRangeRef.current = dateRange;

  // Initial data load: fires once per shopId (on mount and when the shop changes).
  // fetchShopData is NOT called automatically on every dateRange state change —
  // user-triggered changes go through handleDateRangeChange directly via the
  // DateRangePicker onChange handler and the Today button (see below).
  // This prevents the double-fetch race condition that caused only 1000 orders
  // to be loaded (the second concurrent call reset progressive loading state).
  const lastFetchedShopRef = useRef<string | null>(null);
  useEffect(() => {
    if (shopId && shopId !== lastFetchedShopRef.current) {
      lastFetchedShopRef.current = shopId;
      handleDateRangeChangeRef.current(
        dateRangeRef.current.startDate,
        dateRangeRef.current.endDate
      );
    }
  }, [shopId]); // intentionally only shopId — see comment above

  // Force UI re-render after sync completes.
  // mergeAfterSync already updated zustand state with new data — this counter
  // just ensures React picks up the change and re-runs the useMemo.
  const [syncRenderKey, setSyncRenderKey] = useState(0);
  const [syncSummaryToast, setSyncSummaryToast] = useState<string | null>(null);
  const [syncSummaryToastVisible, setSyncSummaryToastVisible] = useState(false);
  const wasSyncingRef = useRef(false);
  useEffect(() => {
    if (cacheMetadata.isSyncing) {
      wasSyncingRef.current = true;
    } else if (wasSyncingRef.current) {
      wasSyncingRef.current = false;
      const stats = cacheMetadata.lastSyncStats;
      if (stats) {
        const ordersFetched = stats.orders?.fetched ?? 0;
        const productsFetched = stats.products?.fetched ?? 0;
        const settlementsFetched = stats.settlements?.fetched ?? 0;
        setSyncSummaryToast(`Sync complete: orders ${ordersFetched}, products ${productsFetched}, settlements ${settlementsFetched}`);
        setSyncSummaryToastVisible(true);
      }
      console.log('[OverviewView] Sync completed — forcing re-render to pick up merged data.');
      // Increment counter to force React re-render (no Supabase refetch)
      setSyncRenderKey(k => k + 1);
      // Only refresh affiliate settlements, agency fees, and ads spend (not part of the sync delta)
      if (shopId) {
        fetchAffiliateSettlements(account.id, shopId, dateRange.startDate, dateRange.endDate);
        fetchAgencyFees(account.id, shopId, dateRange.startDate, dateRange.endDate);
        fetchAdsSpend(account.id, dateRange.startDate, dateRange.endDate);
        void fetchPLData(account.id, shopId, dateRange.startDate, dateRange.endDate, true, timezone);
      }
    }
  }, [cacheMetadata.isSyncing, shopId, account.id, fetchAffiliateSettlements, fetchAgencyFees, fetchAdsSpend, fetchPLData, dateRange.startDate, dateRange.endDate, timezone]);

  useEffect(() => {
    if (!syncSummaryToast) return;
    const hideTimer = window.setTimeout(() => setSyncSummaryToastVisible(false), 2600);
    const clearTimer = window.setTimeout(() => setSyncSummaryToast(null), 3000);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [syncSummaryToast]);

  const syncStatusText = useMemo(() => {
    if (cacheMetadata.isSyncing) {
      const currentLabel = syncProgress.currentStep === 'orders'
        ? 'Orders'
        : syncProgress.currentStep === 'products'
          ? 'Products'
          : syncProgress.currentStep === 'settlements'
            ? 'Settlements'
            : 'Sync';

      const processed = syncProgress.currentStep === 'orders'
        ? syncProgress.ordersFetched
        : syncProgress.currentStep === 'products'
          ? syncProgress.productsFetched
          : syncProgress.currentStep === 'settlements'
            ? syncProgress.settlementsFetched
            : 0;

      const total = syncProgress.currentStep === 'orders'
        ? syncProgress.ordersTotal
        : syncProgress.currentStep === 'products'
          ? syncProgress.productsTotal
          : syncProgress.currentStep === 'settlements'
            ? syncProgress.settlementsTotal
            : undefined;

      if (total && total > 0) {
        return `${currentLabel} ${Math.min(processed, total)}/${total}`;
      }
      return `${currentLabel} ${processed}`;
    }
    return null;
  }, [
    cacheMetadata.isSyncing,
    syncProgress.currentStep,
    syncProgress.ordersFetched,
    syncProgress.ordersTotal,
    syncProgress.productsFetched,
    syncProgress.productsTotal,
    syncProgress.settlementsFetched,
    syncProgress.settlementsTotal,
  ]);

  // Handle reconnect - redirect to TikTok auth
  const handleReconnect = async () => {
    try {
      const response = await apiFetch(`/api/tiktok-shop/auth/start`, {
        method: 'POST',
        body: JSON.stringify({ accountId: account.id })
      });
      const data = await response.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (err) {
      console.error('Error starting re-auth:', err);
    }
  };


  // Calculate metrics using P&L data (matching ProfitLossView exactly)
  const { calculatedMetrics, completedOrders, sampleOrderMetrics, cancelledRefundedMetrics, totalOrdersRaw, metricsData } = useMemo(() => {

    // Use Shop Timezone for filtering — [shopPeriodStart, shopPeriodEndExclusive) matches server paid_time gte/lt.
    const shopPeriodStart = getShopDayStartTimestamp(dateRange.startDate, timezone);
    const shopPeriodEndExclusive = getShopDayEndExclusiveTimestamp(dateRange.endDate, timezone);

    // ── PAID_TIME POOL ─────────────────────────────────────────────────────────
    // All non-sample orders whose paid_time (or created_time fallback) falls in range.
    // This is the single source of truth for counts and financials.
    const allPaidTimeOrders = orders.filter(o => {
      const ts = getOrderTs(o);
      return ts >= shopPeriodStart && ts < shopPeriodEndExclusive && o.is_sample_order !== true;
    });

    // Active orders = paid_time pool minus cancelled orders.
    const activeOrders = allPaidTimeOrders.filter(o => !isCancelledOrRefunded(o));

    // Toggle ON  → counts/financials use the full paid_time pool (active + cancelled by paid_time)
    // Toggle OFF → counts/financials use only active orders (no cancelled)
    const ordersForCount = includeCancelledInTotal ? allPaidTimeOrders : activeOrders;
    const ordersForFinancials = includeCancelledFinancials ? allPaidTimeOrders : activeOrders;

    // ── UPDATE_TIME POOL — CANCEL/REFUND CARD ONLY ──────────────────────────
    // Cancelled orders whose update_time (cancellation date) falls in range.
    // This is shown exclusively in the Cancel/Refund card — NEVER added to
    // ordersForCount or ordersForFinancials.
    const cancelledRefundedOrders = orders.filter(o => {
      if (!isCancelledOrRefunded(o)) return false;
      if (o.is_sample_order === true) return false;
      const ts = Number(o.update_time || o.paid_time || o.created_time);
      return ts >= shopPeriodStart && ts < shopPeriodEndExclusive;
    });

    const cancelledRefundedOrderIds = new Set(cancelledRefundedOrders.map(o => o.order_id));

    // Calculate sample order metrics separately
    const sampleOrders = orders.filter(o =>
      getOrderTs(o) >= shopPeriodStart && getOrderTs(o) < shopPeriodEndExclusive && o.is_sample_order === true
    );

    // Create a Set of sample order IDs for efficient lookup
    const sampleOrderIds = new Set(sampleOrders.map(o => o.order_id));


    // --- Current Period Metrics ---

    const grossSalesGMV = ordersForFinancials.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
    const refundsInFinancialPool = ordersForFinancials
      .filter(o => isCancelledOrRefunded(o))
      .reduce((sum, o) => sum + calculateOrderGMV(o), 0);
    const netRevenue = grossSalesGMV - refundsInFinancialPool;
    const currentGMV = grossSalesGMV;
    const currentTotalOrders = ordersForCount.length;
    const currentItemsSold = ordersForCount.reduce((sum, o) => sum + (o.line_items?.reduce((total, item) => total + (item.quantity || 0), 0) || 0), 0);
    const getBuyerId = (o: Order): string =>
      (o.buyer_info as any)?.buyer_user_id || (o.buyer_info as any)?.buyer_email || o.order_id;
    // Group unique buyers per day — a buyer counts once per day they purchase.
    // So a customer who buys Monday AND Tuesday = 2 (matches TikTok Seller Center).
    const groupDailyCustomers = (os: Order[]) => {
      const dayMap = new Map<string, Set<string>>();
      for (const o of os) {
        const day = formatShopDateISO(getOrderTs(o) * 1000, timezone);
        if (!dayMap.has(day)) dayMap.set(day, new Set());
        dayMap.get(day)!.add(getBuyerId(o));
      }
      return Array.from(dayMap.values()).reduce((sum, s) => sum + s.size, 0);
    };
    const currentCustomers = groupDailyCustomers(ordersForCount);

    // --- Previous Period Logic (for trends) ---

    // Calculate Previous Period using shop calendar days (Hybrid Timezone optional for LA)
    const { prevStart, prevEndExclusive } = getPreviousPeriodRange(
      dateRange.startDate,
      dateRange.endDate,
      timezone,
      useHybridTimezone
    );

    // Previous period — paid_time pool (mirrors current period logic exactly)
    const prevAllPaidTimeOrders = orders.filter(o => {
      const ts = getOrderTs(o);
      return ts >= prevStart && ts < prevEndExclusive && o.is_sample_order !== true;
    });
    const prevActiveOrders = prevAllPaidTimeOrders.filter(o => !isCancelledOrRefunded(o));

    const prevOrdersForCount = includeCancelledInTotal ? prevAllPaidTimeOrders : prevActiveOrders;
    const prevOrdersForFinancials = includeCancelledFinancials ? prevAllPaidTimeOrders : prevActiveOrders;

    const prevGrossSalesGMV = prevOrdersForFinancials.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
    const prevTotalOrders = prevOrdersForCount.length;
    const prevItemsSold = prevOrdersForCount.reduce((sum, o) => sum + (o.line_items?.reduce((total, item) => total + (item.quantity || 0), 0) || 0), 0);
    const prevCustomers = groupDailyCustomers(prevOrdersForCount);

    // --- Trends ---

    const calculateChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    const gmvChange = calculateChange(grossSalesGMV, prevGrossSalesGMV);
    const ordersChange = calculateChange(currentTotalOrders, prevTotalOrders);
    const itemsSoldChange = calculateChange(currentItemsSold, prevItemsSold);
    const customersChange = calculateChange(currentCustomers, prevCustomers);

    // Filter statements: date range AND exclude those linked to sample orders
    // If includeCancelledFinancials is FALSE, also exclude statements linked to cancelled orders
    // Use finance.statements from outer scope
    const statements = finance.statements || [];
    const filteredStatements = statements.filter(s => {
      const ts = Number(s.statement_time || 0);
      const isTimeMatch = ts >= shopPeriodStart && ts < shopPeriodEndExclusive;

      const isSampleStatement = s.order_id ? sampleOrderIds.has(s.order_id) : false;
      const isCancelledStatement = s.order_id ? cancelledRefundedOrderIds.has(s.order_id) : false;

      if (!includeCancelledFinancials && isCancelledStatement) return false;

      return isTimeMatch && !isSampleStatement;
    });

    // Headline GMV matches Seller Center; net revenue nets cancelled/refund GMV when those orders sit in the financial pool
    const totalGMV = grossSalesGMV;
    const totalRevenue = totalGMV;
    const orderTotalRevenue = totalGMV;

    const statementNetSales = filteredStatements.reduce((sum, s) => sum + parseFloat(s.net_sales_amount || '0'), 0);
    const netSales = statementNetSales;

    // Calculate COGS + product shipping cost
    let totalCogs = 0;
    let totalProductShippingCost = 0;
    // Use ordersForFinancials so we exclude COGS of cancelled items if the toggle is off
    ordersForFinancials.forEach(order => {
      order.line_items.forEach(item => {
        // Find product by SKU or name
        const product = products.find(p =>
          (item.seller_sku && p.skus?.some(s => s.seller_sku === item.seller_sku)) ||
          p.name === item.product_name
        );

        // Calculate COGS for this line item
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
                if (skuData.cogs) itemCogs = skuData.cogs;
                if ((skuData as any).shipping_cost) itemShippingCost = (skuData as any).shipping_cost;
              }
            }
          } else {
            itemCogs = 0;
          }
        }

        totalCogs += (Number(itemCogs) * item.quantity);
        totalProductShippingCost += (Number(itemShippingCost) * item.quantity);
      });
    });

    const totalShipping = filteredStatements.reduce((sum, s) => {
      return sum + Math.abs(parseFloat(s.shipping_fee || '0'));
    }, 0);

    // Manual affiliate retainers
    const manualAffiliateRetainers = affiliateSettlements.reduce((sum, s) => sum + Number(s.amount), 0);

    const adSpendTotal = adsSpendData?.totals.total_spend || 0;

    let autoAffiliateCommission = 0;
    let shopAdsFees = 0;
    let feesBase = 0;
    let shippingBaseForOpEx = 0;

    if (plData && plData.statement_totals) {
      feesBase =
        plData.total_fee_tax != null
          ? Math.abs(plData.total_fee_tax)
          : Math.abs(plData.statement_totals.total_fees);
      shippingBaseForOpEx = plData.shipping
        ? shippingTotalForOperatingExpenses(plData.shipping)
        : Math.abs(plData.statement_totals.total_shipping);
      shopAdsFees = expenseFromNet(netByKeys(plData.fees, adSpendFeeKeys));
      autoAffiliateCommission = expenseFromNet(netByKeys(plData.fees, affiliateCogsFeeKeys));
    } else {
      const aggFees = mergeStatementFees(filteredStatements);
      const aggShip = mergeStatementShipping(filteredStatements);
      shopAdsFees = expenseFromNet(netByKeys(aggFees, adSpendFeeKeys));
      autoAffiliateCommission = expenseFromNet(netByKeys(aggFees, affiliateCogsFeeKeys));
      feesBase = feesBaseFromStatements(filteredStatements);
      shippingBaseForOpEx =
        Object.keys(aggShip).length > 0
          ? shippingTotalForOperatingExpenses(aggShip)
          : totalShipping;
    }

    const totalAffiliateCost = autoAffiliateCommission + manualAffiliateRetainers;
    const grossProfit = netRevenue - totalCogs - totalProductShippingCost - totalAffiliateCost;

    const rangeStart = new Date(dateRange.startDate);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(dateRange.endDate);
    rangeEnd.setHours(23, 59, 59, 999);

    const totalAgencyFees = agencyFees.reduce((sum, fee) => {
      const feeType = fee.fee_type || 'retainer';
      const recurrence = fee.recurrence || 'monthly';
      const feeStart = new Date(fee.date);
      feeStart.setHours(0, 0, 0, 0);

      let retainerPart = 0;
      let commissionPart = 0;

      if (feeStart <= rangeEnd) {
        const effectiveStart = feeStart > rangeStart ? feeStart : rangeStart;

        if (feeType === 'retainer' || feeType === 'both') {
          const amount = Number(fee.retainer_amount ?? fee.amount ?? 0);
          let curr = new Date(effectiveStart);

          while (curr <= rangeEnd) {
            const y = curr.getFullYear();
            const m = curr.getMonth();
            const daysInMonth = new Date(y, m + 1, 0).getDate();

            let dailyRate = 0;
            if (recurrence === 'monthly') dailyRate = amount / daysInMonth;
            else if (recurrence === 'quarterly') dailyRate = (amount / 3) / daysInMonth;
            else if (recurrence === 'biannual') dailyRate = (amount / 6) / daysInMonth;
            else if (recurrence === 'annual') dailyRate = (amount / 12) / daysInMonth;
            else dailyRate = amount / daysInMonth;

            retainerPart += dailyRate;
            curr.setDate(curr.getDate() + 1);
          }
        }

        if (feeType === 'commission' || feeType === 'both') {
          const rate = Number(fee.commission_rate || 0) / 100;
          const base = fee.commission_base || 'gmv';
          const totalRangeDays = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86400000));
          const activeDays = Math.max(0, Math.round((rangeEnd.getTime() - effectiveStart.getTime()) / 86400000) + 1);
          const activeRatio = Math.min(1, activeDays / totalRangeDays);
          const baseValue =
            base === 'gross_profit'
              ? grossProfit
              : base === 'net_revenue'
                ? netRevenue
                : grossSalesGMV;
          commissionPart = rate * baseValue * activeRatio;
        }
      }
      return sum + retainerPart + commissionPart;
    }, 0);

    const realOperatingExpenses =
      feesBase + shippingBaseForOpEx - shopAdsFees - autoAffiliateCommission + totalAgencyFees;
    const netProfitFinal = grossProfit - (realOperatingExpenses + adSpendTotal);

    // Calculate Completed Orders
    const completedOrdersCount = activeOrders.filter(o => o.order_status === 'COMPLETED').length;
    // Count of cancelled/refunded
    const cancelledCount = cancelledRefundedOrders.length;
    // Value of cancelled/refunded
    const cancelledValue = cancelledRefundedOrders.reduce((sum, o) => sum + calculateOrderGMV(o), 0);

    // Calculate sample order metrics
    const sampleOrderCount = sampleOrders.length;
    const sampleOrderRevenue = sampleOrders.reduce((sum, o) => {
      return sum + calculateOrderGMV(o);
    }, 0);

    return {
      calculatedMetrics: {
        totalRevenue: totalRevenue,
        netProfit: netProfitFinal,
        grossProfit,
        netSales,
        avgOrderValue: currentTotalOrders > 0 ? orderTotalRevenue / currentTotalOrders : 0
      },
      completedOrders: completedOrdersCount,
      sampleOrderMetrics: {
        count: sampleOrderCount,
        revenue: sampleOrderRevenue
      },
      cancelledRefundedMetrics: {
        count: cancelledCount,
        value: cancelledValue
      },
      // Total orders from TikTok API (date-filtered only, no status/sample filtering)
      // Performance: Calculate timestamps once, not for every order
      totalOrdersRaw: (() => {
        const rawStart = getShopDayStartTimestamp(dateRange.startDate, timezone);
        const rawEndExclusive = getShopDayEndExclusiveTimestamp(dateRange.endDate, timezone);
        return orders.filter(o => getOrderTs(o) >= rawStart && getOrderTs(o) < rawEndExclusive).length;
      })(),
      metricsData: {
        gmv: currentGMV,
        gmvChange,
        totalOrders: currentTotalOrders,
        ordersChange,
        totalCustomers: currentCustomers,
        customersChange,
        itemsSold: currentItemsSold,
        itemsSoldChange
      },
    };
  }, [orders, finance.statements, dateRange, products, dataVersion, syncRenderKey, useHybridTimezone, affiliateSettlements, agencyFees, adsSpendData, timezone, includeCancelledFinancials, plData]);


  // Calculate Quick Stats
  const quickStats = useMemo(() => {
    // Get today's date range using Shop Timezone (to match charts)
    const todayStr = formatShopDateISO(new Date(), timezone); // Get today's date in YYYY-MM-DD format
    const todayStart = getShopDayStartTimestamp(todayStr, timezone);
    const todayEndExclusive = getShopDayEndExclusiveTimestamp(todayStr, timezone);

    // Orders Today (excluding sample orders and cancelled/refunded orders)
    const todaysOrders = orders.filter(o => getOrderTs(o) >= todayStart && getOrderTs(o) < todayEndExclusive && o.is_sample_order !== true && !isCancelledOrRefunded(o));
    const ordersToday = todaysOrders.length;

    // Revenue Today (sum of order totals, excluding sample and cancelled/refunded orders)
    const revenueToday = todaysOrders.reduce((sum, o) => {
      return sum + calculateOrderGMV(o);
    }, 0);

    // Pending Orders (orders that are not completed or cancelled, excluding sample and cancelled/refunded orders)
    const pendingStatuses = ['AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'PARTIALLY_SHIPPING', 'IN_TRANSIT', 'UNPAID', 'ON_HOLD', 'PROCESSING'];
    const pendingOrders = orders.filter(o => pendingStatuses.includes(o.order_status) && o.is_sample_order !== true && !isCancelledOrRefunded(o)).length;

    // Low Stock Products (products with quantity <= 10)
    const lowStockProducts = products.filter(p => {
      const totalQuantity = p.skus?.reduce((sum, sku) => {
        const qty = sku.inventory?.reduce((s, inv) => s + (inv.quantity || 0), 0) || 0;
        return sum + qty;
      }, 0) || 0;
      return totalQuantity > 0 && totalQuantity <= 10;
    }).length;

    return {
      ordersToday,
      revenueToday,
      pendingOrders,
      lowStockProducts
    };
  }, [orders, products, dataVersion, syncRenderKey, timezone]);

  useEffect(() => {
    if (emailModalOpen && user?.email) {
      setEmailTo((prev) => (prev.trim() ? prev : user.email || ''));
    }
  }, [emailModalOpen, user?.email]);

  // Timezone changes do not re-fetch orders: the same UTC order timestamps are re-bucketed
  // client-side via getShopDayStartTimestamp / formatShopDateISO in memoized metrics.

  const handleSync = useCallback(async () => {
    if (!shopId) {
      console.error('Sync failed: No shopId provided');
      return;
    }
    if (!canSyncShop) return;
    console.log('Starting sync for shop:', shopId);
    try {
      await syncData(account.id, shopId, 'all');
      console.log('Sync completed successfully');
    } catch (err) {
      console.error('Sync failed with error:', err);
    }
  }, [shopId, account.id, syncData, canSyncShop]);

  const handleTodayClick = useCallback(() => {
    const today = new Date();
    const todayStr = formatShopDateISO(today, timezone);
    setDateRange({ startDate: todayStr, endDate: todayStr });
    handleDateRangeChange(todayStr, todayStr);
  }, [handleDateRangeChange, timezone]);

  const isTodayActive = () => {
    const today = new Date();
    const todayStr = formatShopDateISO(today, timezone);
    return dateRange.startDate === todayStr && dateRange.endDate === todayStr;
  };

  const handleYesterdayClick = useCallback(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatShopDateISO(yesterday, timezone);
    setDateRange({ startDate: yesterdayStr, endDate: yesterdayStr });
    handleDateRangeChange(yesterdayStr, yesterdayStr);
  }, [handleDateRangeChange, timezone]);

  const isYesterdayActive = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatShopDateISO(yesterday, timezone);
    return dateRange.startDate === yesterdayStr && dateRange.endDate === yesterdayStr;
  };



  const formatCurrency = useCallback((num: number): string => {
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `;
  }, []);

  const handleClearShopData = async () => {
    if (!shopId || !canMutateShop) return;

    setIsClearing(true);
    try {
      const response = await apiFetch(`/api/tiktok-shop/shop-data/${account.id}/clear?shopId=${shopId}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        // Clear local store data
        useShopStore.getState().clearData();

        // Show success and close confirmation
        setShowClearDataConfirm(false);

        // Trigger a fresh sync
        await syncData(account.id, shopId, 'all');
      } else {
        console.error('Failed to clear shop data:', result.error);
        alert('Failed to clear shop data: ' + result.error);
      }
    } catch (err: any) {
      console.error('Error clearing shop data:', err);
      alert('Error clearing shop data: ' + err.message);
    } finally {
      setIsClearing(false);
    }
  };

  const getDaysDifference = () => {
    const start = parseLocalDate(dateRange.startDate);
    const end = parseLocalDate(dateRange.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(diffDays, 1); // Same day = 1 day, not 0
  };

  const days = getDaysDifference();
  const dateRangeSubtitle = `within ${days} day${days !== 1 ? 's' : ''}`;

  const handleSendDashboardEmail = useCallback(async () => {
    if (!shopId) return;
    if (!emailIncludeOrder && !emailIncludePl) {
      setEmailErr('Choose at least one: order-based summary and/or P&L summary.');
      return;
    }
    setEmailErr(null);
    setEmailBusy(true);
    try {
      const reportTypes: ('order' | 'pl')[] = [];
      if (emailIncludeOrder) reportTypes.push('order');
      if (emailIncludePl) reportTypes.push('pl');

      const plSummary =
        emailIncludePl
          ? {
              gmv: metricsData.gmv,
              totalOrders: metricsData.totalOrders,
              totalRevenue: calculatedMetrics.totalRevenue,
              netSales: calculatedMetrics.netSales,
              grossProfit: calculatedMetrics.grossProfit,
              netProfit: calculatedMetrics.netProfit,
              adSpend: adsSpendData?.totals?.total_spend ?? 0,
            }
          : undefined;

      const res = await apiFetch('/api/reports/email-dashboard', {
        method: 'POST',
        body: JSON.stringify({
          accountId: account.id,
          shopId,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          to: emailTo.trim(),
          timezone,
          reportTypes,
          ...(plSummary ? { plSummary } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailErr((data as { error?: string }).error || 'Failed to send email');
        return;
      }
      const payload = data as { data?: { emailDelivered?: boolean } };
      const delivered = payload.data?.emailDelivered !== false;
      setEmailSentTo(emailTo.trim());
      setEmailWasDelivered(delivered);
      setEmailModalStep('sent');
    } catch (e: unknown) {
      setEmailErr(e instanceof Error ? e.message : 'Failed to send email');
    } finally {
      setEmailBusy(false);
    }
  }, [
    shopId,
    account.id,
    dateRange.startDate,
    dateRange.endDate,
    emailTo,
    timezone,
    emailIncludeOrder,
    emailIncludePl,
    metricsData,
    calculatedMetrics,
    adsSpendData,
  ]);

  const handleCreateDigestSchedule = useCallback(async () => {
    if (!shopId) return;
    setEmailErr(null);
    setEmailBusy(true);
    try {
      const res = await apiFetch('/api/reports/schedules', {
        method: 'POST',
        body: JSON.stringify({
          accountId: account.id,
          shopId,
          recipientEmail: emailTo.trim(),
          timezone,
          hourUtc: digestHourUtc,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailErr((data as { error?: string }).error || 'Failed to save schedule');
        return;
      }
      setEmailSentTo(emailTo.trim());
      setEmailModalStep('scheduleSaved');
    } catch (e: unknown) {
      setEmailErr(e instanceof Error ? e.message : 'Failed to save schedule');
    } finally {
      setEmailBusy(false);
    }
  }, [shopId, account.id, emailTo, timezone, digestHourUtc]);

  const closeEmailModal = useCallback(() => {
    if (emailBusy) return;
    setEmailModalOpen(false);
    setEmailModalStep('form');
    setEmailErr(null);
  }, [emailBusy]);

  // ═══════════════════ CUSTOMIZABLE METRIC CARDS ═══════════════════

  interface MetricDef {
    id: string;
    label: string;
    getValue: () => string;
    borderColor: string;
    trendChange?: number; // percentage change vs previous period
    subtitle?: string;
    isCurrency?: boolean;
    onClick?: () => void;
  }

  const metricRegistry: MetricDef[] = useMemo(() => [
    {
      id: 'gmv',
      label: 'GMV',
      getValue: () => formatCurrency(metricsData.gmv),
      borderColor: 'border-pink-500/30',
      trendChange: metricsData.gmvChange,
      subtitle: dateRangeSubtitle,
      isCurrency: true,
    },
    {
      id: 'totalOrders',
      label: 'Total Orders',
      getValue: () => metricsData.totalOrders.toLocaleString(),
      borderColor: 'border-cyan-500/30',
      trendChange: metricsData.ordersChange,
      subtitle: dateRangeSubtitle,
    },
    {
      id: 'totalCustomers',
      label: 'Total Customers',
      getValue: () => metricsData.totalCustomers.toLocaleString(),
      borderColor: 'border-purple-500/30',
      trendChange: metricsData.customersChange,
      subtitle: dateRangeSubtitle,
    },

    {
      id: 'itemsSold',
      label: 'Items Sold',
      getValue: () => metricsData.itemsSold.toLocaleString(),
      borderColor: 'border-orange-500/30',
      trendChange: metricsData.itemsSoldChange,
      subtitle: dateRangeSubtitle,
    },
    {
      id: 'totalRevenue',
      label: 'Total Revenue',
      getValue: () => formatCurrency(calculatedMetrics.totalRevenue),
      borderColor: 'border-green-500/30',
      subtitle: `${dateRangeSubtitle} (GMV - Cancellations)`,
      isCurrency: true,
    },
    {
      id: 'avgOrderValue',
      label: 'Avg. Order Value',
      getValue: () => formatCurrency(calculatedMetrics.avgOrderValue),
      borderColor: 'border-amber-500/30',
      subtitle: 'Per transaction',
      isCurrency: true,
    },
    {
      id: 'netProfit',
      label: 'Net Profit',
      getValue: () => formatCurrency(calculatedMetrics.netProfit),
      borderColor: calculatedMetrics.netProfit >= 0 ? 'border-emerald-500/30' : 'border-red-500/30',
      subtitle: 'Settlement - COGS',
      isCurrency: true,
    },
    {
      id: 'netSales',
      label: 'Net Sales',
      getValue: () => formatCurrency(calculatedMetrics.netSales),
      borderColor: 'border-blue-500/30',
      subtitle: 'From settlement records',
      isCurrency: true,
    },
    {
      id: 'completedOrders',
      label: 'Completed Orders',
      getValue: () => completedOrders.toLocaleString(),
      borderColor: 'border-teal-500/30',
      subtitle: dateRangeSubtitle,
    },
    {
      id: 'cancelledRefunded',
      label: 'Cancelled/Refunded',
      getValue: () => cancelledRefundedMetrics.count.toString(),
      borderColor: 'border-red-500/30',
      subtitle: 'Orders excluded from P&L',
    },
    {
      id: 'cancelledFinancials',
      label: 'Cancelled Value',
      getValue: () => formatCurrency(cancelledRefundedMetrics.value),
      borderColor: 'border-red-500/30',
      subtitle: 'Total value of cancelled orders',
      isCurrency: true,
    },
    {
      id: 'sampleOrders',
      label: 'Sample Orders',
      getValue: () => sampleOrderMetrics.count.toString(),
      borderColor: 'border-sky-500/30',
      subtitle: sampleOrderMetrics.count > 0 ? `${formatCurrency(sampleOrderMetrics.revenue)} revenue` : 'None in period',
    },
    {
      id: 'totalOrdersRaw',
      label: 'Total Orders (Raw)',
      getValue: () => totalOrdersRaw.toString(),
      borderColor: 'border-gray-500/30',
      subtitle: `${dateRangeSubtitle} - Unfiltered from API`,
    },
  ], [metricsData, calculatedMetrics, completedOrders, cancelledRefundedMetrics, sampleOrderMetrics, totalOrdersRaw, dateRangeSubtitle]);

  // Same auto-affiliate total as Profit & Loss, with per-line breakdown for the card
  const autoAffiliateCommissionDetail = useMemo(() => {
    const stmtRangeStart = getShopDayStartTimestamp(dateRange.startDate, timezone);
    const stmtRangeEndExclusive = getShopDayEndExclusiveTimestamp(dateRange.endDate, timezone);

    let fees: Record<string, number> = {};
    if (plData?.fees) {
      fees = plData.fees;
    } else {
      const inRange = (finance.statements || []).filter(
        s => s.statement_time >= stmtRangeStart && s.statement_time < stmtRangeEndExclusive
      );
      fees = mergeStatementFees(inRange);
    }

    // Card front "Est. commission (TikTok)" = three Seller Center paths; lines also show affiliate ads + external COGS.
    const tiktokLines = tiktokEstCommissionFeeKeys.map((key) => ({
      key,
      label: tiktokEstCommissionLineLabels[key],
      value: Number(fees[key] ?? 0),
    }));
    const affiliateAdsVal = Number(fees.affiliate_ads_commission ?? 0);
    const extVal = Number(fees.external_affiliate_marketing_fee ?? 0);
    const extraLines: { key: string; label: string; value: number }[] = [];
    if (Math.abs(affiliateAdsVal) >= 0.01) {
      extraLines.push({
        key: 'affiliate_ads_commission',
        label: affiliateCogsLineLabels.affiliate_ads_commission,
        value: affiliateAdsVal,
      });
    }
    if (extVal !== 0) {
      extraLines.push({
        key: 'external_affiliate_marketing_fee',
        label: `${affiliateCogsLineLabels.external_affiliate_marketing_fee} (not in Est. commission)`,
        value: extVal,
      });
    }
    const lines = [...tiktokLines, ...extraLines];

    const netSigned = netByKeys(fees, [...tiktokEstCommissionFeeKeys, 'affiliate_ads_commission']);
    const total = expenseFromNet(netByKeys(fees, tiktokEstCommissionFeeKeys));
    const externalAbs = expenseFromNet(Number(fees.external_affiliate_marketing_fee ?? 0));
    const affiliateAdsAbs = expenseFromNet(affiliateAdsVal);
    const autoOtherAffiliateCogsCombined = externalAbs + affiliateAdsAbs;
    return { total, lines, netSigned, externalAbs, affiliateAdsAbs, autoOtherAffiliateCogsCombined };
  }, [finance.statements, dateRange, timezone, plData]);

  const DEFAULT_METRICS = ['gmv', 'netProfit', 'totalOrders', 'totalCustomers', 'itemsSold'];

  const storageKey = `mamba:dashboard:${shopId || 'default'}`;

  // Load from localStorage first (instant), then overwrite from Supabase
  const [selectedMetricIds, setSelectedMetricIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { }
    return DEFAULT_METRICS;
  });

  // Edit mode state (iOS wiggle)
  const [isEditMode, setIsEditMode] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  // Drag-and-drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Debounce ref for Supabase saves
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDone = useRef(false);

  // Dashboard Layout State (Order of sections)
  const [dashboardLayout, setDashboardLayout] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`mamba:dashboard_layout:${shopId || 'default'}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { }
    return ['metrics', 'charts'];
  });

  // Section Drag State
  const [dragSectionIndex, setDragSectionIndex] = useState<number | null>(null);
  const [dragSectionOverIndex, setDragSectionOverIndex] = useState<number | null>(null);

  // Load layout from Supabase
  useEffect(() => {
    // Also read localStorage for instant display
    try {
      const saved = localStorage.getItem(`mamba:dashboard_layout:${shopId || 'default'}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setDashboardLayout(parsed);
        }
      }
    } catch { }

    const loadLayoutFromSupabase = async () => {
      if (!user?.id || !account.id) return;
      try {
        const { data, error } = await supabase
          .from('user_preferences')
          .select('preference_value')
          .eq('user_id', user.id)
          .eq('account_id', account.id)
          .eq('preference_key', 'dashboard_layout')
          .maybeSingle();

        if (!error && data?.preference_value) {
          const val = data.preference_value;
          if (Array.isArray(val) && val.length > 0) {
            setDashboardLayout(val);
            try { localStorage.setItem(`mamba:dashboard_layout:${shopId || 'default'}`, JSON.stringify(val)); } catch { }
          }
        }
      } catch (err) {
        console.error('[Preferences] Failed to load layout:', err);
      }
    };
    loadLayoutFromSupabase();
  }, [user?.id, account.id, shopId]);

  // Save layout to Supabase + localStorage
  useEffect(() => {
    const key = `mamba:dashboard_layout:${shopId || 'default'}`;
    try { localStorage.setItem(key, JSON.stringify(dashboardLayout)); } catch { }

    if (!initialLoadDone.current) return;

    // Use a separate timeout for layout save to avoid conflict with metrics save
    const layoutSaveTimeout = setTimeout(async () => {
      if (!user?.id || !account.id) return;
      try {
        await supabase.from('user_preferences').upsert({
          user_id: user.id,
          account_id: account.id,
          preference_key: 'dashboard_layout',
          preference_value: dashboardLayout,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,account_id,preference_key' });
      } catch (err) {
        console.error('[Preferences] Failed to save layout:', err);
      }
    }, 1000);

    return () => clearTimeout(layoutSaveTimeout);
  }, [dashboardLayout, user?.id, account.id, shopId]);

  // Load from Supabase when shop changes (overwrite localStorage cache)
  useEffect(() => {
    // Also read localStorage for instant display
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSelectedMetricIds(parsed);
        }
      }
    } catch { }

    // Then fetch from Supabase
    const loadFromSupabase = async () => {
      if (!user?.id || !account.id) return;
      try {
        const { data, error } = await supabase
          .from('user_preferences')
          .select('preference_value')
          .eq('user_id', user.id)
          .eq('account_id', account.id)
          .eq('preference_key', 'dashboard_metrics')
          .maybeSingle();

        if (!error && data?.preference_value) {
          const val = data.preference_value;
          if (Array.isArray(val) && val.length > 0) {
            setSelectedMetricIds(val);
            // Update localStorage cache
            try { localStorage.setItem(storageKey, JSON.stringify(val)); } catch { }
          }
        }
      } catch (err) {
        console.error('[Preferences] Failed to load from Supabase:', err);
      }
      initialLoadDone.current = true;
    };

    loadFromSupabase();
  }, [user?.id, account.id, storageKey]);

  // Save to Supabase + localStorage on change (debounced)
  useEffect(() => {
    // Always update localStorage immediately
    try { localStorage.setItem(storageKey, JSON.stringify(selectedMetricIds)); } catch { }

    // Debounce Supabase save
    if (!initialLoadDone.current) return; // Don't save during initial load
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (!user?.id || !account.id) return;
      try {
        await supabase.from('user_preferences').upsert({
          user_id: user.id,
          account_id: account.id,
          preference_key: 'dashboard_metrics',
          preference_value: selectedMetricIds,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,account_id,preference_key' });
      } catch (err) {
        console.error('[Preferences] Failed to save to Supabase:', err);
      }
    }, 500);

    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [selectedMetricIds, storageKey, user?.id, account.id]);

  // Save default date preset to Supabase + localStorage
  useEffect(() => {
    const key = `mamba:default_date_preset:${shopId || 'default'}`;
    try { localStorage.setItem(key, defaultDatePreset); } catch { }

    if (!initialLoadDone.current) return;

    const presetSaveTimeout = setTimeout(async () => {
      if (!user?.id || !account.id) return;
      try {
        await supabase.from('user_preferences').upsert({
          user_id: user.id,
          account_id: account.id,
          preference_key: 'dashboard_default_date_preset',
          preference_value: defaultDatePreset,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,account_id,preference_key' });
      } catch (err) {
        console.error('[Preferences] Failed to save date preset:', err);
      }
    }, 1000);

    return () => clearTimeout(presetSaveTimeout);
  }, [defaultDatePreset, user?.id, account.id, shopId]);

  // Save Default Load Days to Supabase + localStorage
  useEffect(() => {
    const key = `mamba:default_load_days:${shopId || 'default'}`;
    try { localStorage.setItem(key, String(defaultLoadDays)); } catch { }

    if (!initialLoadDone.current) return;

    const loadDaysSaveTimeout = setTimeout(async () => {
      if (!user?.id || !account.id) return;
      try {
        await supabase.from('user_preferences').upsert({
          user_id: user.id,
          account_id: account.id,
          preference_key: 'dashboard_default_load_days',
          preference_value: defaultLoadDays,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,account_id,preference_key' });
      } catch (err) {
        console.error('[Preferences] Failed to save default load days:', err);
      }
    }, 1000);

    return () => clearTimeout(loadDaysSaveTimeout);
  }, [defaultLoadDays, user?.id, account.id, shopId]);

  // Load date preset + default load days from Supabase
  useEffect(() => {
    const loadPresetFromSupabase = async () => {
      if (!user?.id || !account.id) return;
      try {
        // Load date preset
        const { data, error } = await supabase
          .from('user_preferences')
          .select('preference_value')
          .eq('user_id', user.id)
          .eq('account_id', account.id)
          .eq('preference_key', 'dashboard_default_date_preset')
          .maybeSingle();

        if (!error && data?.preference_value) {
          const val = data.preference_value;
          if (typeof val === 'string') {
            setDefaultDatePreset(val);
            try { localStorage.setItem(`mamba:default_date_preset:${shopId || 'default'}`, val); } catch { }
          }
        }

        // Load default load days
        const { data: loadDaysData, error: loadDaysError } = await supabase
          .from('user_preferences')
          .select('preference_value')
          .eq('user_id', user.id)
          .eq('account_id', account.id)
          .eq('preference_key', 'dashboard_default_load_days')
          .maybeSingle();

        if (!loadDaysError && loadDaysData?.preference_value) {
          const val = Number(loadDaysData.preference_value);
          if (LOAD_DAY_OPTIONS.some(o => o.value === val)) {
            setDefaultLoadDays(val);
            try { localStorage.setItem(`mamba:default_load_days:${shopId || 'default'}`, String(val)); } catch { }
          }
        }
      } catch (err) {
        console.error('[Preferences] Failed to load presets:', err);
      }
    };
    loadPresetFromSupabase();
  }, [user?.id, account.id, shopId]);

  // Remove metric
  const removeMetric = useCallback((id: string) => {
    setSelectedMetricIds(prev => prev.filter(m => m !== id));
  }, []);

  // Add metric
  const addMetric = useCallback((id: string) => {
    setSelectedMetricIds(prev => prev.includes(id) ? prev : [...prev, id]);
  }, []);

  // Long-press handlers
  const handlePointerDown = useCallback(() => {
    longPressTriggered.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggered.current = true;
      setIsEditMode(true);
    }, 500);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Drag-and-drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Make the drag image slightly transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, e.currentTarget.offsetWidth / 2, e.currentTarget.offsetHeight / 2);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      setSelectedMetricIds(prev => {
        const next = [...prev];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(dragOverIndex, 0, moved);
        return next;
      });
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex, dragOverIndex]);

  const handleDragLeaveGrid = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  // Section Drag Handlers
  const handleSectionDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragSectionIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Make the drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, e.currentTarget.offsetWidth / 2, 20);
    }
  }, []);

  const handleSectionDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent bubbling to parent containers if any
    e.dataTransfer.dropEffect = 'move';
    setDragSectionOverIndex(index);
  }, []);

  const handleSectionDragEnd = useCallback(() => {
    if (dragSectionIndex !== null && dragSectionOverIndex !== null && dragSectionIndex !== dragSectionOverIndex) {
      setDashboardLayout(prev => {
        const next = [...prev];
        const [moved] = next.splice(dragSectionIndex, 1);
        next.splice(dragSectionOverIndex, 0, moved);
        return next;
      });
    }
    setDragSectionIndex(null);
    setDragSectionOverIndex(null);
  }, [dragSectionIndex, dragSectionOverIndex]);

  const metricMap = useMemo(() => new Map(metricRegistry.map(m => [m.id, m])), [metricRegistry]);

  // Available (unselected) metrics for "Add" panel
  const availableMetrics = useMemo(() =>
    metricRegistry.filter(m => !selectedMetricIds.includes(m.id)),
    [metricRegistry, selectedMetricIds]
  );

  return (
    <div className="space-y-6">
      {syncSummaryToast && (
        <div
          className={`fixed top-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-2xl bg-gray-900/95 backdrop-blur-md px-5 py-3.5 shadow-2xl border border-gray-700/50 transition-all duration-400 ease-out ${
            syncSummaryToastVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-95 pointer-events-none'
          }`}
        >
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white">{syncSummaryToast}</span>
          </div>
        </div>
      )}

      {/* Refresh Prompt */}
      {cacheMetadata.showRefreshPrompt && canSyncShop && (
        <RefreshPrompt
          onRefresh={() => syncData(account.id, shopId!, 'all')}
          onDismiss={dismissRefreshPrompt}
          isStale={cacheMetadata.isStale}
        />
      )}

      {/* Token Expiration Warning */}
      {!tokenWarningDismissed && (
        <TokenExpirationWarning
          tokenHealth={tokenHealth}
          onReconnect={handleReconnect}
          onDismiss={() => setTokenWarningDismissed(true)}
        />
      )}


      {error && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            <p className="text-amber-200 text-sm">
              We're having trouble fetching some data. Some information might be outdated.
            </p>
          </div>
          <button
            onClick={() => fetchShopData(account.id, shopId, { forceRefresh: true })}
            className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      )}
      {/* Account Header — single toolbar row; scrolls horizontally on narrow viewports */}
      <div className="bg-gradient-to-r from-pink-500/10 to-red-500/10 border border-pink-500/30 rounded-xl px-4 py-3 sm:px-5 sm:py-3.5">
        <div className="flex flex-row items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-3 min-w-0 shrink-0 pr-2">
            {account.avatar_url ? (
              <img src={account.avatar_url} alt={account.name} className="w-11 h-11 sm:w-12 sm:h-12 rounded-full shrink-0" />
            ) : (
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-gradient-to-r from-pink-500 to-red-500 flex items-center justify-center text-white text-lg font-bold shrink-0">
                {account.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white truncate leading-tight">{account.name}</h2>
              <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                <p className="text-xs text-gray-400 truncate">
                  {(account as any).tiktok_handle || account.tiktok_handle || 'TikTok Shop'}
                </p>
                {(account as any).owner_role && (
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-pink-500/20 text-pink-400 border border-pink-500/30 shrink-0 hidden sm:inline">
                    {(account as any).owner_role.toUpperCase()}
                  </span>
                )}
                {metrics.shopRating > 0 && (
                  <div className="flex items-center gap-0.5 bg-yellow-500/10 px-1.5 py-0.5 rounded-full border border-yellow-500/20 shrink-0">
                    <Star className="w-2.5 h-2.5 text-yellow-400 fill-yellow-400" />
                    <span className="text-[10px] text-yellow-200">{metrics.shopRating.toFixed(1)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Scroll only the left segment of the toolbar — overflow-y-hidden on a parent clips
              absolutely positioned dropdowns (timezone panel, date picker calendar, etc.). */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2 py-0.5">
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2 overflow-x-auto [-webkit-overflow-scrolling:touch]">
            <div className="inline-flex h-9 shrink-0 items-stretch rounded-lg border border-white/10 bg-black/30 p-0.5 gap-0.5">
              <button
                type="button"
                onClick={handleTodayClick}
                className={`flex items-center gap-1 px-2 sm:px-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${isTodayActive()
                  ? 'bg-pink-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
              >
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                Today
              </button>
              <button
                type="button"
                onClick={handleYesterdayClick}
                className={`flex items-center gap-1 px-2 sm:px-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${isYesterdayActive()
                  ? 'bg-pink-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
              >
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                Yesterday
              </button>
            </div>

            <DateRangePicker
              compact
              timezone={timezone}
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                handleDateRangeChange(range.startDate, range.endDate);
              }}
            />

            <button
              type="button"
              onClick={handleSync}
              disabled={!canSyncShop || cacheMetadata.isSyncing}
              title={!canSyncShop ? 'You do not have access to sync this shop' : undefined}
              className={`inline-flex shrink-0 items-center justify-center gap-1.5 h-9 px-3 sm:px-3.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${cacheMetadata.isSyncing
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-pink-600 hover:bg-pink-500 text-white disabled:opacity-50'
                }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${cacheMetadata.isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden min-[380px]:inline">{cacheMetadata.isSyncing ? 'Syncing…' : 'Sync'}</span>
            </button>
            {syncStatusText && (
              <span className="hidden md:inline shrink-0 text-[10px] text-gray-400 whitespace-nowrap">
                {syncStatusText}
              </span>
            )}

            {canEmailDashboardExport && (
              <button
                type="button"
                onClick={() => {
                  setEmailErr(null);
                  setEmailModalStep('form');
                  setEmailModalOpen(true);
                }}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-lg text-xs sm:text-sm font-medium border border-white/10 bg-gray-900/70 text-gray-200 hover:bg-gray-800 hover:text-white transition-colors whitespace-nowrap"
                title="Email dashboard summary (Account Managers assigned to this seller)"
              >
                <Mail className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="hidden md:inline">Email</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onTabChange && onTabChange('notifications')}
              className="relative inline-flex shrink-0 items-center justify-center h-9 w-9 rounded-lg border border-white/10 bg-gray-900/70 hover:bg-gray-800 transition-colors"
              title="Notifications"
            >
              <Bell className="w-4 h-4 text-gray-400" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[1.125rem] h-4 px-1 flex items-center justify-center rounded-full bg-pink-500 text-[9px] font-bold text-white border-2 border-gray-950 leading-none">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            </div>

            {shopId && onTimezoneChange && (
              <TimezoneSelector
                compact
                shopId={shopId}
                accountId={account.id}
                currentTimezone={timezone}
                onTimezoneChange={onTimezoneChange}
                readOnly={!canMutateShop}
              />
            )}

            <span
              className="hidden lg:inline shrink-0 text-[10px] text-gray-500 whitespace-nowrap pl-2 ml-0.5 border-l border-white/10 tabular-nums"
              title={`Current time in ${timezone}`}
            >
              {formatShopTimeOnly(liveClock, timezone)}
            </span>
          </div>
        </div>
      </div>

      {emailModalOpen && canEmailDashboardExport && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close"
            onClick={closeEmailModal}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-gray-950 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-4">
              <h3 className="text-lg font-bold text-white">
                {emailModalStep === 'form' && 'Email report'}
                {emailModalStep === 'sent' && (emailWasDelivered ? 'Report sent' : 'Email not delivered')}
                {emailModalStep === 'scheduleSaved' && 'Digest saved'}
              </h3>
              <button
                type="button"
                disabled={emailBusy}
                onClick={closeEmailModal}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {emailModalStep === 'sent' && (
              <div className="py-2">
                <CheckCircle
                  className={`w-14 h-14 mx-auto mb-4 ${emailWasDelivered ? 'text-emerald-400' : 'text-amber-400'}`}
                  aria-hidden
                />
                {emailWasDelivered ? (
                  <p className="text-sm text-gray-300 text-center leading-relaxed">
                    We sent the dashboard report to{' '}
                    <span className="text-white font-medium">{emailSentTo}</span>. Check your inbox (and spam).
                  </p>
                ) : (
                  <p className="text-sm text-amber-200/90 text-center leading-relaxed">
                    The app accepted your request, but the server did not send email:{' '}
                    <code className="text-[11px] text-pink-300/90">RESEND_API_KEY</code> is not set (or mail failed). Add it in your API
                    environment and redeploy; until then, reports are not emailed.
                  </p>
                )}
                <button
                  type="button"
                  onClick={closeEmailModal}
                  className="w-full mt-6 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-sm font-semibold"
                >
                  Done
                </button>
              </div>
            )}

            {emailModalStep === 'scheduleSaved' && (
              <div className="py-2">
                <CheckCircle className="w-14 h-14 mx-auto mb-4 text-emerald-400" aria-hidden />
                <p className="text-sm text-gray-300 text-center leading-relaxed">
                  Daily digest is enabled for{' '}
                  <span className="text-white font-medium">{emailSentTo}</span> (UTC hour {digestHourUtc}). The server cron must be configured
                  to actually send.
                </p>
                <button
                  type="button"
                  onClick={closeEmailModal}
                  className="w-full mt-6 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-sm font-semibold"
                >
                  Done
                </button>
              </div>
            )}

            {emailModalStep === 'form' && (
              <>
                <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                  Period: <span className="text-gray-200">{dateRange.startDate}</span> →{' '}
                  <span className="text-gray-200">{dateRange.endDate}</span>
                  <span className="text-gray-500"> ({timezone})</span>.
                </p>

                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Include in email</p>
                <div className="rounded-xl border border-white/10 bg-black/30 divide-y divide-white/10 mb-4">
                  <label className="flex items-center gap-3 px-3 py-3 cursor-pointer hover:bg-white/[0.04]">
                    <input
                      type="checkbox"
                      checked={emailIncludeOrder}
                      onChange={(e) => setEmailIncludeOrder(e.target.checked)}
                      disabled={emailBusy}
                      className="rounded border-gray-600 text-pink-600 focus:ring-pink-500/40"
                    />
                    <div>
                      <div className="text-sm font-medium text-white">Order-based summary</div>
                      <div className="text-xs text-gray-500">Paid orders &amp; GMV from synced orders (server-calculated)</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 px-3 py-3 cursor-pointer hover:bg-white/[0.04]">
                    <input
                      type="checkbox"
                      checked={emailIncludePl}
                      onChange={(e) => setEmailIncludePl(e.target.checked)}
                      disabled={emailBusy}
                      className="rounded border-gray-600 text-pink-600 focus:ring-pink-500/40"
                    />
                    <div>
                      <div className="text-sm font-medium text-white">P&amp;L-style summary</div>
                      <div className="text-xs text-gray-500">GMV, revenue, net sales, gross/net profit, ad spend — matches this dashboard view</div>
                    </div>
                  </label>
                </div>

                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Recipient email</label>
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white mb-4 focus:ring-2 focus:ring-pink-500/40 focus:border-pink-500/40 outline-none"
                  placeholder="you@company.com"
                  disabled={emailBusy}
                />
                {emailErr && <p className="text-sm text-red-400 mb-3">{emailErr}</p>}
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={emailBusy || !emailTo.trim() || (!emailIncludeOrder && !emailIncludePl)}
                    onClick={() => void handleSendDashboardEmail()}
                    className="w-full py-2.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-sm font-semibold disabled:opacity-40"
                  >
                    {emailBusy ? 'Sending…' : 'Send email'}
                  </button>
                  <div className="border-t border-white/10 pt-4 mt-1">
                    <p className="text-xs text-gray-500 mb-2">Daily automated digest (previous shop day)</p>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Send at (UTC hour 0–23)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={digestHourUtc}
                      onChange={(e) => setDigestHourUtc(Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                      className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white mb-3 outline-none"
                      disabled={emailBusy}
                    />
                    <button
                      type="button"
                      disabled={emailBusy || !emailTo.trim()}
                      onClick={() => void handleCreateDigestSchedule()}
                      className="w-full py-2.5 rounded-xl bg-gray-800 border border-gray-600 hover:bg-gray-700 text-gray-100 text-sm font-medium disabled:opacity-40"
                    >
                      Enable daily digest
                    </button>
                    <p className="text-[11px] text-gray-600 mt-2">
                      Vercel <strong className="text-gray-500">Hobby</strong> only allows <strong className="text-gray-500">once-per-day</strong>{' '}
                      crons — digests run on that schedule (see <code className="text-gray-500">server/vercel.json</code>). Set{' '}
                      <code className="text-gray-500">CRON_SECRET</code> in the project. The UTC hour field is optional metadata unless you use an
                      external scheduler or Vercel Pro with a more frequent cron.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* iOS Wiggle Animation */}
      <style>{`
        @keyframes wiggle {
          0%, 100% { transform: rotate(-0.3deg) scale(1.01); }
          50% { transform: rotate(0.3deg) scale(1.01); }
        }
        .card-wiggle {
          animation: wiggle 0.6s ease-in-out infinite;
          cursor: grab;
        }
        .card-wiggle:active {
          cursor: grabbing;
        }
        .card-dragging {
          opacity: 0.4;
        }
        .card-drag-over {
          border-color: rgb(236 72 153 / 0.7) !important;
          box-shadow: 0 0 0 2px rgb(236 72 153 / 0.3), 0 0 20px rgb(236 72 153 / 0.1);
        }
      `}</style>

      {/* ═══════════════════ DASHBOARD SECTIONS ═══════════════════ */}
      {/* ═══════════════════ CUSTOMIZATION TOOLBAR ═══════════════════ */}
      <div className="flex justify-end relative z-30">
        <div className="flex items-center gap-2 bg-gray-900/50 border border-gray-800 rounded-xl p-2 backdrop-blur-sm">
          {isEditMode && (
            <>
              <div className="flex items-center gap-2 mr-2 border-r border-gray-700/50 pr-3">
                <span className="text-xs text-gray-500 font-medium">Default View:</span>
                <select
                  value={defaultDatePreset}
                  onChange={(e) => setDefaultDatePreset(e.target.value)}
                  className="bg-gray-800 text-gray-200 text-xs rounded-lg border border-gray-700 focus:ring-1 focus:ring-pink-500 focus:border-pink-500 py-1.5 pl-2 pr-8"
                >
                  {DATE_PRESETS.map(preset => (
                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                  ))}
                </select>
              </div>

              {/* Default Load Days */}
              <div className="flex items-center gap-2 mr-2 border-r border-gray-700/50 pr-3">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs text-gray-500 font-medium">Default Load:</span>
                <select
                  value={defaultLoadDays}
                  onChange={(e) => {
                    const days = Number(e.target.value);
                    setDefaultLoadDays(days);
                    setLoadDaysToast({ days, visible: true });
                    setTimeout(() => setLoadDaysToast(prev => prev ? { ...prev, visible: false } : null), 4000);
                    setTimeout(() => setLoadDaysToast(null), 4300);
                  }}
                  className="bg-gray-800 text-gray-200 text-xs rounded-lg border border-gray-700 focus:ring-1 focus:ring-amber-500 focus:border-amber-500 py-1.5 pl-2 pr-8"
                >
                  {LOAD_DAY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.description})
                    </option>
                  ))}
                </select>
              </div>

              {/* Toggles */}
              <div className="flex items-center gap-3 mr-2 border-r border-gray-700/50 pr-3">
                <label className="flex items-center gap-2 cursor-pointer group" title="Aligns previous period with Seller Center (UTC-based) for accurate trends">
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={useHybridTimezone}
                      onChange={(e) => setUseHybridTimezone(e.target.checked)}
                    />
                    <div className={`w-8 h-4 rounded-full transition-colors ${useHybridTimezone ? 'bg-purple-600' : 'bg-gray-700'}`}></div>
                    <div className={`absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${useHybridTimezone ? 'translate-x-4' : 'translate-x-0'}`}></div>
                  </div>
                  <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">Hybrid Trends</span>
                </label>
              </div>

              <button
                onClick={() => setSelectedMetricIds(DEFAULT_METRICS)}
                className="text-xs text-gray-400 hover:text-pink-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800"
              >
                Reset
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowAddPanel(!showAddPanel)}
                  disabled={availableMetrics.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-800 text-gray-200 hover:text-white hover:bg-gray-700 border border-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Metrics
                </button>
                {/* Add Metrics Dropdown */}
                {showAddPanel && availableMetrics.length > 0 && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden max-h-80 overflow-y-auto">
                    <div className="p-3 border-b border-gray-800">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Available Metrics</p>
                    </div>
                    <div className="p-2">
                      {availableMetrics.map(metric => (
                        <button
                          key={metric.id}
                          onClick={() => { addMetric(metric.id); if (availableMetrics.length <= 1) setShowAddPanel(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors text-left"
                        >
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${metric.borderColor.replace('/30', '')}`} />
                          <span>{metric.label}</span>
                          <Plus className="w-3 h-3 ml-auto text-gray-500" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="w-px h-5 bg-gray-700/50 mx-1"></div>
            </>
          )}

          <button
            onClick={() => { setIsEditMode(!isEditMode); setShowAddPanel(false); }}
            className={`flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${isEditMode
              ? 'bg-pink-500 text-white shadow-lg shadow-pink-900/20'
              : 'text-gray-300 hover:text-white hover:bg-gray-800'
              }`}
          >
            <Settings2 className="w-4 h-4" />
            {isEditMode ? 'Done' : 'Customize'}
          </button>
        </div>
      </div>

      <div className="space-y-8">
        {dashboardLayout.map((sectionId, index) => {
          const isDragging = dragSectionIndex === index;
          const isDragOver = dragSectionOverIndex === index && dragSectionIndex !== index;

          if (sectionId === 'metrics') {
            return (
              <div
                key="metrics"
                draggable={isEditMode}
                onDragStart={isEditMode ? (e) => handleSectionDragStart(e, index) : undefined}
                onDragOver={isEditMode ? (e) => handleSectionDragOver(e, index) : undefined}
                onDragEnd={isEditMode ? handleSectionDragEnd : undefined}
                className={`transition-all duration-300 ${isEditMode ? 'cursor-grab active:cursor-grabbing p-4 border border-dashed border-gray-700/50 rounded-2xl hover:bg-gray-800/20' : ''} ${isDragging ? 'opacity-40' : ''} ${isDragOver ? 'border-pink-500/50 bg-pink-500/5 ring-1 ring-pink-500/30' : ''}`}
              >
                {/* ═══════════════════ CUSTOMIZABLE METRICS ═══════════════════ */}
                <div>
                  {/* Section header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      {isEditMode && <div className="text-gray-500 mr-2">⣿</div>}
                      <h3 className="text-lg font-semibold text-white">Key Metrics</h3>
                      <span className="text-xs text-gray-500">({selectedMetricIds.length} of {metricRegistry.length})</span>
                    </div>
                    <div className="flex items-center gap-2" onMouseDown={e => e.stopPropagation()}>


                    </div>
                  </div>

                  {isEditMode && (
                    <p className="text-xs text-gray-500 mb-3 -mt-2 ml-1">Drag cards to reorder. Drag entire section to move up/down.</p>
                  )}



                  {/* Metric Cards Grid */}
                  {selectedMetricIds.length > 0 ? (
                    <div
                      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                      onDragLeave={handleDragLeaveGrid}
                    >
                      {selectedMetricIds.map((id, index) => {
                        const metric = metricMap.get(id);
                        if (!metric) return null;
                        const hasTrend = metric.trendChange !== undefined;
                        const isDragging = dragIndex === index;
                        const isDragOver = dragOverIndex === index && dragIndex !== index;
                        return (
                          <div
                            key={metric.id}
                            className={`relative bg-gray-800 border ${metric.borderColor} rounded-xl p-5 flex items-center justify-between select-none transition-all duration-150 ${isEditMode ? 'card-wiggle' : ''
                              } ${isDragging ? 'card-dragging' : ''} ${isDragOver ? 'card-drag-over' : ''} ${!isEditMode && metric.onClick ? 'cursor-pointer hover:bg-gray-750 hover:border-purple-400/50' : ''}`}
                            style={isEditMode ? { animationDelay: `${index * 50}ms` } : undefined}
                            draggable={isEditMode}
                            onClick={!isEditMode && metric.onClick ? metric.onClick : undefined}
                            onDragStart={isEditMode ? (e) => { e.stopPropagation(); handleDragStart(e, index); } : undefined}
                            onDragOver={isEditMode ? (e) => { e.stopPropagation(); handleDragOver(e, index); } : undefined}
                            onDragEnd={isEditMode ? (e) => { e.stopPropagation(); handleDragEnd(); } : undefined}
                            onPointerDown={!isEditMode ? handlePointerDown : undefined}
                            onPointerUp={!isEditMode ? handlePointerUp : undefined}
                            onPointerLeave={!isEditMode ? handlePointerUp : undefined}
                          >
                            {/* X button to remove (edit mode) */}
                            {isEditMode && (
                              <button
                                onClick={(e) => { e.stopPropagation(); removeMetric(metric.id); }}
                                className="absolute -top-2 -right-2 w-6 h-6 bg-gray-700 border border-gray-600 rounded-full flex items-center justify-center text-gray-400 hover:bg-red-500 hover:text-white transition-colors z-10 shadow-lg"
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">{metric.label}</p>
                              <p className="text-2xl font-bold text-white truncate">{metric.getValue()}</p>
                              {metric.subtitle && (
                                <p className="text-gray-500 text-xs mt-1 truncate">{metric.subtitle}</p>
                              )}
                            </div>
                            {hasTrend && (
                              <div className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 ml-3 ${metric.trendChange! >= 0
                                ? 'bg-green-500/10 text-green-400'
                                : 'bg-red-500/10 text-red-400'
                                }`}>
                                <TrendingUp className={`w-3 h-3 ${metric.trendChange! < 0 ? 'rotate-180' : ''}`} />
                                {formatKeyMetricTrendPercent(metric.trendChange!)}%
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="bg-gray-800/50 rounded-xl border border-dashed border-gray-700 p-8 text-center">
                      <Settings2 className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                      <p className="text-gray-500 text-sm">No metrics selected. Click <strong className="text-gray-400">Customize</strong> to add cards.</p>
                    </div>
                  )}
                </div>
              </div>
            );
          }

          if (sectionId === 'charts') {
            return (
              <div
                key="charts"
                draggable={isEditMode}
                onDragStart={isEditMode ? (e) => handleSectionDragStart(e, index) : undefined}
                onDragOver={isEditMode ? (e) => handleSectionDragOver(e, index) : undefined}
                onDragEnd={isEditMode ? handleSectionDragEnd : undefined}
                className={`transition-all duration-300 ${isEditMode ? 'cursor-grab active:cursor-grabbing p-4 border border-dashed border-gray-700/50 rounded-2xl hover:bg-gray-800/20' : ''} ${isDragging ? 'opacity-40' : ''} ${isDragOver ? 'border-pink-500/50 bg-pink-500/5 ring-1 ring-pink-500/30' : ''}`}
              >
                {/* Performance Comparison Charts */}
                <div className="w-full">
                  <div className="flex items-center gap-2 mb-4">
                    {isEditMode && <div className="text-gray-500 mr-2">⣿</div>}
                    <h3 className="text-lg font-semibold text-white">Performance Comparison</h3>
                  </div>
                  <ComparisonCharts
                    orders={orders}
                    startDate={dateRange.startDate}
                    endDate={dateRange.endDate}
                    timezone={timezone}
                    includeCancelledInTotal={includeCancelledInTotal}
                    includeCancelledFinancials={includeCancelledFinancials}
                  />
                </div>
              </div>
            );
          }
          return null;
        })}

        {/* Affiliate Commission Card (Placed here as requested: 3rd section, before Quick Stats) */}
        <div className="w-full">
          <AffiliateCommissionCard
            autoCommission={autoAffiliateCommissionDetail.total}
            autoOtherAffiliateCogs={autoAffiliateCommissionDetail.autoOtherAffiliateCogsCombined}
            autoCommissionLines={autoAffiliateCommissionDetail.lines}
            autoCommissionNetSigned={autoAffiliateCommissionDetail.netSigned}
            manualRetainers={affiliateSettlements}
            dateRangeLabel={dateRangeSubtitle}
          />
        </div>
      </div>

      {/* ═══════════════════ QUICK STATS (FIXED) ═══════════════════ */}
      <div className="h-24" />

      {/* ═══════════════════ QUICK STATS (FIXED) ═══════════════════ */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Quick Stats</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 flex items-center justify-between hover:bg-gray-800/70 transition-colors">
            <div>
              <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">Orders Today</p>
              <p className="text-xl font-bold text-white mt-1">{quickStats.ordersToday}</p>
            </div>
            <div className="bg-indigo-500/10 p-2 rounded-lg border border-indigo-500/20">
              <TrendingUp className="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 flex items-center justify-between hover:bg-gray-800/70 transition-colors">
            <div>
              <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">Revenue Today</p>
              <p className="text-xl font-bold text-white mt-1">{formatCurrency(quickStats.revenueToday)}</p>
            </div>
            <div className="bg-lime-500/10 p-2 rounded-lg border border-lime-500/20">
              <TrendingUp className="w-5 h-5 text-lime-400" />
            </div>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 flex items-center justify-between hover:bg-gray-800/70 transition-colors">
            <div>
              <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">Pending Orders</p>
              <p className="text-xl font-bold text-white mt-1">{quickStats.pendingOrders}</p>
            </div>
            <div className="bg-yellow-500/10 p-2 rounded-lg border border-yellow-500/20">
              <AlertCircle className="w-5 h-5 text-yellow-400" />
            </div>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 flex items-center justify-between hover:bg-gray-800/70 transition-colors">
            <div>
              <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">Low Stock</p>
              <p className="text-xl font-bold text-white mt-1">{quickStats.lowStockProducts}</p>
            </div>
            <div className="bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
              <AlertCircle className="w-5 h-5 text-rose-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      {canMutateShop && (
        <div className="bg-red-900/10 border border-red-500/30 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h3>
          <p className="text-gray-400 text-sm mb-4">
            Clear all shop data and start fresh. This will delete all orders, products, and financial data from the database.
          </p>
          <button
            onClick={() => setShowClearDataConfirm(true)}
            disabled={isClearing}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            {isClearing ? 'Clearing...' : 'Clear All Shop Data'}
          </button>
        </div>
      )}

      {/* Confirmation Dialog */}
      {
        canMutateShop && showClearDataConfirm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 border border-red-500/30 rounded-2xl p-8 max-w-md w-full">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-red-500/10 p-3 rounded-full">
                  <AlertCircle className="w-6 h-6 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-white">Clear All Shop Data?</h3>
              </div>
              <p className="text-gray-300 mb-6">
                This will permanently delete:
              </p>
              <ul className="text-gray-400 space-y-2 mb-6 ml-4">
                <li>• All orders</li>
                <li>• All products</li>
                <li>• All financial settlements</li>
                <li>• All performance data</li>
              </ul>
              <p className="text-yellow-400 text-sm mb-6">
                ⚠️ This action cannot be undone! You will need to sync again to restore data from TikTok.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearDataConfirm(false)}
                  disabled={isClearing}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearShopData}
                  disabled={isClearing}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isClearing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Clearing...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Yes, Clear All Data
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )
      }


      {/* Load Days Toast */}
      {loadDaysToast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 shadow-xl border border-gray-700 transition-all duration-300 ${loadDaysToast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
            }`}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
            <Zap className="h-4 w-4 text-amber-400" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white">
              {loadDaysToast.days === 1 ? '1 day' : `${loadDaysToast.days} days`} set as your default load
            </span>
            <span className="text-xs text-gray-400">
              On your next reload, {loadDaysToast.days === 1 ? '1 day' : `${loadDaysToast.days} days`} of data will be loaded initially
            </span>
          </div>
        </div>
      )}
    </div >
  );
}
