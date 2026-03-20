import { create } from 'zustand';
import { calculateOrderGMV } from '../utils/gmvCalculations';
import { DEFAULT_SYNC_DAYS, getInitialLoadDaysWithBuffer, DEFAULT_LOAD_DAYS } from '../config/dataRetention';
import { supabase, AffiliateSettlement, AgencyFee } from '../lib/supabase';
import { getShopDayStartTimestamp } from '../utils/dateUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export interface ProductSKU {
    id: string;
    seller_sku?: string;
    price: {
        currency: string;
        sale_price?: string;
        tax_exclusive_price: string;
    };
    inventory: Array<{
        quantity: number;
        warehouse_id?: string;
    }>;
    sales_attributes?: Array<{
        id: string;
        name: string;
        value_id: string;
        value_name: string;
        sku_img?: {
            urls: string[];
        };
    }>;
    cogs?: number | null; // Cost of Goods Sold for this variant
    shipping_cost?: number | null; // Shipping cost for this variant
}

export interface Product {
    product_id: string;
    name: string;
    status: string;
    price: number;
    currency: string;
    stock_quantity: number;
    sales_count: number;
    main_image_url: string;
    images?: string[];
    click_through_rate?: number;
    gmv?: number;
    orders_count?: number;
    cogs?: number | null; // Cost of Goods Sold (user-editable)
    shipping_cost?: number | null; // Shipping cost per unit
    is_fbt?: boolean; // Fulfilled by TikTok
    fbt_source?: 'auto' | 'manual'; // 'auto' (from API) or 'manual' (user override)
    details?: any; // Full JSON blob
    skus?: ProductSKU[]; // SKU variants
}

export interface Order {
    order_id: string;
    order_status: string;
    order_amount: number;
    currency: string;
    created_time: number;
    update_time?: number; // Last update timestamp (used for cancellation date)
    paid_time?: number; // Payment timestamp (null/undefined for UNPAID orders)
    line_items: {
        id: string;
        product_id?: string;
        product_name: string;
        sku_image: string;
        quantity: number;
        sale_price: string;
        original_price?: string;
        seller_sku?: string;
        sku_name?: string;
        is_dangerous_good?: boolean;
        is_gift?: boolean;
    }[];
    buyer_info?: {
        buyer_email?: string;
        buyer_nickname?: string;
        buyer_avatar?: string;
        buyer_message?: string;
    };
    shipping_info?: {
        name?: string;
        phone_number?: string;
        address_line1?: string;
        address_line2?: string;
        city?: string;
        state?: string;
        postal_code?: string;
        country?: string;
        tracking_number?: string;
        shipping_provider?: string;
        delivery_option_name?: string;
        full_address?: string;
    };
    // Extended payment info with all fee breakdowns
    payment_info?: {
        currency?: string;
        sub_total?: string;
        shipping_fee?: string;
        tax?: string;
        total_amount?: string;
        subtotal_before_discount_amount?: string;
        customer_paid_shipping_fee_amount?: string;
        // Additional payment breakdown fields
        original_shipping_fee?: string;
        original_total_product_price?: string;
        platform_discount?: string;
        product_tax?: string;
        seller_discount?: string;
        shipping_fee_cofunded_discount?: string;
        shipping_fee_platform_discount?: string;
        shipping_fee_seller_discount?: string;
        shipping_fee_tax?: string;
        item_insurance_tax?: string;
    };
    // Shipping & Delivery options
    payment_method_name?: string;
    shipping_type?: string; // "SELLER" or "PLATFORM"
    delivery_option_id?: string;
    delivery_option_name?: string;
    // FBT (Fulfilled by TikTok) tracking
    fulfillment_type?: 'FULFILLMENT_BY_TIKTOK' | 'FULFILLMENT_BY_SELLER';
    is_fbt?: boolean;
    fbt_fulfillment_fee?: number | null;
    warehouse_id?: string | null;
    // Return & Refund info
    return_status?: string;
    substatus?: string;
    refund_amount?: number;
    return_reason?: string;
    cancel_reason?: string;
    cancellation_initiator?: string;
    // Sample order flag
    is_sample_order?: boolean;

    // New Fields
    collection_time?: number;
    is_cod?: boolean;
    is_exchange_order?: boolean;
    is_on_hold_order?: boolean;
    is_replacement_order?: boolean;
    delivery_type?: string;
    seller_note?: string;
    shipping_due_time?: number;
    shipping_provider_id?: string;
    shipping_provider?: string;
    tracking_number?: string;
}

export interface Statement {
    id: string;
    statement_time: number;
    settlement_amount: string;
    currency: string;
    payment_status: string;
    revenue_amount: string;
    fee_amount: string;
    adjustment_amount: string;
    shipping_fee: string;
    net_sales_amount: string;
    payment_id?: string;
    payment_time?: number;
    order_id?: string;
    transaction_summary?: {
        transaction_count?: number;
        fees?: Record<string, number>;
        revenue?: Record<string, number>;
        shipping?: Record<string, number>;
        taxes?: Record<string, number>;
        [key: string]: any;
    };
}

interface ShopMetrics {
    totalOrders: number;
    totalRevenue: number;
    totalProducts: number;
    totalNet: number;
    avgOrderValue: number;
    conversionRate: number;
    shopRating: number;
    unsettledRevenue?: number;
    netProfit?: number;
}

interface CacheMetadata {
    shopId: string | null;
    accountId: string | null;
    ordersLastSynced: string | null;
    productsLastSynced: string | null;
    settlementsLastSynced: string | null;
    isSyncing: boolean;
    showRefreshPrompt: boolean;
    isStale: boolean;
    isFirstSync: boolean;
    lastSyncStats: { orders?: { fetched: number; upserted: number }; products?: { fetched: number }; settlements?: { fetched: number } } | null;
    lastPromptDismissedAt: number | null; // Track when user dismissed prompt to avoid re-prompting
}

interface SyncProgress {
    isActive: boolean;
    isFirstSync: boolean;
    currentStep: 'idle' | 'orders' | 'products' | 'settlements' | 'complete';
    message: string;
    ordersComplete: boolean;
    productsComplete: boolean;
    settlementsComplete: boolean;
    ordersFetched: number;
    productsFetched: number;
    settlementsFetched: number;
}

export interface Warehouse {
    id: string;
    name: string;
    is_default?: boolean;
    address?: {
        region?: string;
        state?: string;
        city?: string;
        postal_code?: string;
    };
}

export interface ProductEditData {
    title?: string;
    description?: string;
    main_images?: Array<{ uri: string }>;
    skus?: Array<{
        id: string;
        seller_sku?: string;
        original_price?: string;
        inventory?: Array<{
            warehouse_id: string;
            quantity: number;
        }>;
    }>;
}

interface ShopState {
    products: Product[];
    orders: Order[];
    metrics: ShopMetrics;
    finance: {
        statements: Statement[];
        payments: any[];
        withdrawals: any[];
        unsettledOrders: any[];
        affiliateSettlements: AffiliateSettlement[];
        agencyFees: AgencyFee[];
    };
    warehouses: Warehouse[];
    isLoading: boolean;
    isFetchingDateRange: boolean;
    fetchDateRange: { startDate: string | null; endDate: string | null };
    error: string | null;
    lastFetchTime: number | null;
    lastFetchShopId: string | null;
    cacheMetadata: CacheMetadata;
    currentDateRange: {
        startDate: string | null;
        endDate: string | null;
    };
    // Tracks the widest date range of data actually loaded from Supabase
    // Used to determine if a new date range can be served from cached data
    loadedDateRange: {
        startDate: string | null;
        endDate: string | null;
    };
    syncProgress: SyncProgress;
    syncAbortController: AbortController | null;
    dataVersion: number; // Increments on every data update to force UI re-renders

    // Actions
    fetchShopData: (accountId: string, shopId?: string, options?: { forceRefresh?: boolean; showCached?: boolean; skipSyncCheck?: boolean; includePreviousPeriod?: boolean; initialLoadDays?: number }, startDate?: string, endDate?: string) => Promise<void>;
    setProducts: (products: Product[]) => void;
    setOrders: (orders: Order[]) => void;
    setMetrics: (metrics: Partial<ShopMetrics>) => void;
    clearData: () => void;
    syncData: (accountId: string, shopId: string, syncType?: 'orders' | 'products' | 'finance' | 'all') => Promise<void>;
    cancelSync: () => void;
    dismissRefreshPrompt: () => void;
    autoSyncInProgress: string[];
    newOrdersNotification: { count: number } | null;
    clearNewOrdersNotification: () => void;
    smartAutoSync: (accountId: string, shopId: string) => Promise<void>;
    mergeSyncedOrdersIntoStore: (syncedOrders: any[], shopId: string) => void;
    mergeSyncedProductsIntoStore: (syncedProducts: any[], shopId: string) => void;
    mergeSyncedSettlementsIntoStore: (syncedSettlements: any[], shopId: string) => void;
    mergeAfterSync: (accountId: string, shopId: string, sinceTimestamp: string, types?: string) => Promise<void>;
    mergeHistoricalOrders: (orders: Order[]) => void;
    updateProductCosts: (productId: string, costs: {
        cogs?: number | null;
        shipping_cost?: number | null;
        is_fbt?: boolean;
        applyFrom?: 'today' | 'specific_date';
        effectiveDate?: string;
        accountId?: string;
    }) => Promise<void>;
    updateProductSkuCosts: (productId: string, skuId: string, costs: {
        cogs?: number | null;
        shipping_cost?: number | null;
        applyFrom?: 'today' | 'specific_date';
        effectiveDate?: string;
    }, accountId?: string) => Promise<void>;
    activateProducts: (accountId: string, productIds: string[]) => Promise<void>;
    deactivateProducts: (accountId: string, productIds: string[]) => Promise<void>;
    deleteProducts: (accountId: string, productIds: string[]) => Promise<void>;
    // Product Editing Actions
    editProduct: (accountId: string, productId: string, updates: ProductEditData) => Promise<void>;
    updateProductInventory: (accountId: string, productId: string, skus: Array<{ id: string; inventory: Array<{ warehouse_id: string; quantity: number }> }>) => Promise<void>;
    updateProductPrices: (accountId: string, productId: string, skus: Array<{ id: string; original_price?: string; sale_price?: string }>) => Promise<void>;
    uploadProductImage: (accountId: string, imageData: string, fileName?: string, useCase?: 'MAIN_IMAGE' | 'SKU_IMAGE') => Promise<{ uri: string }>;
    fetchWarehouses: (accountId: string) => Promise<Warehouse[]>;
    // Affiliate Settlements
    fetchAffiliateSettlements: (accountId: string, shopId: string, startDate: string, endDate: string) => Promise<void>;
    addAffiliateSettlement: (settlement: Omit<AffiliateSettlement, 'id' | 'created_at'>) => Promise<void>;
    deleteAffiliateSettlement: (id: string) => Promise<void>;
    // Agency Fees
    fetchAgencyFees: (accountId: string, shopId: string, startDate: string, endDate: string) => Promise<void>;
    addAgencyFee: (fee: Omit<AgencyFee, 'id' | 'created_at'>) => Promise<void>;
    deleteAgencyFee: (id: string) => Promise<void>;
    // P&L data (persists across navigations, like products/orders)
    plData: any | null;
    plDataKey: string;
    plLoading: boolean;
    plError: string | null;
    fetchPLData: (accountId: string, shopId: string, startDate: string, endDate: string, forceRefresh?: boolean) => Promise<void>;
    memoryCache: Record<string, {
        products: Product[];
        orders: Order[];
        metrics: ShopMetrics;
        finance: {
            statements: Statement[];
            payments: any[];
            withdrawals: any[];
            unsettledOrders: any[];
            affiliateSettlements: AffiliateSettlement[];
            agencyFees: AgencyFee[];
        };
        lastFetchTime: number | null;
        cacheMetadata: CacheMetadata;
        plData?: any | null;
        plDataKey?: string;
        loadedDateRange?: { startDate: string | null; endDate: string | null };
    }>;
    fetchInProgress: boolean; // Track if a fetch is currently running
    dataLoadIncomplete: boolean; // True when batch loading stopped early due to errors
}

