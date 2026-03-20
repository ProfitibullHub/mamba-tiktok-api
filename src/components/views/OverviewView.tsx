
import { TrendingUp, Star, RefreshCw, AlertCircle, Trash2, Calendar, Settings2, X, Plus, Zap } from 'lucide-react';
import { AffiliateCommissionCard } from '../AffiliateCommissionCard';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Account } from '../../lib/supabase';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { RefreshPrompt } from '../RefreshPrompt';
import { useShopStore, Order } from '../../store/useShopStore';
import { useTikTokAdsStore } from '../../store/useTikTokAdsStore';
import { getPreviousPeriodRange } from '../../utils/dateUtils';
import { calculateOrderGMV } from '../../utils/gmvCalculations';
import { LOAD_DAY_OPTIONS, DEFAULT_LOAD_DAYS } from '../../config/dataRetention';

// Use paid_time for filtering (matches backend which loads by paid_time)
const getOrderTs = (o: Order): number => Number(o.paid_time || o.created_time);

// Helper function to detect cancelled or refunded orders
const isCancelledOrRefunded = (order: Order): boolean => {
  return (
    order.order_status === 'CANCELLED' ||
    !!order.cancel_reason ||
    !!order.cancellation_initiator
  );
};


import { DateRangePicker, DateRange } from '../DateRangePicker';
import { TokenExpirationWarning } from '../TokenExpirationWarning';
import { parseLocalDate, getShopDayStartTimestamp, formatShopDateISO } from '../../utils/dateUtils';
import { ComparisonCharts } from '../ComparisonCharts';

interface OverviewViewProps {
  account: Account;
  shopId?: string;