/** Fetch with a hard timeout. Rejects with AbortError if timeoutMs elapses. */
async function fetchWithTimeout(url: string, timeoutMs = 30000): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

export const useShopStore = create<ShopState>((set, get) => ({
    products: [],
    orders: [],
    metrics: {
        totalOrders: 0,
        totalRevenue: 0,
        totalProducts: 0,
        totalNet: 0,
        avgOrderValue: 0,
        conversionRate: 0,
        shopRating: 0
    },
    finance: {
        statements: [],
        payments: [],
        withdrawals: [],
        unsettledOrders: [],
        affiliateSettlements: [],
        agencyFees: []
    },
    warehouses: [],
    isLoading: false,
    isFetchingDateRange: false,
    fetchDateRange: { startDate: null, endDate: null },
    error: null,
    lastFetchTime: null,
    lastFetchShopId: null,
    cacheMetadata: {
        shopId: null,
        accountId: null,
        ordersLastSynced: null,
        productsLastSynced: null,
        settlementsLastSynced: null,
        isSyncing: false,
        showRefreshPrompt: false,
        isStale: false,
        isFirstSync: false,
        lastSyncStats: null,
        lastPromptDismissedAt: null
    },
    currentDateRange: {
        startDate: null,
        endDate: null
    },
    loadedDateRange: {
        startDate: null,
        endDate: null
    },
    syncProgress: {
        isActive: false,
        isFirstSync: false,
        currentStep: 'idle',
        message: '',
        ordersComplete: false,
        productsComplete: false,
        settlementsComplete: false,
        ordersFetched: 0,
        productsFetched: 0,
        settlementsFetched: 0
    },
    plData: null,
    plDataKey: '',
    plLoading: false,
    plError: null,
    memoryCache: {},
    autoSyncInProgress: [],
    newOrdersNotification: null,
    clearNewOrdersNotification: () => set({ newOrdersNotification: null }),
    fetchInProgress: false,
    dataLoadIncomplete: false,
    syncAbortController: null,
    dataVersion: 0,

    setProducts: (products) => set({ products }),
    setOrders: (orders) => set({ orders }),
    setMetrics: (newMetrics) => set((state) => ({
        metrics: { ...state.metrics, ...newMetrics }
    })),


    fetchShopData: async (accountId: string, shopId?: string, options = {}, startDate?: string, endDate?: string) => {
        const { forceRefresh = false, showCached = true, skipSyncCheck = false, includePreviousPeriod = false, initialLoadDays } = options;
        const state = get();

        // CRITICAL: Prevent duplicate concurrent fetches
        if (state.fetchInProgress && !forceRefresh) {
            console.log('[Store] Fetch already in progress, skipping duplicate request.');
            return;
        }

        // CRITICAL OPTIMIZATION: Prevent unnecessary re-fetches if data for this date range is already loaded
        // This handles the case where user switches views (Overview -> Orders) and back
        // NOTE: If includePreviousPeriod is true, we might need to fetch even if current range matches,
        // so we skipping this check if we suspect we need expanded data.
        // For now, simpler to just skip this check if includePreviousPeriod is true to be safe,
        // or rely on the effectiveStartDate logic below to verify coverage. 
        // But to be "professional", let's trust the Caller knows what they want.
        if (shopId && shopId === state.lastFetchShopId &&
            startDate === state.currentDateRange.startDate &&
            endDate === state.currentDateRange.endDate &&
            showCached && !forceRefresh && !includePreviousPeriod) {
            console.log('[Store] Data for this date range already loaded, skipping fetch.');
            return;
        }

        // If switching shops, save current data to cache and clear (or load from cache)
        if (shopId && state.lastFetchShopId !== shopId) {
            // Save current shop data to memory cache if we have a valid shop loaded
            if (state.lastFetchShopId) {
                console.log(`[Store] Saving data for ${state.lastFetchShopId} to memory cache`);
                const currentData = {
                    products: state.products,
                    orders: state.orders,
                    metrics: state.metrics,
                    finance: state.finance,
                    lastFetchTime: state.lastFetchTime,
                    cacheMetadata: state.cacheMetadata,
                    plData: state.plData,
                    plDataKey: state.plDataKey,
                    loadedDateRange: state.loadedDateRange
                };
                set(s => ({ memoryCache: { ...s.memoryCache, [state.lastFetchShopId!]: currentData } }));
            }

            // Check if we have data for the new shop in memory cache
            if (state.memoryCache[shopId] && !forceRefresh) {
                console.log(`[Store] Cache hit for ${shopId}, loading from memory...`);
                const cached = state.memoryCache[shopId];

                // Tiered staleness check
                const cacheAge = cached.lastFetchTime ? Date.now() - cached.lastFetchTime : Infinity;
                const isFresh = cacheAge < 5 * 60 * 1000; // <5 min = very fresh
                const isModeratelyStale = cacheAge >= 5 * 60 * 1000 && cacheAge < 30 * 60 * 1000; // 5-30 min
                const isStale = cacheAge >= 30 * 60 * 1000; // >30 min

                set({
                    products: cached.products,
                    orders: cached.orders,
                    metrics: cached.metrics,
                    finance: cached.finance,
                    lastFetchTime: cached.lastFetchTime,
                    cacheMetadata: cached.cacheMetadata,
                    plData: cached.plData || null,
                    plDataKey: cached.plDataKey || '',
                    loadedDateRange: cached.loadedDateRange || { startDate: null, endDate: null },
                    lastFetchShopId: shopId,
                    isLoading: false,
                    error: null
                });

                if (isFresh) {
                    // Very fresh cache - skip all network requests
                    console.log(`[Store] Memory cache is very fresh (<5 min), skipping all network requests.`);
                    return;
                }

                if (isModeratelyStale) {
                    // Moderately stale - skip DB fetch, but check sync status in background
                    console.log(`[Store] Memory cache is moderately stale (5-30 min), skipping DB fetch.`);
                    return;
                }

                if (isStale && !skipSyncCheck) {
                    // Stale cache - trigger background auto-sync
                    console.log(`[Store] Memory cache is stale (>30 min), triggering background auto-sync.`);
                    setTimeout(() => {
                        get().smartAutoSync(accountId, shopId!);
                    }, 100);
                    return; // Don't fetch from DB, we already have memory cache data
                }

                return; // Default: use cached data
            } else {
                // No memory cache — show sync-style progress instead of blocking overlay
                console.log('[Store] No memory cache, loading from DB with progress indicator...');
                set({
                    products: [],
                    orders: [],
                    metrics: {
                        totalOrders: 0,
                        totalRevenue: 0,
                        totalProducts: 0,
                        totalNet: 0,
                        avgOrderValue: 0,
                        conversionRate: 0,
                        shopRating: 0
                    },
                    finance: { statements: [], payments: [], withdrawals: [], unsettledOrders: [], affiliateSettlements: [], agencyFees: [] },
                    plData: null,
                    plDataKey: '',
                    plLoading: false,
                    plError: null,
                    error: null,
                    lastFetchShopId: shopId,
                    isLoading: false, // NO blocking overlay
                    fetchInProgress: true, // Mark fetch as in progress
                    syncProgress: {
                        isActive: true,
                        isFirstSync: false,
                        currentStep: 'orders',
                        message: 'Loading data...',
                        ordersComplete: false,
                        productsComplete: false,
                        settlementsComplete: false,
                        ordersFetched: 0,
                        productsFetched: 0,
                        settlementsFetched: 0
                    },
                    cacheMetadata: {
                        ...state.cacheMetadata,
                        shopId,
                        accountId
                    },
                    loadedDateRange: { startDate: null, endDate: null }
                });
            }
        } else if (forceRefresh) {
            // Show progress bar for manual refresh too
            // Only reset loadedDateRange on genuine manual refresh (not post-sync refetch)
            // When skipSyncCheck is true, this is a post-sync refetch — preserve the cache
            set({
                isLoading: false,
                error: null,
                fetchInProgress: true, // Mark fetch as in progress
                ...(skipSyncCheck ? {} : { loadedDateRange: { startDate: null, endDate: null } }),
                syncProgress: {
                    isActive: true,
                    isFirstSync: false,
                    currentStep: 'orders',
                    message: 'Refreshing data...',
                    ordersComplete: false,
                    productsComplete: false,
                    settlementsComplete: false,
                    ordersFetched: 0,
                    productsFetched: 0,
                    settlementsFetched: 0
                }
            });
        }

        try {
            // ============================================================
            // OPTIMIZED: Single request loads everything
            // Previously: 4 separate requests (cache-status + orders + products + settlements)
            // Now: 1 request to /shop-data that returns all data + metrics + cache status
            // ============================================================

            let shouldSync = false;

            // Helper to map raw order from API to store Order type
            const mapRawOrder = (o: any): Order => ({
                order_id: o.id,
                order_status: o.status,
                order_amount: parseFloat(o.payment?.total_amount || '0'),
                currency: o.payment?.currency || 'USD',
                created_time: o.create_time,
                update_time: o.update_time,
                paid_time: o.paid_time, // Payment timestamp
                line_items: (o.line_items || []).map((item: any) => ({
                    id: item.id,
                    product_name: item.product_name,
                    sku_image: item.sku_image,
                    quantity: item.quantity || 1,
                    sale_price: item.sale_price,
                    original_price: item.original_price,
                    seller_sku: item.seller_sku,
                    sku_name: item.sku_name,
                    is_dangerous_good: item.is_dangerous_good || false,
                    is_gift: item.is_gift || false
                })),
                buyer_info: {
                    ...o.buyer_info,
                    buyer_user_id: o.buyer_user_id || o.buyer_uid // Map from root if necessary, or preserve if already in buyer_info
                },
                shipping_info: o.shipping_info,
                payment_info: o.payment_info || o.payment,
                payment_method_name: o.payment_method_name,
                shipping_type: o.shipping_type,
                delivery_option_id: o.delivery_option_id,
                delivery_option_name: o.delivery_option_name,
                fulfillment_type: o.fulfillment_type || 'FULFILLMENT_BY_SELLER',
                is_fbt: o.is_fbt || false,
                fbt_fulfillment_fee: o.fbt_fulfillment_fee ?? null,
                warehouse_id: o.warehouse_id || null,
                return_status: o.return_status,
                substatus: o.substatus,
                refund_amount: parseFloat(o.refund_amount || '0'),
                return_reason: o.return_reason,
                cancel_reason: o.cancel_reason,
                cancellation_initiator: o.cancellation_initiator,
                is_sample_order: o.is_sample_order,

                // Map new fields
                collection_time: o.collection_time,
                is_cod: o.is_cod || false,
                is_exchange_order: o.is_exchange_order || false,
                is_on_hold_order: o.is_on_hold_order || false,
                is_replacement_order: o.is_replacement_order || false,
                delivery_type: o.delivery_type,
                seller_note: o.seller_note,
                shipping_due_time: o.shipping_due_time,
                shipping_provider_id: o.shipping_provider_id,
                shipping_provider: o.shipping_provider,
                tracking_number: o.tracking_number
            });

            // Compute default 30-day range if not provided, so ALL requests (initial + batch) use the same filter
            let effectiveStartDate = startDate;
            let effectiveEndDate = endDate;
            if (!effectiveStartDate || !effectiveEndDate) {
                // CRITICAL: Use shop timezone, not browser local time
                // Browser might be in CET (UTC+1) but shop is in America/Los_Angeles (UTC-8)
                // This ensures we load today's data in the shop's timezone
                const shopTimezone = 'America/Los_Angeles'; // TODO: Get from shop settings

                // Get current date in shop timezone
                const now = new Date();
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: shopTimezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                });

                const parts = formatter.formatToParts(now);
                const year = parts.find(p => p.type === 'year')!.value;
                const month = parts.find(p => p.type === 'month')!.value;
                const day = parts.find(p => p.type === 'day')!.value;
                effectiveEndDate = `${year}-${month}-${day}`;

                // Calculate days to load based on user preference (or fallback)
                // initialLoadDays comes from the user's "Default Load Days" preference in the Customize panel
                const userSelectedDays = initialLoadDays || DEFAULT_LOAD_DAYS;
                const defaultDays = getInitialLoadDaysWithBuffer(userSelectedDays);
                const pastDate = new Date(now.getTime() - (defaultDays * 86400 * 1000));
                const partsPast = formatter.formatToParts(pastDate);
                const yearPast = partsPast.find(p => p.type === 'year')!.value;
                const monthPast = partsPast.find(p => p.type === 'month')!.value;
                const dayPast = partsPast.find(p => p.type === 'day')!.value;
                effectiveStartDate = `${yearPast}-${monthPast}-${dayPast}`;

                console.log(`[Store] Using default ${defaultDays}-day range (${shopTimezone}): ${effectiveStartDate} to ${effectiveEndDate}`);
            }

            // EXPAND RANGE FOR TRENDS if requested
            if (includePreviousPeriod && effectiveStartDate && effectiveEndDate) {
                const startD = new Date(effectiveStartDate);
                const endD = new Date(effectiveEndDate);
                const diffTime = Math.abs(endD.getTime() - startD.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // Inclusive days

                // Previous period start = Start Date - diffDays
                const expandedStartD = new Date(startD);
                expandedStartD.setDate(expandedStartD.getDate() - diffDays);

                // Format as YYYY-MM-DD
                // We use the same formatter approach or simple ISO since we calculated Date object
                const y = expandedStartD.getFullYear();
                const m = String(expandedStartD.getMonth() + 1).padStart(2, '0');
                const d = String(expandedStartD.getDate()).padStart(2, '0');
                const expandedStart = `${y}-${m}-${d}`;

                console.log(`[Store] Expanding date range for trends: ${expandedStart} to ${effectiveEndDate} (adding ${diffDays} days)`);
                effectiveStartDate = expandedStart;
            }

            // ============================================================
            // SMART DATE RANGE CACHE: Check if requested range is already loaded
            // If the data pool already covers the requested range, skip the API call
            // and just update currentDateRange — the UI filters client-side via useMemo
            // ============================================================
            const loaded = get().loadedDateRange;
            if (!forceRefresh && showCached && shopId && shopId === state.lastFetchShopId &&
                loaded.startDate && loaded.endDate &&
                effectiveStartDate && effectiveEndDate &&
                effectiveStartDate >= loaded.startDate &&
                effectiveEndDate <= loaded.endDate) {
                console.log(`[Store] ✅ Date range cache HIT: requested ${effectiveStartDate}..${effectiveEndDate} is within loaded ${loaded.startDate}..${loaded.endDate}. Skipping fetch.`);
                set({
                    currentDateRange: {
                        startDate: startDate || effectiveStartDate,
                        endDate: endDate || effectiveEndDate
                    },
                    fetchInProgress: false
                });
                return;
            }

            // Determine if we can do a partial/gap fetch (only fetch missing date ranges)
            let gapStartDate: string | undefined;
            let gapEndDate: string | undefined;
            let isGapFetch = false;

            if (!forceRefresh && showCached && shopId && shopId === state.lastFetchShopId &&
                loaded.startDate && loaded.endDate &&
                effectiveStartDate && effectiveEndDate) {
                // Case 1: Need earlier data (requested start is before loaded start)
                if (effectiveStartDate < loaded.startDate && effectiveEndDate >= loaded.startDate) {
                    gapStartDate = effectiveStartDate;
                    // Fetch up to the day before our loaded start to avoid overlap
                    const gapEnd = new Date(loaded.startDate);
                    gapEnd.setDate(gapEnd.getDate() - 1);
                    const gy = gapEnd.getFullYear();
                    const gm = String(gapEnd.getMonth() + 1).padStart(2, '0');
                    const gd = String(gapEnd.getDate()).padStart(2, '0');
                    gapEndDate = `${gy}-${gm}-${gd}`;
                    isGapFetch = true;
                    console.log(`[Store] 🔄 Date range cache PARTIAL HIT: need earlier data ${gapStartDate}..${gapEndDate}`);
                }
                // Case 2: Need later data (requested end is after loaded end)
                else if (effectiveEndDate > loaded.endDate && effectiveStartDate <= loaded.endDate) {
                    // Fetch from the day after our loaded end to avoid overlap
                    const gapStart = new Date(loaded.endDate);
                    gapStart.setDate(gapStart.getDate() + 1);
                    const gy = gapStart.getFullYear();
                    const gm = String(gapStart.getMonth() + 1).padStart(2, '0');
                    const gd = String(gapStart.getDate()).padStart(2, '0');
                    gapStartDate = `${gy}-${gm}-${gd}`;
                    gapEndDate = effectiveEndDate;
                    isGapFetch = true;
                    console.log(`[Store] 🔄 Date range cache PARTIAL HIT: need later data ${gapStartDate}..${gapEndDate}`);
                }
                // Case 3: Completely outside loaded range — full fetch
                else {
                    console.log(`[Store] ❌ Date range cache MISS: requested ${effectiveStartDate}..${effectiveEndDate} outside loaded ${loaded.startDate}..${loaded.endDate}`);
                }
            }

            if (showCached && shopId) {
                console.log('[Store] Loading shop data (optimized single request)...');

                // Set loading state for date range fetch.
                // CRITICAL: Set fetchInProgress: true HERE (before the first await) so any
                // concurrent call that slipped past the guard at line ~424 is blocked when
                // it re-checks on its own synchronous path. Because JS is single-threaded,
                // setting this synchronously before the first await guarantees the second
                // caller sees it set when it reaches the guard check.
                set(s => {
                    // Show user-facing days count (their actual selection, not the internal buffered range).
                    // If startDate/endDate were provided (user picked a range), compute from those.
                    // Otherwise use the user's default load days preference.
                    const userDays = startDate && endDate
                        ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1
                        : (initialLoadDays || DEFAULT_LOAD_DAYS);
                    return {
                        isFetchingDateRange: true,
                        fetchInProgress: true,
                        dataLoadIncomplete: false,
                        fetchDateRange: { startDate: effectiveStartDate, endDate: effectiveEndDate },
                        syncProgress: {
                            ...s.syncProgress,
                            isActive: true,
                            message: `Loading ${userDays} days of data...`
                        }
                    };
                });

                // Determine the actual fetch range (gap or full)
                const fetchStartDate = isGapFetch ? gapStartDate! : effectiveStartDate;
                const fetchEndDate = isGapFetch ? gapEndDate! : effectiveEndDate;

                // STEP 1: Load initial batch (products + settlements + first 1000 orders)
                // Use fetchStartDate/fetchEndDate for the API call (may be a gap fetch)
                let shopDataUrl = `${API_BASE_URL}/api/tiktok-shop/shop-data/${accountId}?shopId=${shopId}`;
                shopDataUrl += `&startDate=${fetchStartDate}&endDate=${fetchEndDate}`;
                console.log(`[Store] Fetching shop data: ${fetchStartDate} to ${fetchEndDate}${isGapFetch ? ' (GAP FETCH)' : ''}`);
                const result = await fetch(shopDataUrl).then(r => r.json());

                if (!result.success) {
                    throw new Error(result.error || 'Failed to load shop data');
                }

                const { orders: rawOrders, products: rawProducts, settlements: rawSettlements, metrics: serverMetrics, cache_status: cacheStatus, hasMoreOrders, totalOrders: totalOrderCount, nextCursor: serverNextCursor } = result.data;

                shouldSync = (cacheStatus?.should_prompt_user || forceRefresh) && !skipSyncCheck;

                const products: Product[] = (rawProducts || []).map((p: any) => ({
                    product_id: p.product_id,
                    name: p.product_name,
                    status: p.status,
                    price: p.price,
                    currency: p.currency,
                    stock_quantity: p.stock,
                    sales_count: p.sales_count || 0,
                    main_image_url: p.main_image_url || p.images?.[0] || '',
                    images: p.images || [],
                    gmv: p.gmv || 0,
                    orders_count: p.orders_count || 0,
                    click_through_rate: p.click_through_rate || 0,
                    cogs: p.cogs ?? null,
                    shipping_cost: p.shipping_cost ?? null,
                    is_fbt: p.is_fbt || false,
                    fbt_source: p.fbt_source || 'auto',
                    details: p.details,
                    skus: p.details?.skus || []
                }));

                let orders: Order[] = (rawOrders || []).map(mapRawOrder);

                let statements: Statement[] = (rawSettlements || []).map((s: any) => ({
                    ...s,
                    fee_amount: s.fee_amount?.toString() || '0',
                    adjustment_amount: s.adjustment_amount?.toString() || '0',
                    shipping_fee: s.shipping_fee?.toString() || '0',
                    net_sales_amount: s.net_sales_amount?.toString() || '0',
                    order_id: s.order_id
                }));

                // On-demand historical sync: if gap-fetch returned 0 orders for a range
                // older than the default sync window, fetch from TikTok API first
                if (isGapFetch && orders.length === 0 && fetchStartDate && fetchEndDate) {
                    const defaultSyncCutoff = new Date();
                    defaultSyncCutoff.setDate(defaultSyncCutoff.getDate() - DEFAULT_SYNC_DAYS);
                    const cutoffStr = defaultSyncCutoff.toISOString().split('T')[0];

                    if (fetchStartDate < cutoffStr) {
                        console.log(`[Store] Gap fetch returned 0 orders for ${fetchStartDate}..${fetchEndDate} (beyond ${DEFAULT_SYNC_DAYS}-day window). Triggering on-demand TikTok sync...`);

                        // Show syncing indicator
                        set(s => ({
                            syncProgress: {
                                ...s.syncProgress,
                                isActive: true,
                                currentStep: 'orders',
                                message: `Fetching historical data (${fetchStartDate} to ${fetchEndDate})...`,
                                ordersComplete: false
                            }
                        }));

                        try {
                            // Sync from TikTok for this specific date range
                            const syncResp = await fetch(`${API_BASE_URL}/api/tiktok-shop/sync/${accountId}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ shopId, syncType: 'orders', startDate: fetchStartDate, endDate: fetchEndDate })
                            });
                            const syncResult = await syncResp.json();
                            const fetched = syncResult.stats?.orders?.fetched || 0;
                            console.log(`[Store] Historical sync complete: ${fetched} orders fetched from TikTok`);

                            // Re-read from Supabase now that data is there
                            if (fetched > 0) {
                                const retryResult = await fetch(shopDataUrl).then(r => r.json());
                                if (retryResult.success) {
                                    orders = (retryResult.data.orders || []).map(mapRawOrder);
                                    statements = (retryResult.data.settlements || []).map((s: any) => ({
                                        ...s,
                                        fee_amount: s.fee_amount?.toString() || '0',
                                        adjustment_amount: s.adjustment_amount?.toString() || '0',
                                        shipping_fee: s.shipping_fee?.toString() || '0',
                                        net_sales_amount: s.net_sales_amount?.toString() || '0',
                                        order_id: s.order_id
                                    }));
                                    console.log(`[Store] Re-fetched ${orders.length} orders from Supabase after historical sync`);
                                }
                            }
                        } catch (syncError: any) {
                            console.error('[Store] Historical sync failed:', syncError.message);
                        } finally {
                            // Dismiss sync progress
                            set(s => ({
                                syncProgress: { ...s.syncProgress, isActive: false, message: '' }
                            }));
                        }
                    }
                }

                // For gap fetches, merge new data with existing; for full fetches, replace
                let mergedProducts: Product[];
                let mergedOrders: Order[];
                let mergedStatements: Statement[];

                if (isGapFetch) {
                    // MERGE: Combine new data with existing data (deduplicate by ID)
                    const existingOrders = get().orders;
                    const existingOrderIds = new Set(existingOrders.map(o => o.order_id));
                    const newUniqueOrders = orders.filter(o => !existingOrderIds.has(o.order_id));
                    mergedOrders = [...existingOrders, ...newUniqueOrders];

                    const existingStatements = get().finance.statements;
                    const existingStatementIds = new Set(existingStatements.map(s => s.id || `${s.order_id}-${s.statement_time}`));
                    const newUniqueStatements = statements.filter(s => !existingStatementIds.has(s.id || `${s.order_id}-${s.statement_time}`));
                    mergedStatements = [...existingStatements, ...newUniqueStatements];

                    // Products: merge by product_id (newer data wins)
                    const existingProducts = get().products;
                    const productMap = new Map(existingProducts.map(p => [p.product_id, p]));
                    products.forEach(p => productMap.set(p.product_id, p));
                    mergedProducts = Array.from(productMap.values());

                    console.log(`[Store] Gap fetch merge: +${newUniqueOrders.length} orders, +${newUniqueStatements.length} statements, ${mergedProducts.length} products total`);
                } else {
                    mergedProducts = products;
                    mergedOrders = orders;
                    mergedStatements = statements;
                }

                const metrics: ShopMetrics = {
                    totalOrders: isGapFetch ? mergedOrders.length : (serverMetrics?.totalOrders || orders.length),
                    totalRevenue: isGapFetch
                        ? mergedOrders.reduce((sum: number, o: Order) => sum + calculateOrderGMV(o), 0)
                        : (serverMetrics?.totalRevenue || orders.reduce((sum: number, o: Order) => sum + calculateOrderGMV(o), 0)),
                    totalProducts: serverMetrics?.totalProducts || mergedProducts.length,
                    totalNet: isGapFetch
                        ? mergedStatements.reduce((sum: number, s: Statement) => sum + parseFloat(s.settlement_amount || '0'), 0)
                        : (serverMetrics?.totalNet || statements.reduce((sum: number, s: Statement) => sum + parseFloat(s.settlement_amount || '0'), 0)),
                    avgOrderValue: serverMetrics?.avgOrderValue || 0,
                    conversionRate: state.metrics.conversionRate || 0,
                    shopRating: state.metrics.shopRating || 0
                };

                // Compute the new loaded date range (union of old and new)
                const prevLoaded = get().loadedDateRange;
                const newLoadedStart = prevLoaded.startDate && prevLoaded.startDate < (effectiveStartDate || '')
                    ? prevLoaded.startDate
                    : (effectiveStartDate || null);
                const newLoadedEnd = prevLoaded.endDate && prevLoaded.endDate > (effectiveEndDate || '')
                    ? prevLoaded.endDate
                    : (effectiveEndDate || null);

                // Show dashboard immediately with first batch
                set({
                    products: mergedProducts.length > 0 ? mergedProducts : get().products,
                    orders: mergedOrders.length > 0 ? mergedOrders : get().orders,
                    metrics,
                    finance: {
                        statements: mergedStatements,
                        payments: isGapFetch ? get().finance.payments : [],
                        withdrawals: isGapFetch ? get().finance.withdrawals : [],
                        unsettledOrders: isGapFetch ? get().finance.unsettledOrders : [],
                        affiliateSettlements: get().finance.affiliateSettlements || [],
                        agencyFees: get().finance.agencyFees || []
                    },
                    isLoading: false,
                    isFetchingDateRange: false,
                    error: null,
                    lastFetchTime: Date.now(),
                    lastFetchShopId: shopId,
                    syncProgress: {
                        ...get().syncProgress,
                        productsComplete: true,
                        productsFetched: mergedProducts.length,
                        settlementsComplete: true,
                        settlementsFetched: mergedStatements.length,
                        ordersComplete: !hasMoreOrders,
                        ordersFetched: mergedOrders.length,
                        currentStep: hasMoreOrders ? 'orders' : 'complete',
                        message: hasMoreOrders
                            ? (totalOrderCount ? `Loading data: ${mergedOrders.length}/${totalOrderCount}...` : `Loading data: ${mergedOrders.length}...`)
                            : `Loaded ${mergedOrders.length} orders`,
                        isActive: hasMoreOrders
                    },
                    cacheMetadata: {
                        shopId,
                        accountId,
                        ordersLastSynced: cacheStatus?.last_synced_times?.orders || null,
                        productsLastSynced: cacheStatus?.last_synced_times?.products || null,
                        settlementsLastSynced: cacheStatus?.last_synced_times?.settlements || null,
                        isSyncing: get().cacheMetadata.isSyncing,
                        showRefreshPrompt: false,
                        isStale: shouldSync,
                        isFirstSync: get().cacheMetadata.isFirstSync,
                        lastSyncStats: get().cacheMetadata.lastSyncStats,
                        lastPromptDismissedAt: get().cacheMetadata.lastPromptDismissedAt
                    },
                    // Store the USER's selected range (not the expanded effective range)
                    // This ensures the duplicate-call check at line 432 works correctly
                    currentDateRange: {
                        startDate: startDate || effectiveStartDate || null,
                        endDate: endDate || effectiveEndDate || null
                    },
                    loadedDateRange: {
                        startDate: newLoadedStart,
                        endDate: newLoadedEnd
                    },
                    dataVersion: get().dataVersion + 1 // Increment to force UI re-render

                });

                console.log(`[Store] Initial load complete (${result.timing?.total_ms || '?'}ms). Orders: ${orders.length}/${totalOrderCount}, Products: ${products.length}`);

                // STEP 2: If there are more orders, progressively load them in background batches
                if (hasMoreOrders && totalOrderCount > orders.length) {
                    const BATCH_SIZE = 1000;
                    const MAX_BATCH_RETRIES = 3;   // Increased to 3 attempts max (60s each)
                    let hasMore = true;
                    // Initialize local accumulator with ALL orders (merged if gap-fetch, raw if full-fetch).
                    // CRITICAL: For gap-fetches, we must start from mergedOrders to preserve existing
                    // cached data (e.g. recent 14 days). Using raw `orders` would overwrite them.
                    let accumulatedOrders = [...mergedOrders];

                    // CURSOR-BASED PAGINATION: Track the paid_time|order_id of the last order
                    // instead of using offset (which times out at high values like 21000+)
                    // Get the initial cursor from the server's shop-data response
                    let nextCursor: string | null = serverNextCursor || null;
                    if (!nextCursor && orders.length > 0) {
                        // Fallback just in case
                        const lastOrder = orders[orders.length - 1];
                        if ((lastOrder as any).paid_time_iso) {
                            nextCursor = `${(lastOrder as any).paid_time_iso}|${lastOrder.order_id}`;
                        } else if (lastOrder.paid_time) {
                            nextCursor = `${new Date(lastOrder.paid_time * 1000).toISOString()}|${lastOrder.order_id}`;
                        }
                    }

                    console.log(`[Store] Progressive loading: ${totalOrderCount - accumulatedOrders.length} more orders to load (cursor: ${nextCursor})...`);

                    while (hasMore) {
                        // Safety break: prevent truly runaway loops (e.g. if API always returns hasMore=true).
                        // We use a hardcoded high-water mark instead of totalOrderCount which may be a sentinel.
                        const RUNAWAY_LIMIT = Math.max(totalOrderCount * 2, 100000);
                        if (accumulatedOrders.length > RUNAWAY_LIMIT) {
                            console.warn(`[Store] Aborting fetch: Loaded ${accumulatedOrders.length} orders which exceeds safety limit of ${RUNAWAY_LIMIT}.`);
                            break;
                        }

                        // Use cursor-based pagination instead of offset
                        let batchUrl = `${API_BASE_URL}/api/tiktok-shop/orders/synced/${accountId}/batch?shopId=${shopId}&limit=${BATCH_SIZE}&startDate=${fetchStartDate}&endDate=${fetchEndDate}`;
                        if (nextCursor) {
                            batchUrl += `&cursor=${encodeURIComponent(nextCursor)}`;
                        }
                        console.log(`[Store] Fetching batch: cursor=${nextCursor}, limit=${BATCH_SIZE}`);

                        // Retry loop with timeout per attempt
                        let batchResult: any = null;
                        let lastError: any = null;
                        for (let attempt = 0; attempt < MAX_BATCH_RETRIES; attempt++) {
                            if (attempt > 0) {
                                const delay = 2000;
                                console.log(`[Store] Retrying batch after ${delay}ms...`);
                                await new Promise(r => setTimeout(r, delay));
                            }
                            try {
                                const response = await fetchWithTimeout(batchUrl, 60000); // 60s per attempt
                                batchResult = await response.json();
                                lastError = null;
                                break; // success
                            } catch (err) {
                                lastError = err;
                                console.error(`[Store] Batch attempt ${attempt + 1} failed:`, err);
                            }
                        }

                        if (lastError || !batchResult || !batchResult.success) {
                            console.error('[Store] Batch load failed after retries, stopping.');
                            break; // exit loop — incomplete check below will catch this
                        }

                        if (!batchResult.data?.orders?.length) {
                            console.log(`[Store] No more orders in batch response`);
                            hasMore = false;
                            break;
                        }

                        const newOrders: Order[] = batchResult.data.orders.map(mapRawOrder);

                        // Push new orders tightly into local accumulator
                        accumulatedOrders = [...accumulatedOrders, ...newOrders];
                        hasMore = batchResult.data.hasMore;

                        // Update cursor for next batch from server response
                        nextCursor = batchResult.data.nextCursor || null;

                        console.log(`[Store] Batch loaded: ${newOrders.length} orders, hasMore=${hasMore}, total so far=${accumulatedOrders.length}/${totalOrderCount}, nextCursor=${nextCursor}`);

                        // Recompute revenue with all orders loaded so far locally
                        const updatedRevenue = accumulatedOrders.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
                        const updatedAvg = accumulatedOrders.length > 0 ? updatedRevenue / accumulatedOrders.length : 0;

                        // Functional set to ensure we don't accidentally wipe out other changes
                        set(s => ({
                            orders: accumulatedOrders,
                            metrics: {
                                ...s.metrics,
                                totalOrders: totalOrderCount,
                                totalRevenue: updatedRevenue,
                                avgOrderValue: updatedAvg
                            },
                            syncProgress: {
                                ...s.syncProgress,
                                ordersFetched: accumulatedOrders.length,
                                message: hasMore
                                    ? (totalOrderCount ? `Loading data: ${accumulatedOrders.length}/${totalOrderCount}...` : `Loading data: ${accumulatedOrders.length}...`)
                                    : `Loaded all ${accumulatedOrders.length} orders`,
                                currentStep: hasMore ? 'orders' : 'complete',
                                ordersComplete: !hasMore,
                                isActive: hasMore
                            }
                        }));

                        console.log(`[Store] Progressive load: ${accumulatedOrders.length}/${totalOrderCount} orders`);
                    }

                    // After the loop, check if we loaded fewer orders than the server reported.
                    // This covers BOTH network failures AND silent empty responses (e.g. Supabase range returning 0).
                    const finalLoaded = get().orders.length;
                    if (finalLoaded < totalOrderCount) {
                        console.warn(`[Store] Incomplete load: ${finalLoaded}/${totalOrderCount} orders. Flagging for user.`);
                        set(s => ({
                            dataLoadIncomplete: true,
                            syncProgress: {
                                ...s.syncProgress,
                                isActive: false,  // stop the spinner regardless of auto-sync
                                ordersComplete: false,
                                currentStep: 'complete',
                                message: `Loaded ${finalLoaded} of ${totalOrderCount} orders`
                            }
                        }));
                    } else {
                        // All orders loaded — dismiss progress bar
                        setTimeout(() => {
                            set(s => ({
                                syncProgress: { ...s.syncProgress, isActive: false, message: '' }
                            }));
                        }, 2000);
                    }
                } else {
                    // All data loaded in first batch — dismiss progress bar
                    setTimeout(() => {
                        set(s => ({
                            syncProgress: { ...s.syncProgress, isActive: false, message: '' }
                        }));
                    }, 1500);
                }
            }

            // Trigger background auto-sync if stale
            if (shouldSync && shopId && !skipSyncCheck && !get().cacheMetadata.isSyncing) {
                const hasData = get().products.length > 0 || get().orders.length > 0;

                if (!hasData) {
                    console.log('[Store] First time sync (no data) - auto triggering...');
                    await get().syncData(accountId, shopId, 'all');
                } else {
                    console.log('[Store] Data stale - triggering smart auto-sync in background...');
                    setTimeout(() => {
                        get().smartAutoSync(accountId, shopId!);
                    }, 100);
                }
            }

        } catch (error: any) {
            console.error('[Store] Fatal error fetching shop data:', error);
            set({
                error: error.message,
                isLoading: false,
                isFetchingDateRange: false,
                fetchInProgress: false,
                syncProgress: { ...get().syncProgress, isActive: false, message: '' }
            });
        } finally {
            // Always clear fetchInProgress flag
            set({ fetchInProgress: false });
        }
    },

    clearData: () => set({
        products: [],
        orders: [],
        metrics: {
            totalOrders: 0,
            totalRevenue: 0,
            totalProducts: 0,
            totalNet: 0,
            avgOrderValue: 0,
            conversionRate: 0,
            shopRating: 0
        },
        finance: { statements: [], payments: [], withdrawals: [], unsettledOrders: [], affiliateSettlements: [], agencyFees: [] },
        error: null,
        lastFetchTime: null,
        lastFetchShopId: null,
        loadedDateRange: { startDate: null, endDate: null }
    }),

    syncData: async (accountId: string, shopId: string, syncType: string = 'all') => {
        // Preempt any running auto-sync — manual sync takes priority
        if (get().autoSyncInProgress.length > 0) {
            console.log('[Sync] Manual sync triggered, preempting auto-sync');
            set({ autoSyncInProgress: [] });
        }

        // Don't set isLoading to true for background syncs if we already have data
        const hasData = get().products.length > 0 || get().orders.length > 0;
        const isFirstSync = !hasData;

        // Determine what to sync
        const syncOrders = syncType === 'all' || syncType === 'orders';
        const syncProducts = syncType === 'all' || syncType === 'products';
        const syncSettlements = syncType === 'all' || syncType === 'finance' || syncType === 'settlements';

        // Initialize sync progress
        set({
            isLoading: false,
            error: null,
            cacheMetadata: { ...get().cacheMetadata, isSyncing: true },
            syncProgress: {
                isActive: true,
                isFirstSync,
                currentStep: 'orders',
                message: isFirstSync ? 'First sync — fetching all data...' : 'Syncing...',
                ordersComplete: !syncOrders,
                productsComplete: !syncProducts,
                settlementsComplete: !syncSettlements,
                ordersFetched: 0,
                productsFetched: 0,
                settlementsFetched: 0
            }
        });

        try {
            let ordersData: any = { stats: { orders: { fetched: 0 } } };
            let productsData: any = { stats: { products: { fetched: 0 } } };
            let settlementsData: any = { stats: { settlements: { fetched: 0 } } };

            // Create AbortController for this sync session
            if (get().syncAbortController) {
                get().syncAbortController?.abort();
            }
            const controller = new AbortController();
            set({ syncAbortController: controller });
            const signal = controller.signal;

            // --- Parallel Sync: Orders + Products + Settlements fire simultaneously ---
            console.log('[Sync] Starting parallel sync...');

            const syncFetch = (type: string) =>
                fetch(`${API_BASE_URL}/api/tiktok-shop/sync/${accountId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shopId, syncType: type }),
                    signal
                }).then(r => r.json());

            // Fire all enabled fetches in parallel; each .then() merges + updates progress immediately
            const ordersFetch = syncOrders
                ? syncFetch('orders').then((data: any) => {
                    const fetched = data.stats?.orders?.fetched || 0;
                    const syncedOrders = data.stats?.orders?.syncedOrders || [];
                    console.log(`[Sync] Orders done (${fetched} fetched)`);
                    if (syncedOrders.length > 0) get().mergeSyncedOrdersIntoStore(syncedOrders, shopId);
                    set(s => ({ syncProgress: { ...s.syncProgress, ordersComplete: true, ordersFetched: fetched } }));
                    ordersData = data;
                }).catch((e: any) => { if (e.name === 'AbortError') throw e; console.error('[Sync] Orders failed:', e.message); })
                : Promise.resolve();

            const productsFetch = syncProducts
                ? syncFetch('products').then((data: any) => {
                    const fetched = data.stats?.products?.fetched || 0;
                    const syncedProducts = data.stats?.products?.syncedProducts || [];
                    console.log(`[Sync] Products done (${fetched} fetched)`);
                    if (syncedProducts.length > 0) get().mergeSyncedProductsIntoStore(syncedProducts, shopId);
                    set(s => ({ syncProgress: { ...s.syncProgress, productsComplete: true, productsFetched: fetched } }));
                    productsData = data;
                }).catch((e: any) => { if (e.name === 'AbortError') throw e; console.error('[Sync] Products failed:', e.message); })
                : Promise.resolve();

            const settlementsFetch = syncSettlements
                ? syncFetch('settlements').then((data: any) => {
                    const fetched = data.stats?.settlements?.fetched || 0;
                    const syncedSettlements = data.stats?.settlements?.syncedSettlements || [];
                    console.log(`[Sync] Settlements done (${fetched} fetched)`);
                    if (syncedSettlements.length > 0) get().mergeSyncedSettlementsIntoStore(syncedSettlements, shopId);
                    set(s => ({ syncProgress: { ...s.syncProgress, settlementsComplete: true, settlementsFetched: fetched } }));
                    settlementsData = data;
                }).catch((e: any) => { if (e.name === 'AbortError') throw e; console.error('[Sync] Settlements failed:', e.message); })
                : Promise.resolve();

            // Wait for all 3 to complete
            await Promise.all([ordersFetch, productsFetch, settlementsFetch]);

            if (!get().syncProgress.isActive) return; // Stop if cancelled

            // --- All steps complete ---
            const currentShopId = shopId;

            // Clear P&L cache if finance was synced
            if (syncSettlements) {
                set({ plDataKey: '' });
            }

            // Show sync complete message and update cache metadata
            set(s => {
                const newMemoryCache = { ...s.memoryCache };
                newMemoryCache[currentShopId] = {
                    products: s.products,
                    orders: s.orders,
                    metrics: s.metrics,
                    finance: s.finance,
                    lastFetchTime: s.lastFetchTime,
                    cacheMetadata: s.cacheMetadata,
                    plData: s.plData,
                    plDataKey: s.plDataKey,
                    loadedDateRange: s.loadedDateRange
                };

                return {
                    syncProgress: {
                        ...s.syncProgress,
                        currentStep: 'complete',
                        message: 'Sync complete!'
                    },
                    cacheMetadata: {
                        ...s.cacheMetadata,
                        isFirstSync: ordersData.isFirstSync,
                        showRefreshPrompt: false,
                        isStale: false,
                        lastSyncStats: {
                            orders: ordersData.stats?.orders,
                            products: productsData.stats?.products,
                            settlements: settlementsData.stats?.settlements
                        },
                        lastPromptDismissedAt: Date.now()
                    },
                    lastFetchTime: Date.now(),
                    memoryCache: newMemoryCache,
                    isLoading: false
                };
            });

            // Brief pause to show "Sync complete!" message, then dismiss
            await new Promise(resolve => setTimeout(resolve, 1000));

            set(s => ({
                syncProgress: {
                    ...s.syncProgress,
                    isActive: false,
                    message: ''
                }
            }));

        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log('[Sync] Request cancelled via AbortController');
                return;
            }
            console.error('Sync error:', error);
            set({
                error: error.message,
                isLoading: false,
                syncProgress: {
                    ...get().syncProgress,
                    isActive: false,
                    message: `Sync failed: ${error.message}`
                }
            });
            throw error;
        } finally {
            set(s => ({
                cacheMetadata: { ...s.cacheMetadata, isSyncing: false },
                syncAbortController: null
            }));
        }
    },

    cancelSync: () => {
        // Abort the ongoing request
        const controller = get().syncAbortController;
        if (controller) {
            console.log('[Store] Cancelling sync via AbortController...');
            controller.abort();
        }

        set({
            syncProgress: {
                isActive: false,
                isFirstSync: false,
                currentStep: 'idle',
                message: '⏹️ Sync cancelled',
                ordersComplete: false,
                productsComplete: false,
                settlementsComplete: false,
                ordersFetched: 0,
                productsFetched: 0,
                settlementsFetched: 0
            },
            cacheMetadata: {
                ...get().cacheMetadata,
                isSyncing: false
            },
            syncAbortController: null
        });
        // Show cancelled message briefly
        setTimeout(() => {
            set(s => ({
                syncProgress: { ...s.syncProgress, isActive: false, message: '' }
            }));
        }, 1500);
    },

    dismissRefreshPrompt: () => {
        set({
            cacheMetadata: {
                ...get().cacheMetadata,
                showRefreshPrompt: false,
                lastPromptDismissedAt: Date.now()
            }
        });
    },

    smartAutoSync: async (accountId: string, shopId: string) => {
        const AUTO_SYNC_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

        // Guard: don't auto-sync if manual sync or another auto-sync is running
        if (get().cacheMetadata.isSyncing) {
            console.log('[AutoSync] Manual sync in progress, skipping');
            return;
        }
        if (get().autoSyncInProgress.length > 0) {
            console.log('[AutoSync] Already running, skipping');
            return;
        }

        try {
            // Step 1: Check per-type staleness from backend
            if (get().syncAbortController) {
                get().syncAbortController?.abort();
            }
            const controller = new AbortController();
            set({ syncAbortController: controller });
            const signal = controller.signal;

            const cacheStatusUrl = `${API_BASE_URL}/api/tiktok-shop/cache-status/${accountId}?shopId=${shopId}`;
            const cacheResponse = await fetch(cacheStatusUrl, { signal });
            const cacheResult = await cacheResponse.json();

            if (!cacheResult.success) {
                console.log('[AutoSync] Failed to check cache status');
                return;
            }

            const status = cacheResult.data;
            const now = Date.now();

            const isStale = (lastSyncedAt: string | null): boolean => {
                if (!lastSyncedAt) return true;
                return (now - new Date(lastSyncedAt).getTime()) > AUTO_SYNC_THRESHOLD_MS;
            };

            const staleTypes: string[] = [];
            if (isStale(status.last_synced_times.orders)) staleTypes.push('orders');
            if (isStale(status.last_synced_times.products)) staleTypes.push('products');
            if (isStale(status.last_synced_times.settlements)) staleTypes.push('settlements');

            if (staleTypes.length === 0) {
                console.log('[AutoSync] All data fresh (<15 min), no sync needed');
                return;
            }

            console.log('[AutoSync] Stale types:', staleTypes.join(', '));

            // If no data at all, delegate to full first-time sync
            const hasData = get().products.length > 0 || get().orders.length > 0;
            if (!hasData) {
                console.log('[AutoSync] No data, triggering full first-time sync');
                await get().syncData(accountId, shopId, 'all');
                return;
            }

            // Step 2: Start background auto-sync
            const syncOrders = staleTypes.includes('orders');
            const syncProducts = staleTypes.includes('products');
            const syncSettlements = staleTypes.includes('settlements');

            // Step 2: Start SILENT background auto-sync
            // No progress bar — only cacheMetadata.isSyncing for the subtle button indicator
            set({
                autoSyncInProgress: [...staleTypes],
                cacheMetadata: { ...get().cacheMetadata, isSyncing: true },
            });

            // Step 3: Sync each stale type sequentially and merge silently
            if (syncOrders && get().autoSyncInProgress.length > 0) {
                try {
                    const resp = await fetch(`${API_BASE_URL}/api/tiktok-shop/sync/${accountId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ shopId, syncType: 'orders' }),
                        signal
                    });
                    const data = await resp.json();
                    const fetched = data.stats?.orders?.fetched || 0;
                    const syncedOrders = data.stats?.orders?.syncedOrders || [];
                    console.log(`[AutoSync] Orders synced (${fetched} fetched, ${syncedOrders.length} returned for merge)`);

                    if (syncedOrders.length > 0) {
                        get().mergeSyncedOrdersIntoStore(syncedOrders, shopId);
                    }
                    if (fetched > 0) {
                        set({ newOrdersNotification: { count: fetched } });
                    }
                } catch (e: any) {
                    console.error('[AutoSync] Orders failed:', e.message);
                }
            }

            if (syncProducts && get().autoSyncInProgress.length > 0) {
                try {
                    const resp = await fetch(`${API_BASE_URL}/api/tiktok-shop/sync/${accountId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ shopId, syncType: 'products' }),
                        signal
                    });
                    const data = await resp.json();
                    const syncedProducts = data.stats?.products?.syncedProducts || [];
                    console.log(`[AutoSync] Products synced (${data.stats?.products?.fetched || 0} fetched, ${syncedProducts.length} returned for merge)`);

                    if (syncedProducts.length > 0) {
                        get().mergeSyncedProductsIntoStore(syncedProducts, shopId);
                    }
                } catch (e: any) {
                    console.error('[AutoSync] Products failed:', e.message);
                }
            }

            if (syncSettlements && get().autoSyncInProgress.length > 0) {
                try {
                    const resp = await fetch(`${API_BASE_URL}/api/tiktok-shop/sync/${accountId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ shopId, syncType: 'settlements' }),
                        signal
                    });
                    const data = await resp.json();
                    const syncedSettlements = data.stats?.settlements?.syncedSettlements || [];
                    console.log(`[AutoSync] Settlements synced (${data.stats?.settlements?.fetched || 0} fetched, ${syncedSettlements.length} returned for merge)`);

                    if (syncedSettlements.length > 0) {
                        get().mergeSyncedSettlementsIntoStore(syncedSettlements, shopId);
                    }
                } catch (e: any) {
                    console.error('[AutoSync] Settlements failed:', e.message);
                }
            }

            // Step 4: Finalize silently
            if (get().autoSyncInProgress.length > 0) {
                if (syncSettlements) {
                    set({ plDataKey: '' });
                }

                console.log('[AutoSync] Background sync complete');
                set(s => ({
                    cacheMetadata: {
                        ...s.cacheMetadata,
                        showRefreshPrompt: false,
                        isStale: false,
                        isSyncing: false
                    },
                    autoSyncInProgress: []
                }));
            }

        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log('[AutoSync] Request cancelled via AbortController');
                set(s => ({
                    autoSyncInProgress: [],
                    cacheMetadata: { ...s.cacheMetadata, isSyncing: false },
                    syncAbortController: null
                }));
                return;
            }
            console.error('[AutoSync] Error:', error.message);
            set(s => ({
                autoSyncInProgress: [],
                cacheMetadata: { ...s.cacheMetadata, isSyncing: false },
                syncAbortController: null
            }));
        }
    },

    /**
     * mergeAfterSync — Lightweight post-sync update.
     * Fetches delta (new + updated records since sync started) and merges into existing store.
     * ALWAYS forces new array references to guarantee React re-render.
     */
    /**
     * mergeSyncedOrdersIntoStore — Merge orders returned by sync endpoint directly into zustand.
     * No Supabase refetch. Takes the mapped orders from the sync response and merges by order_id.
     */
    mergeSyncedOrdersIntoStore: (syncedOrders: any[], shopId: string) => {
        try {
            console.log(`[MergeOrders] Merging ${syncedOrders.length} synced orders into store...`);

            const mapRawOrder = (o: any): Order => ({
                order_id: o.id,
                order_status: o.status,
                order_amount: parseFloat(o.payment?.total_amount || '0'),
                currency: o.payment?.currency || 'USD',
                created_time: o.create_time,
                paid_time: o.paid_time,
                line_items: (o.line_items || []).map((item: any) => ({
                    id: item.id,
                    product_name: item.product_name,
                    sku_image: item.sku_image,
                    quantity: item.quantity || 1,
                    sale_price: item.sale_price,
                    original_price: item.original_price,
                    seller_sku: item.seller_sku,
                    sku_name: item.sku_name,
                    is_dangerous_good: item.is_dangerous_good || false,
                    is_gift: item.is_gift || false
                })),
                buyer_info: o.buyer_info,
                shipping_info: o.shipping_info,
                payment_info: o.payment_info || o.payment,
                payment_method_name: o.payment_method_name,
                shipping_type: o.shipping_type,
                delivery_option_id: o.delivery_option_id,
                delivery_option_name: o.delivery_option_name,
                fulfillment_type: o.fulfillment_type || 'FULFILLMENT_BY_SELLER',
                is_fbt: o.is_fbt || false,
                fbt_fulfillment_fee: o.fbt_fulfillment_fee ?? null,
                warehouse_id: o.warehouse_id || null,
                return_status: o.return_status,
                substatus: o.substatus,
                refund_amount: parseFloat(o.refund_amount || '0'),
                return_reason: o.return_reason,
                cancel_reason: o.cancel_reason,
                cancellation_initiator: o.cancellation_initiator,
                is_sample_order: o.is_sample_order,
                collection_time: o.collection_time,
                is_cod: o.is_cod || false,
                is_exchange_order: o.is_exchange_order || false,
                is_on_hold_order: o.is_on_hold_order || false,
                is_replacement_order: o.is_replacement_order || false,
                delivery_type: o.delivery_type,
                seller_note: o.seller_note,
                shipping_due_time: o.shipping_due_time,
                shipping_provider_id: o.shipping_provider_id,
                shipping_provider: o.shipping_provider,
                tracking_number: o.tracking_number
            });

            const newOrders = syncedOrders.map(mapRawOrder);
            const orderMap = new Map(get().orders.map(o => [o.order_id, o]));
            for (const order of newOrders) {
                orderMap.set(order.order_id, order);
            }
            const mergedOrders = Array.from(orderMap.values()).sort((a, b) => b.created_time - a.created_time);

            const totalRevenue = mergedOrders.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
            const avgOrderValue = mergedOrders.length > 0 ? totalRevenue / mergedOrders.length : 0;

            set(s => ({
                orders: mergedOrders,
                metrics: {
                    ...s.metrics,
                    totalOrders: mergedOrders.length,
                    totalRevenue,
                    avgOrderValue
                },
                dataVersion: s.dataVersion + 1,
                lastFetchTime: Date.now()
            }));

            // Update memory cache
            set(s => {
                const newMemoryCache = { ...s.memoryCache };
                newMemoryCache[shopId] = {
                    products: s.products,
                    orders: s.orders,
                    metrics: s.metrics,
                    finance: s.finance,
                    lastFetchTime: s.lastFetchTime,
                    cacheMetadata: s.cacheMetadata,
                    plData: s.plData,
                    plDataKey: s.plDataKey,
                    loadedDateRange: s.loadedDateRange
                };
                return { memoryCache: newMemoryCache };
            });

            console.log(`[MergeOrders] ✅ Merged ${newOrders.length} synced orders. Store total: ${mergedOrders.length}`);
        } catch (error: any) {
            console.error('[MergeOrders] Error merging synced orders:', error.message);
        }
    },

    /**
     * mergeSyncedProductsIntoStore — Merge products returned by sync endpoint directly into zustand.
     * No Supabase refetch. Maps to Product interface and merges by product_id.
     */
    mergeSyncedProductsIntoStore: (syncedProducts: any[], shopId: string) => {
        try {
            console.log(`[MergeProducts] Merging ${syncedProducts.length} synced products into store...`);

            const mapRawProduct = (p: any): Product => ({
                product_id: p.product_id,
                name: p.product_name || p.name || '',
                status: p.status === 'ACTIVATE' ? 'active' : (p.status || 'active'),
                price: parseFloat(p.price || '0'),
                currency: 'USD',
                stock_quantity: parseInt(p.stock || '0', 10),
                sales_count: parseInt(p.sales_count || '0', 10),
                main_image_url: p.main_image_url || '',
                images: p.images || [],
                skus: p.sku_list || p.skus || [],
                details: p.details || {},
                click_through_rate: p.click_through_rate,
                gmv: p.gmv,
                orders_count: p.orders_count,
                // Preserve existing COGS — sync doesn't carry user-set COGS
                cogs: get().products.find(ep => ep.product_id === p.product_id)?.cogs ?? null,
                shipping_cost: get().products.find(ep => ep.product_id === p.product_id)?.shipping_cost ?? null,
                is_fbt: get().products.find(ep => ep.product_id === p.product_id)?.is_fbt,
                fbt_source: get().products.find(ep => ep.product_id === p.product_id)?.fbt_source
            });

            const newProducts = syncedProducts.map(mapRawProduct);
            const productMap = new Map(get().products.map(p => [p.product_id, p]));
            for (const product of newProducts) {
                productMap.set(product.product_id, product);
            }
            const mergedProducts = Array.from(productMap.values());

            set(s => ({
                products: mergedProducts,
                metrics: {
                    ...s.metrics,
                    totalProducts: mergedProducts.length
                },
                dataVersion: s.dataVersion + 1,
                lastFetchTime: Date.now()
            }));

            // Update memory cache
            set(s => {
                const newMemoryCache = { ...s.memoryCache };
                newMemoryCache[shopId] = {
                    products: s.products,
                    orders: s.orders,
                    metrics: s.metrics,
                    finance: s.finance,
                    lastFetchTime: s.lastFetchTime,
                    cacheMetadata: s.cacheMetadata,
                    plData: s.plData,
                    plDataKey: s.plDataKey,
                    loadedDateRange: s.loadedDateRange
                };
                return { memoryCache: newMemoryCache };
            });

            console.log(`[MergeProducts] ✅ Merged ${newProducts.length} synced products. Store total: ${mergedProducts.length}`);
        } catch (error: any) {
            console.error('[MergeProducts] Error merging synced products:', error.message);
        }
    },

    /**
     * mergeSyncedSettlementsIntoStore — Merge settlements returned by sync endpoint directly into zustand.
     * No Supabase refetch. Maps to Statement interface and merges by settlement_id.
     */
    mergeSyncedSettlementsIntoStore: (syncedSettlements: any[], shopId: string) => {
        try {
            console.log(`[MergeSettlements] Merging ${syncedSettlements.length} synced settlements into store...`);

            const mapRawSettlement = (s: any): Statement => ({
                id: s.settlement_id || s.id,
                statement_time: s.settlement_time
                    ? Math.floor(new Date(s.settlement_time).getTime() / 1000)
                    : (s.statement_time ? Number(s.statement_time) : 0),
                settlement_amount: String(s.net_amount || s.settlement_amount || '0'),
                currency: s.currency || 'USD',
                payment_status: s.payment_status || 'SETTLED',
                revenue_amount: String(s.total_amount || s.revenue_amount || '0'),
                fee_amount: String(s.fee_amount || '0'),
                adjustment_amount: String(s.adjustment_amount || '0'),
                shipping_fee: String(s.shipping_fee || '0'),
                net_sales_amount: String(s.net_sales_amount || '0'),
                order_id: s.order_id,
                transaction_summary: s.settlement_data?.transaction_summary || s.transaction_summary
            });

            const newStatements = syncedSettlements.map(mapRawSettlement);
            const existingStatements = get().finance.statements;
            const statementMap = new Map(existingStatements.map(s => [s.id, s]));
            for (const stmt of newStatements) {
                statementMap.set(stmt.id, stmt);
            }
            const mergedStatements = Array.from(statementMap.values())
                .sort((a, b) => b.statement_time - a.statement_time);

            const totalNet = mergedStatements.reduce((sum, s) => sum + parseFloat(s.settlement_amount || '0'), 0);

            set(s => ({
                finance: {
                    ...s.finance,
                    statements: mergedStatements,
                },
                metrics: {
                    ...s.metrics,
                    totalNet
                },
                dataVersion: s.dataVersion + 1,
                lastFetchTime: Date.now()
            }));

            // Update memory cache
            set(s => {
                const newMemoryCache = { ...s.memoryCache };
                newMemoryCache[shopId] = {
                    products: s.products,
                    orders: s.orders,
                    metrics: s.metrics,
                    finance: s.finance,
                    lastFetchTime: s.lastFetchTime,
                    cacheMetadata: s.cacheMetadata,
                    plData: s.plData,
                    plDataKey: s.plDataKey,
                    loadedDateRange: s.loadedDateRange
                };
                return { memoryCache: newMemoryCache };
            });

            // Clear P&L cache since settlements changed
            set({ plDataKey: '' });

            console.log(`[MergeSettlements] ✅ Merged ${newStatements.length} synced settlements. Store total: ${mergedStatements.length}`);
        } catch (error: any) {
            console.error('[MergeSettlements] Error merging synced settlements:', error.message);
        }
    },

    mergeAfterSync: async (accountId: string, shopId: string, sinceTimestamp: string, types?: string) => {
        try {
            const typesLabel = types || 'all';
            console.log(`[MergeAfterSync] Starting merge (types=${typesLabel}, since=${sinceTimestamp})...`);

            let deltaUrl = `${API_BASE_URL}/api/tiktok-shop/shop-data-delta/${accountId}?shopId=${shopId}&since=${encodeURIComponent(sinceTimestamp)}`;
            if (types) deltaUrl += `&types=${encodeURIComponent(types)}`;

            const result = await fetch(deltaUrl).then(r => r.json());

            if (!result.success) {
                console.warn('[MergeAfterSync] Delta fetch failed:', result.error);
                // Force a new array reference so React re-renders even on failure
                set(s => ({
                    orders: [...s.orders],
                    dataVersion: s.dataVersion + 1
                }));
                return;
            }

            const { newOrders: rawNew, updatedOrders: rawUpdated, products: rawProducts, settlements: rawSettlements, totalOrders: totalOrderCount } = result.data;

            console.log(`[MergeAfterSync] Delta response: ${rawNew?.length || 0} new orders, ${rawUpdated?.length || 0} updated orders, ${rawProducts?.length || 0} products, ${rawSettlements?.length || 0} settlements`);

            const mapRawOrder = (o: any): Order => ({
                order_id: o.id,
                order_status: o.status,
                order_amount: parseFloat(o.payment?.total_amount || '0'),
                currency: o.payment?.currency || 'USD',
                created_time: o.create_time,
                paid_time: o.paid_time,
                line_items: (o.line_items || []).map((item: any) => ({
                    id: item.id,
                    product_name: item.product_name,
                    sku_image: item.sku_image,
                    quantity: item.quantity || 1,
                    sale_price: item.sale_price,
                    original_price: item.original_price,
                    seller_sku: item.seller_sku,
                    sku_name: item.sku_name,
                    is_dangerous_good: item.is_dangerous_good || false,
                    is_gift: item.is_gift || false
                })),
                buyer_info: o.buyer_info,
                shipping_info: o.shipping_info,
                payment_info: o.payment_info || o.payment,
                payment_method_name: o.payment_method_name,
                shipping_type: o.shipping_type,
                delivery_option_id: o.delivery_option_id,
                delivery_option_name: o.delivery_option_name,
                fulfillment_type: o.fulfillment_type || 'FULFILLMENT_BY_SELLER',
                is_fbt: o.is_fbt || false,
                fbt_fulfillment_fee: o.fbt_fulfillment_fee ?? null,
                warehouse_id: o.warehouse_id || null,
                return_status: o.return_status,
                substatus: o.substatus,
                refund_amount: parseFloat(o.refund_amount || '0'),
                return_reason: o.return_reason,
                cancel_reason: o.cancel_reason,
                cancellation_initiator: o.cancellation_initiator,
                is_sample_order: o.is_sample_order,
                collection_time: o.collection_time,
                is_cod: o.is_cod || false,
                is_exchange_order: o.is_exchange_order || false,
                is_on_hold_order: o.is_on_hold_order || false,
                is_replacement_order: o.is_replacement_order || false,
                delivery_type: o.delivery_type,
                seller_note: o.seller_note,
                shipping_due_time: o.shipping_due_time,
                shipping_provider_id: o.shipping_provider_id,
                shipping_provider: o.shipping_provider,
                tracking_number: o.tracking_number
            });

            // --- Merge orders ---
            let mergedOrders: Order[];
            if (rawNew?.length > 0 || rawUpdated?.length > 0) {
                const changedOrders = [...(rawNew || []), ...(rawUpdated || [])].map(mapRawOrder);
                const orderMap = new Map(get().orders.map(o => [o.order_id, o]));
                for (const order of changedOrders) {
                    orderMap.set(order.order_id, order);
                }
                mergedOrders = Array.from(orderMap.values()).sort((a, b) => b.created_time - a.created_time);
                console.log(`[MergeAfterSync] Orders merged: ${changedOrders.length} changed, total ${mergedOrders.length}`);
            } else {
                // IMPORTANT: Always create a new array reference to guarantee React re-render
                mergedOrders = [...get().orders];
                console.log(`[MergeAfterSync] No order changes in delta, preserving ${mergedOrders.length} orders (new ref)`);
            }

            const totalRevenue = mergedOrders.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
            const avgOrderValue = mergedOrders.length > 0 ? totalRevenue / mergedOrders.length : 0;

            // --- Build store update (ALWAYS includes orders for fresh reference) ---
            const storeUpdate: any = {
                orders: mergedOrders,
                lastFetchTime: Date.now(),
                dataVersion: get().dataVersion + 1,
                metrics: {
                    ...get().metrics,
                    totalOrders: totalOrderCount || mergedOrders.length,
                    totalRevenue,
                    avgOrderValue
                }
            };

            // --- Replace products if returned ---
            if (rawProducts?.length > 0) {
                const products: Product[] = rawProducts.map((p: any) => ({
                    product_id: p.product_id,
                    name: p.product_name,
                    status: p.status === 'active' ? 'ACTIVATE' : 'INACTIVE',
                    price: p.price,
                    currency: p.currency || 'USD',
                    stock_quantity: p.stock,
                    sales_count: p.sales_count || 0,
                    main_image_url: p.main_image_url || p.images?.[0] || '',
                    images: p.images || [],
                    gmv: p.gmv || 0,
                    orders_count: p.orders_count || 0,
                    click_through_rate: p.click_through_rate || 0,
                    cogs: p.cogs ?? null,
                    shipping_cost: p.shipping_cost ?? null,
                    is_fbt: p.is_fbt || false,
                    fbt_source: p.fbt_source || 'auto',
                    details: p.details,
                    skus: p.details?.skus || []
                }));

                storeUpdate.products = products;
                storeUpdate.metrics.totalProducts = products.length;
                console.log(`[MergeAfterSync] Products replaced: ${products.length}`);
            }

            // --- Merge settlements if returned ---
            if (rawSettlements?.length > 0) {
                const newStatements: Statement[] = rawSettlements.map((s: any) => ({
                    ...s,
                    fee_amount: s.fee_amount?.toString() || '0',
                    adjustment_amount: s.adjustment_amount?.toString() || '0',
                    shipping_fee: s.shipping_fee?.toString() || '0',
                    net_sales_amount: s.net_sales_amount?.toString() || '0'
                }));

                const existingMap = new Map(
                    get().finance.statements.map(s => [s.id || s.order_id, s])
                );
                for (const s of newStatements) {
                    existingMap.set(s.id || s.order_id, s);
                }
                const mergedStatements = Array.from(existingMap.values());

                storeUpdate.finance = {
                    statements: mergedStatements,
                    payments: [...get().finance.payments],
                    withdrawals: [...get().finance.withdrawals],
                    unsettledOrders: [...get().finance.unsettledOrders],
                    affiliateSettlements: [...(get().finance.affiliateSettlements || [])],
                    agencyFees: [...(get().finance.agencyFees || [])]
                };
                storeUpdate.metrics.totalNet = mergedStatements.reduce(
                    (sum, s) => sum + parseFloat(s.settlement_amount || '0'), 0
                );
                console.log(`[MergeAfterSync] Settlements merged: ${newStatements.length} new/updated, total ${mergedStatements.length}`);
            }

            // Apply all updates atomically
            set(storeUpdate);
            console.log(`[MergeAfterSync] ✅ Store updated (dataVersion=${storeUpdate.dataVersion}, orders=${mergedOrders.length})`);

            // Update memory cache so shop-switching gets fresh data
            set(s => {
                const newMemoryCache = { ...s.memoryCache };
                newMemoryCache[shopId] = {
                    products: s.products,
                    orders: s.orders,
                    metrics: s.metrics,
                    finance: s.finance,
                    lastFetchTime: s.lastFetchTime,
                    cacheMetadata: s.cacheMetadata,
                    plData: s.plData,
                    plDataKey: s.plDataKey,
                    loadedDateRange: s.loadedDateRange
                };
                return { memoryCache: newMemoryCache };
            });

            console.log(`[MergeAfterSync] Complete (types=${typesLabel})`);

        } catch (error: any) {
            console.error('[MergeAfterSync] Error:', error.message);
            // On error, still force a re-render with new array reference
            set(s => ({
                orders: [...s.orders],
                dataVersion: s.dataVersion + 1
            }));
        }
    },

    mergeHistoricalOrders: (newOrders: Order[]) => {
        if (newOrders.length === 0) {
            console.log('[Store] No historical orders to merge');
            return;
        }

        const currentOrders = get().orders;
        const orderMap = new Map(currentOrders.map(o => [o.order_id, o]));

        // Add new historical orders (only if not already present)
        let addedCount = 0;
        for (const order of newOrders) {
            if (!orderMap.has(order.order_id)) {
                orderMap.set(order.order_id, order);
                addedCount++;
            }
        }

        if (addedCount === 0) {
            console.log('[Store] All historical orders already present, no merge needed');
            return;
        }

        // Sort by paid_time DESC (or created_time if paid_time is missing)
        const mergedOrders = Array.from(orderMap.values())
            .sort((a, b) => {
                const aTime = a.paid_time || a.created_time;
                const bTime = b.paid_time || b.created_time;
                return bTime - aTime;
            });

        // Recompute metrics
        const totalRevenue = mergedOrders.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
        const avgOrderValue = mergedOrders.length > 0 ? totalRevenue / mergedOrders.length : 0;

        set({
            orders: mergedOrders,
            metrics: {
                ...get().metrics,
                totalOrders: mergedOrders.length,
                totalRevenue,
                avgOrderValue
            }
        });

        console.log(`[Store] Merged ${addedCount} historical orders. Total: ${mergedOrders.length} orders`);
    },

    updateProductCosts: async (productId: string, costs: {
        cogs?: number | null;
        shipping_cost?: number | null;
        is_fbt?: boolean;
        applyFrom?: 'today' | 'specific_date';
        effectiveDate?: string;
        accountId?: string;
    }) => {
        try {
            // Use the more advanced PATCH endpoint that supports backdating
            const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/products/${productId}/costs`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accountId: costs.accountId, // Now passing accountId
                    cogs: costs.cogs,
                    shipping_cost: costs.shipping_cost,
                    is_fbt: costs.is_fbt,
                    applyFrom: costs.applyFrom,
                    effectiveDate: costs.effectiveDate
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to update product costs');
            }

            // Update local state optimistically
            // Note: If backdating to the past, the current value typically reflects this change immediately
            // unless effective date is in the future.
            const isFutureUpdate = costs.applyFrom === 'specific_date' &&
                costs.effectiveDate &&
                new Date(costs.effectiveDate) > new Date();

            if (!isFutureUpdate) {
                const state = get();
                const updatedProducts = state.products.map(p => {
                    if (p.product_id === productId) {
                        return {
                            ...p,
                            ...(costs.cogs !== undefined && { cogs: costs.cogs }),
                            ...(costs.shipping_cost !== undefined && { shipping_cost: costs.shipping_cost }),
                            ...(costs.is_fbt !== undefined && { is_fbt: costs.is_fbt })
                        };
                    }
                    return p;
                });
                set({ products: updatedProducts });
            }
        } catch (error) {
            console.error('Failed to update product costs:', error);
            throw error;
        }
    },

    updateProductSkuCosts: async (productId: string, skuId: string, costs: {
        cogs?: number | null;
        shipping_cost?: number | null;
        applyFrom?: 'today' | 'specific_date';
        effectiveDate?: string;
    }, accountId?: string) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/products/${productId}/sku-costs`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accountId,
                    skuId,
                    cogs: costs.cogs,
                    shipping_cost: costs.shipping_cost,
                    applyFrom: costs.applyFrom,
                    effectiveDate: costs.effectiveDate
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to update SKU costs');
            }

            // Skip optimistic update for future-dated changes
            const isFutureUpdate = costs.applyFrom === 'specific_date' &&
                costs.effectiveDate &&
                new Date(costs.effectiveDate) > new Date();

            if (!isFutureUpdate) {
                const state = get();
                const updatedProducts = state.products.map(p => {
                    if (p.product_id === productId) {
                        const updatedSkus = p.skus?.map(s => {
                            if (s.id === skuId) {
                                return {
                                    ...s,
                                    ...(costs.cogs !== undefined && { cogs: costs.cogs }),
                                    ...(costs.shipping_cost !== undefined && { shipping_cost: costs.shipping_cost })
                                };
                            }
                            return s;
                        });
                        return { ...p, skus: updatedSkus };
                    }
                    return p;
                });
                set({ products: updatedProducts });
            }
        } catch (error) {
            console.error('Failed to update SKU costs:', error);
            throw error;
        }
    },

    activateProducts: async (accountId: string, productIds: string[]) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/products/tiktok-activate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId, productIds })
            });

            if (!response.ok) throw new Error('Failed to activate products');

            // Optimistic update
            const state = get();
            const updatedProducts = state.products.map(p =>
                productIds.includes(p.product_id) ? { ...p, status: 'ACTIVATE' } : p
            );
            set({ products: updatedProducts });
        } catch (error) {
            console.error('Failed to activate products:', error);
            throw error;
        }
    },

    deactivateProducts: async (accountId: string, productIds: string[]) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/products/tiktok-deactivate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId, productIds })
            });

            if (!response.ok) throw new Error('Failed to deactivate products');

            // Optimistic update
            const state = get();
            const updatedProducts = state.products.map(p =>
                productIds.includes(p.product_id) ? { ...p, status: 'SELLER_DEACTIVATED' } : p
            );
            set({ products: updatedProducts });
        } catch (error) {
            console.error('Failed to deactivate products:', error);
            throw error;
        }
    },

    deleteProducts: async (accountId: string, productIds: string[]) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/products/tiktok-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId, productIds })
            });

            if (!response.ok) throw new Error('Failed to delete products');

            // Optimistic update - Remove deleted
            const state = get();
            const updatedProducts = state.products.filter(p => !productIds.includes(p.product_id));
            set({ products: updatedProducts });
        } catch (error) {
            console.error('Failed to delete products:', error);
            throw error;
        }
    },

    // ==================== PRODUCT EDITING ACTIONS ====================

    editProduct: async (accountId: string, productId: string, updates: ProductEditData) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/products/${productId}/partial-edit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId, ...updates })
            });

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to edit product');
            }

            // Update local state - only update name if title was changed
            if (updates.title) {
                const state = get();
                const updatedProducts = state.products.map(p => {
                    if (p.product_id === productId) {
                        return { ...p, name: updates.title! };
                    }
                    return p;
                });
                set({ products: updatedProducts });
            }

            return data.data;
        } catch (error) {
            console.error('Failed to edit product:', error);
            throw error;
        }
    },

    updateProductInventory: async (accountId: string, productId: string, skus: Array<{ id: string; inventory: Array<{ warehouse_id: string; quantity: number }> }>) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/products/${productId}/inventory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId, skus })
            });

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to update inventory');
            }

            // Update local state
            const totalQuantity = skus.reduce((sum, sku) => {
                return sum + sku.inventory.reduce((s, inv) => s + inv.quantity, 0);
            }, 0);

            const state = get();
            const updatedProducts = state.products.map(p => {
                if (p.product_id === productId) {
                    // Update SKU inventory
                    const updatedSkus = p.skus?.map(existingSku => {
                        const updateSku = skus.find(s => s.id === existingSku.id);
                        if (updateSku) {
                            return {
                                ...existingSku,
                                inventory: updateSku.inventory
                            };
                        }
                        return existingSku;
                    });
                    return {
                        ...p,
                        stock_quantity: totalQuantity,
                        skus: updatedSkus
                    };
                }
                return p;
            });
            set({ products: updatedProducts });

            return data.data;
        } catch (error) {
            console.error('Failed to update inventory:', error);
            throw error;
        }
    },

    updateProductPrices: async (accountId: string, productId: string, skus: Array<{ id: string; original_price?: string; sale_price?: string }>) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/products/${productId}/prices`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId, skus })
            });

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to update prices');
            }

            // Update local state
            const state = get();
            const updatedProducts = state.products.map(p => {
                if (p.product_id === productId) {
                    // Update main price from first SKU
                    const mainPrice = parseFloat(skus[0]?.original_price || skus[0]?.sale_price || String(p.price));
                    // Update SKU prices
                    const updatedSkus = p.skus?.map(existingSku => {
                        const updateSku = skus.find(s => s.id === existingSku.id);
                        if (updateSku) {
                            return {
                                ...existingSku,
                                price: {
                                    ...existingSku.price,
                                    tax_exclusive_price: updateSku.original_price || existingSku.price.tax_exclusive_price,
                                    sale_price: updateSku.sale_price || existingSku.price.sale_price
                                }
                            };
                        }
                        return existingSku;
                    });
                    return {
                        ...p,
                        price: mainPrice,
                        skus: updatedSkus
                    };
                }
                return p;
            });
            set({ products: updatedProducts });

            return data.data;
        } catch (error) {
            console.error('Failed to update prices:', error);
            throw error;
        }
    },

    uploadProductImage: async (accountId: string, imageData: string, fileName: string = 'image.jpg', useCase: 'MAIN_IMAGE' | 'SKU_IMAGE' = 'MAIN_IMAGE') => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/images/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId, imageData, fileName, useCase })
            });

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to upload image');
            }

            return data.data;
        } catch (error) {
            console.error('Failed to upload image:', error);
            throw error;
        }
    },

    fetchWarehouses: async (accountId: string) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/warehouses/${accountId}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to fetch warehouses');
            }

            const warehouses: Warehouse[] = data.data?.warehouses || [];
            set({ warehouses });
            return warehouses;
        } catch (error) {
            console.error('Failed to fetch warehouses:', error);
            throw error;
        }
    },

    fetchAffiliateSettlements: async (accountId: string, shopId: string, startDate: string, endDate: string) => {
        try {
            const { data, error } = await supabase
                .from('affiliate_settlements')
                .select('*')
                .eq('account_id', accountId)
                .eq('shop_id', shopId)
                .gte('date', startDate)
                .lte('date', endDate)
                .order('date', { ascending: false });

            if (error) throw error;

            set((state) => ({
                finance: {
                    ...state.finance,
                    affiliateSettlements: data || []
                }
            }));
        } catch (err) {
            console.error('Error fetching affiliate settlements:', err);
        }
    },

    addAffiliateSettlement: async (settlement) => {
        try {
            const { data, error } = await supabase
                .from('affiliate_settlements')
                .insert(settlement)
                .select()
                .single();

            if (error) throw error;

            set((state) => ({
                finance: {
                    ...state.finance,
                    affiliateSettlements: [data, ...state.finance.affiliateSettlements]
                }
            }));
        } catch (err) {
            console.error('Error adding affiliate settlement:', err);
            throw err;
        }
    },

    deleteAffiliateSettlement: async (id) => {
        try {
            const { error } = await supabase
                .from('affiliate_settlements')
                .delete()
                .eq('id', id);

            if (error) throw error;

            set((state) => ({
                finance: {
                    ...state.finance,
                    affiliateSettlements: state.finance.affiliateSettlements.filter(s => s.id !== id)
                }
            }));
        } catch (err) {
            console.error('Error deleting affiliate settlement:', err);
            throw err;
        }
    },

    fetchAgencyFees: async (accountId: string, shopId: string, _startDate: string, endDate: string) => {
        try {
            // Fetch all fees that started on or before the range end.
            // No lower-bound filter: recurring fees started before the range can still
            // generate occurrences within it (handled in the frontend calculation).
            const { data, error } = await supabase
                .from('agency_fees')
                .select('*')
                .eq('account_id', accountId)
                .eq('shop_id', shopId)
                .lte('date', endDate)
                .order('date', { ascending: false });

            if (error) throw error;

            set((state) => ({
                finance: {
                    ...state.finance,
                    agencyFees: data || []
                }
            }));
        } catch (err) {
            console.error('Error fetching agency fees:', err);
        }
    },

    addAgencyFee: async (fee) => {
        try {
            const { data, error } = await supabase
                .from('agency_fees')
                .insert(fee)
                .select()
                .single();

            if (error) throw error;

            set((state) => ({
                finance: {
                    ...state.finance,
                    agencyFees: [data, ...state.finance.agencyFees]
                }
            }));
        } catch (err) {
            console.error('Error adding agency fee:', err);
            throw err;
        }
    },

    deleteAgencyFee: async (id) => {
        try {
            const { error } = await supabase
                .from('agency_fees')
                .delete()
                .eq('id', id);

            if (error) throw error;

            set((state) => ({
                finance: {
                    ...state.finance,
                    agencyFees: state.finance.agencyFees.filter(s => s.id !== id)
                }
            }));
        } catch (err) {
            console.error('Error deleting agency fee:', err);
            throw err;
        }
    },

    fetchPLData: async (accountId: string, shopId: string, startDate: string, endDate: string, forceRefresh: boolean = false) => {
        const key = `${accountId}:${shopId}:${startDate}:${endDate}`;

        // If we already have data for this exact key and not forcing refresh, skip
        if (!forceRefresh && get().plDataKey === key && get().plData) {
            return;
        }

        // Only show loading spinner if we have no existing data (prevents flickering)
        if (!get().plData) {
            set({ plLoading: true });
        }

        set({ plError: null });

        try {
            const shopTimezone = 'America/Los_Angeles'; // TODO: Get from shop settings
            const startUnix = getShopDayStartTimestamp(startDate, shopTimezone);
            const endUnix = getShopDayStartTimestamp(endDate, shopTimezone) + 86400;

            const url = `${API_BASE_URL}/api/tiktok-shop/finance/pl-data/${accountId}?shopId=${shopId}&startDate=${startUnix}&endDate=${endUnix}`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.success) {
                set({ plData: result.data, plDataKey: key, plLoading: false });
            } else {
                set({ plError: result.error || 'Failed to fetch P&L data', plLoading: false });
            }
        } catch (err: any) {
            console.error('Error fetching P&L data:', err);
            set({ plError: err.message || 'Network error', plLoading: false });
        }
    }
}));