  timezone?: string; // Shop timezone for date calculations
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


export function OverviewView({ account, shopId, timezone = 'America/Los_Angeles' }: OverviewViewProps) {
  const metrics = useShopStore(state => state.metrics);

  const error = useShopStore(state => state.error);
  const fetchShopData = useShopStore(state => state.fetchShopData);
  const syncData = useShopStore(state => state.syncData);
  const cacheMetadata = useShopStore(state => state.cacheMetadata);
  const dismissRefreshPrompt = useShopStore(state => state.dismissRefreshPrompt);

  const orders = useShopStore(state => state.orders);
  const products = useShopStore(state => state.products);
  const finance = useShopStore(state => state.finance);
  const dataVersion = useShopStore(state => state.dataVersion);


  // TikTok Ads store


  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

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


  // Cancelled orders are ALWAYS included in totals and financials
  const includeCancelledInTotal = true;
  const includeCancelledFinancials = true;

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

  // Memoize API Base URL
  const API_BASE_URL = useMemo(() => import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001', []);

  // Fetch token health status
  useEffect(() => {
    const fetchTokenHealth = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/auth/status/${account.id}`);
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
  }, [account.id, API_BASE_URL]);

  // Memoize the fetch function to prevent duplicate calls
  const handleDateRangeChange = useCallback((start: string, end: string) => {
    if (shopId && start && end) {
      // Use includePreviousPeriod: true so the store handles fetching the historical data needed for trends
      // Pass initialLoadDays so the store uses the user's preferred default (matters for initial/no-date calls)
      console.log(`[OverviewView] Fetching ${start} to ${end} (with extended history for trends, defaultLoad=${defaultLoadDays}d)`);
      fetchShopData(account.id, shopId, { skipSyncCheck: true, includePreviousPeriod: true, initialLoadDays: defaultLoadDays }, start, end);
      fetchAffiliateSettlements(account.id, shopId, start, end);
      fetchAgencyFees(account.id, shopId, start, end);
      fetchAdsSpend(account.id, start, end);
    }
  }, [shopId, account.id, fetchShopData, fetchAffiliateSettlements, fetchAgencyFees, fetchAdsSpend, defaultLoadDays]);

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
  const wasSyncingRef = useRef(false);
  useEffect(() => {
    if (cacheMetadata.isSyncing) {
      wasSyncingRef.current = true;
    } else if (wasSyncingRef.current) {
      wasSyncingRef.current = false;
      console.log('[OverviewView] Sync completed — forcing re-render to pick up merged data.');
      // Increment counter to force React re-render (no Supabase refetch)
      setSyncRenderKey(k => k + 1);
      // Only refresh affiliate settlements, agency fees, and ads spend (not part of the sync delta)
      if (shopId) {
        fetchAffiliateSettlements(account.id, shopId, dateRange.startDate, dateRange.endDate);
        fetchAgencyFees(account.id, shopId, dateRange.startDate, dateRange.endDate);
        fetchAdsSpend(account.id, dateRange.startDate, dateRange.endDate);
      }
    }
  }, [cacheMetadata.isSyncing, shopId, account.id, fetchAffiliateSettlements, fetchAgencyFees, fetchAdsSpend, dateRange.startDate, dateRange.endDate]);

  // Handle reconnect - redirect to TikTok auth
  const handleReconnect = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/auth/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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


  // Update lastUpdated when metrics change
  useEffect(() => {
    if (metrics.totalOrders > 0 || metrics.totalProducts > 0) {
      setLastUpdated(new Date());
    }
  }, [metrics]);


  // Calculate metrics using P&L data (matching ProfitLossView exactly)
  const { calculatedMetrics, completedOrders, sampleOrderMetrics, cancelledRefundedMetrics, totalOrdersRaw, metricsData } = useMemo(() => {

    // Use Shop Timezone for filtering
    const start = getShopDayStartTimestamp(dateRange.startDate, timezone);
    const end = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86399;

    // ── PAID_TIME POOL ─────────────────────────────────────────────────────────
    // All non-sample orders whose paid_time (or created_time fallback) falls in range.
    // This is the single source of truth for counts and financials.
    const allPaidTimeOrders = orders.filter(o => {
      const ts = getOrderTs(o);
      return ts >= start && ts <= end && o.is_sample_order !== true;
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
      return ts >= start && ts <= end;
    });

    const cancelledRefundedOrderIds = new Set(cancelledRefundedOrders.map(o => o.order_id));

    // Calculate sample order metrics separately
    const sampleOrders = orders.filter(o =>
      getOrderTs(o) >= start && getOrderTs(o) <= end && o.is_sample_order === true
    );

    // Create a Set of sample order IDs for efficient lookup
    const sampleOrderIds = new Set(sampleOrders.map(o => o.order_id));


    // --- Current Period Metrics ---

    const currentGMV = ordersForFinancials.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
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

    // Calculate Previous Period using centralized helper (for Hybrid Timezone fix)
    const { prevStart, prevEnd } = getPreviousPeriodRange(start, start + (Math.ceil((end - start) / 86400) * 86400), timezone, useHybridTimezone);

    // Previous period — paid_time pool (mirrors current period logic exactly)
    const prevAllPaidTimeOrders = orders.filter(o => {
      const ts = getOrderTs(o);
      return ts >= prevStart && ts <= prevEnd && o.is_sample_order !== true;
    });
    const prevActiveOrders = prevAllPaidTimeOrders.filter(o => !isCancelledOrRefunded(o));

    const prevOrdersForCount = includeCancelledInTotal ? prevAllPaidTimeOrders : prevActiveOrders;
    const prevOrdersForFinancials = includeCancelledFinancials ? prevAllPaidTimeOrders : prevActiveOrders;

    const prevGMV = prevOrdersForFinancials.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
    const prevTotalOrders = prevOrdersForCount.length;
    const prevItemsSold = prevOrdersForCount.reduce((sum, o) => sum + (o.line_items?.reduce((total, item) => total + (item.quantity || 0), 0) || 0), 0);
    const prevCustomers = groupDailyCustomers(prevOrdersForCount);

    // --- Trends ---

    const calculateChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    const gmvChange = calculateChange(currentGMV, prevGMV);
    const ordersChange = calculateChange(currentTotalOrders, prevTotalOrders);
    const itemsSoldChange = calculateChange(currentItemsSold, prevItemsSold);
    const customersChange = calculateChange(currentCustomers, prevCustomers);

    // Filter statements: date range AND exclude those linked to sample orders
    // If includeCancelledFinancials is FALSE, also exclude statements linked to cancelled orders
    // Use finance.statements from outer scope
    const statements = finance.statements || [];
    const filteredStatements = statements.filter(s => {
      const ts = Number(s.statement_time || 0);
      const isTimeMatch = ts >= start && ts <= end;

      const isSampleStatement = s.order_id ? sampleOrderIds.has(s.order_id) : false;
      const isCancelledStatement = s.order_id ? cancelledRefundedOrderIds.has(s.order_id) : false;

      if (!includeCancelledFinancials && isCancelledStatement) return false;

      return isTimeMatch && !isSampleStatement;
    });

    // Calculate GMV using formula: (Price × Items Sold) + Shipping Fees - Seller Discounts - Platform Discounts
    const totalGMV = currentGMV;

    // Total Revenue = GMV 
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

    const totalFees = filteredStatements.reduce((sum, s) => {
      const fees = s.transaction_summary?.fees || {};
      const feeSum = Object.values(fees).reduce((acc, v) => acc + Math.abs(v), 0);
      return sum + feeSum;
    }, 0);

    const totalShipping = filteredStatements.reduce((sum, s) => {
      return sum + Math.abs(parseFloat(s.shipping_fee || '0'));
    }, 0);

    // Manual affiliate retainers (not deducted by TikTok, so not in settlementAmount)
    const manualAffiliateRetainers = affiliateSettlements.reduce((sum, s) => sum + Number(s.amount), 0);

    // Agency fees
    const agencyFeesTotal = agencyFees.reduce((sum, s) => sum + Number(s.amount), 0);

    // External ad spend (TikTok Ads API — separate from TikTok settlement fees)
    const adSpendTotal = adsSpendData?.totals.total_spend || 0;

    // Net Profit = GMV minus every expense bucket
    // Matches P&L's clientNetProfit formula exactly: GMV - COGS - Shipping - Fees - Ads - Agency
    // Note: totalFees already includes auto-affiliate commissions and shop ads fees extracted from statements.
    const netProfitFinal = currentGMV - totalCogs - totalProductShippingCost - totalFees - totalShipping - adSpendTotal - agencyFeesTotal - manualAffiliateRetainers;

    // Gross Profit = Total Revenue - COGS
    const grossProfit = totalRevenue - totalCogs;

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
        const rawEnd = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;
        return orders.filter(o => getOrderTs(o) >= rawStart && getOrderTs(o) < rawEnd).length;
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
  }, [orders, finance.statements, dateRange, products, dataVersion, syncRenderKey, useHybridTimezone, affiliateSettlements, agencyFees, adsSpendData]);


  // Calculate Quick Stats
  const quickStats = useMemo(() => {
    // Get today's date range using Shop Timezone (to match charts)
    const todayStr = formatShopDateISO(new Date(), timezone); // Get today's date in YYYY-MM-DD format
    const todayStart = getShopDayStartTimestamp(todayStr, timezone);
    const todayEnd = todayStart + 86400;

    // Orders Today (excluding sample orders and cancelled/refunded orders)
    const todaysOrders = orders.filter(o => getOrderTs(o) >= todayStart && getOrderTs(o) < todayEnd && o.is_sample_order !== true && !isCancelledOrRefunded(o));
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
  }, [orders, products, dataVersion, syncRenderKey]);


  const handleSync = useCallback(async () => {
    if (!shopId) {
      console.error('Sync failed: No shopId provided');
      return;
    }
    console.log('Starting sync for shop:', shopId);
    try {
      await syncData(account.id, shopId, 'all');
      console.log('Sync completed successfully');
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Sync failed with error:', err);
    }
  }, [shopId, account.id, syncData]);

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
    if (!shopId) return;

    setIsClearing(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/shop-data/${account.id}/clear?shopId=${shopId}`, {
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

  // Calculate Auto Commissions from already-loaded settlement statements
  // Each statement has a transaction_summary with fee breakdowns including affiliate_commission
  // Uses shop timezone boundaries to match P&L endpoint filtering
  const autoAffiliateCommission = useMemo(() => {
    const start = getShopDayStartTimestamp(dateRange.startDate, timezone);
    const end = getShopDayStartTimestamp(dateRange.endDate, timezone) + 86400;

    return Math.abs(
      finance.statements
        .filter(s => s.statement_time >= start && s.statement_time < end)
        .reduce((sum, s) => sum + (s.transaction_summary?.fees?.affiliate_commission || 0), 0)
    );
  }, [finance.statements, dateRange, timezone]);

  const DEFAULT_METRICS = ['gmv', 'netProfit', 'totalOrders', 'totalCustomers', 'itemsSold'];

  const { user } = useAuth();
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
      {/* Refresh Prompt */}
      {cacheMetadata.showRefreshPrompt && (
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
      {/* Account Header */}
      <div className="bg-gradient-to-r from-pink-500/10 to-red-500/10 border border-pink-500/30 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {account.avatar_url ? (
              <img src={account.avatar_url} alt={account.name} className="w-16 h-16 rounded-full" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-r from-pink-500 to-red-500 flex items-center justify-center text-white text-2xl font-bold">
                {account.name.charAt(0)}
              </div>
            )}
            <div>
              <h2 className="text-2xl font-bold text-white">{account.name}</h2>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-white truncate">
                  {(account as any).tiktok_handle || account.tiktok_handle || 'TikTok Shop'}
                </p>
                {(account as any).owner_role && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-pink-500/20 text-pink-400 border border-pink-500/30">
                    {(account as any).owner_role.toUpperCase()}
                  </span>
                )}
                {metrics.shopRating > 0 && (
                  <div className="flex items-center gap-1 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20">
                    <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                    <span className="text-xs text-yellow-200">{metrics.shopRating.toFixed(1)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
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
              <DateRangePicker
                value={dateRange}
                onChange={(range) => {
                  setDateRange(range);
                  handleDateRangeChange(range.startDate, range.endDate);
                }}
              />
              <button
                onClick={handleSync}
                disabled={cacheMetadata.isSyncing}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${cacheMetadata.isSyncing
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed items-center space-x-2 px-4 py-2'
                  : 'flex items-center space-x-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors disabled:opacity-50'
                  } `}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${cacheMetadata.isSyncing ? 'animate-spin' : ''} `} />
                {cacheMetadata.isSyncing ? 'Syncing...' : 'Sync Now'}
              </button>


            </div>
            {lastUpdated && (
              <p className="text-xs text-gray-500">
                Updated: {lastUpdated.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
      </div>



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
                                {Math.abs(metric.trendChange!).toFixed(1)}%
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
            autoCommission={autoAffiliateCommission}
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

      {/* Confirmation Dialog */}
      {
        showClearDataConfirm && (
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
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 shadow-xl border border-gray-700 transition-all duration-300 ${
            loadDaysToast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
          }`}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
            <Zap className="h-4 w-4 text-amber-400" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white">
              {loadDaysToast.days} days set as your default load
            </span>
            <span className="text-xs text-gray-400">
              On your next reload, {loadDaysToast.days} days of data will be loaded initially
            </span>
          </div>
        </div>
      )}
    </div >
  );
}
