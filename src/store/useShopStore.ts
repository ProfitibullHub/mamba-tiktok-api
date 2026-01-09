import { create } from 'zustand';


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
    details?: any; // Full JSON blob
    skus?: ProductSKU[]; // SKU variants
}

export interface Order {
    order_id: string;
    order_status: string;
    order_amount: number;
    currency: string;
    created_time: number;
    line_items: {
        id: string;
        product_name: string;
        sku_image: string;
        quantity: number;
        sale_price: string;
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
    payment_info?: {
        currency?: string;
        sub_total?: string;
        shipping_fee?: string;
        tax?: string;
        total_amount?: string;
        subtotal_before_discount_amount?: string;
        customer_paid_shipping_fee_amount?: string;
    };
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

interface ShopState {
    products: Product[];
    orders: Order[];
    metrics: ShopMetrics;
    finance: {
        statements: Statement[];
        payments: any[];
        withdrawals: any[];
        unsettledOrders: any[];
    };
    isLoading: boolean;
    error: string | null;
    lastFetchTime: number | null;
    lastFetchShopId: string | null;
    cacheMetadata: CacheMetadata;
    syncProgress: SyncProgress;

    // Actions
    fetchShopData: (accountId: string, shopId?: string, options?: { forceRefresh?: boolean; showCached?: boolean; skipSyncCheck?: boolean }) => Promise<void>;
    setProducts: (products: Product[]) => void;
    setOrders: (orders: Order[]) => void;
    setMetrics: (metrics: Partial<ShopMetrics>) => void;
    clearData: () => void;
    syncData: (accountId: string, shopId: string, syncType?: 'orders' | 'products' | 'finance' | 'all') => Promise<void>;
    cancelSync: () => void;
    dismissRefreshPrompt: () => void;
    memoryCache: Record<string, {
        products: Product[];
        orders: Order[];
        metrics: ShopMetrics;
        finance: {
            statements: Statement[];
            payments: any[];
            withdrawals: any[];
            unsettledOrders: any[];
        };
        lastFetchTime: number | null;
        cacheMetadata: CacheMetadata;
    }>;
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
        unsettledOrders: []
    },
    isLoading: false,
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
    memoryCache: {},

    setProducts: (products) => set({ products }),
    setOrders: (orders) => set({ orders }),
    setMetrics: (newMetrics) => set((state) => ({
        metrics: { ...state.metrics, ...newMetrics }
    })),


    fetchShopData: async (accountId: string, shopId?: string, options = {}) => {
        const { forceRefresh = false, showCached = true, skipSyncCheck = false } = options;
        const state = get();

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
                    cacheMetadata: state.cacheMetadata
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
                    // Stale cache - show prompt but DON'T re-fetch from Supabase
                    // Data is already loaded from memory cache above
                    console.log(`[Store] Memory cache is stale (>30 min), showing refresh prompt.`);
                    const lastDismissed = state.cacheMetadata.lastPromptDismissedAt;
                    const shouldShowPrompt = !lastDismissed || (Date.now() - lastDismissed > 30 * 60 * 1000);

                    if (shouldShowPrompt) {
                        set(s => ({
                            cacheMetadata: { ...s.cacheMetadata, showRefreshPrompt: true, isStale: true }
                        }));
                    }
                    return; // Don't fetch from DB, we already have memory cache data
                }

                return; // Default: use cached data
            } else {
                // No memory cache - need to load from DB
                console.log('[Store] No memory cache, will load from DB...');
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
                    finance: { statements: [], payments: [], withdrawals: [], unsettledOrders: [] },
                    error: null,
                    lastFetchShopId: shopId,
                    isLoading: true, // Show loader when loading from DB
                    cacheMetadata: {
                        ...state.cacheMetadata,
                        shopId,
                        accountId
                    }
                });
            }
        } else if (forceRefresh && !skipSyncCheck) {
            // Only show loading overlay for manual refresh, NOT for post-sync updates
            set({ isLoading: true, error: null });
        }

        try {
            // Step 1: Check cache status (skip if we just synced)
            let cacheStatus: any = null;
            let shouldSync = false;

            if (shopId && !skipSyncCheck) {
                console.log('[Store] Checking cache status...');
                const cacheStatusUrl = `${API_BASE_URL}/api/tiktok-shop/cache-status/${accountId}?shopId=${shopId}`;
                const cacheResponse = await fetch(cacheStatusUrl);
                const cacheResult = await cacheResponse.json();

                if (cacheResult.success) {
                    cacheStatus = cacheResult.data;
                    // Sync if data is older than 30 minutes
                    shouldSync = cacheStatus.should_prompt_user || forceRefresh;
                    console.log(`[Store] Cache status - Should Sync: ${shouldSync}`);
                }
            } else if (skipSyncCheck) {
                console.log('[Store] Skipping cache status check (post-sync refresh)');
            }

            // Step 2: Load cached data from DB if available
            if (showCached && shopId) {
                console.log('[Store] Loading cached data from DB...');

                // Only fetch products, orders, settlements - NO overview API (calculate metrics locally)
                const productsUrl = `${API_BASE_URL}/api/tiktok-shop/products/synced/${accountId}${shopId ? `?shopId=${shopId}` : ''}`;
                const ordersUrl = `${API_BASE_URL}/api/tiktok-shop/orders/synced/${accountId}${shopId ? `?shopId=${shopId}` : ''}`;
                const settlementsUrl = `${API_BASE_URL}/api/tiktok-shop/settlements/synced/${accountId}${shopId ? `?shopId=${shopId}` : ''}`;

                const [productsResult, ordersResult, settlementsResult] = await Promise.all([
                    fetch(productsUrl).then(r => r.json()).catch(e => ({ success: false, error: e.message })),
                    fetch(ordersUrl).then(r => r.json()).catch(e => ({ success: false, error: e.message })),
                    fetch(settlementsUrl).then(r => r.json()).catch(e => ({ success: false, error: e.message }))
                ]);

                const products: Product[] = (productsResult.data?.products || []).map((p: any) => ({
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
                    details: p.details,
                    skus: p.details?.skus || []
                }));

                const orders: Order[] = (ordersResult.data?.orders || []).map((o: any) => ({
                    order_id: o.id,
                    order_status: o.status,
                    order_amount: parseFloat(o.payment?.total_amount || '0'),
                    currency: o.payment?.currency || 'USD',
                    created_time: o.create_time,
                    line_items: (o.line_items || []).map((item: any) => ({
                        id: item.id,
                        product_name: item.product_name,
                        sku_image: item.sku_image,
                        quantity: 1,
                        sale_price: item.sale_price
                    })),
                    buyer_info: o.buyer_info,
                    shipping_info: o.shipping_info
                }));

                const statements: Statement[] = settlementsResult.success ? (settlementsResult.data || []).map((s: any) => ({
                    ...s,
                    fee_amount: s.fee_amount?.toString() || '0',
                    adjustment_amount: s.adjustment_amount?.toString() || '0',
                    shipping_fee: s.shipping_fee?.toString() || '0',
                    net_sales_amount: s.net_sales_amount?.toString() || '0'
                })) : [];

                // Calculate metrics locally - no need for separate overview API call
                const totalRevenue = orders.reduce((sum, o) => sum + o.order_amount, 0);
                const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;
                const metrics: ShopMetrics = {
                    totalOrders: orders.length,
                    totalRevenue,
                    totalProducts: products.length,
                    totalNet: statements.reduce((sum, s) => sum + parseFloat(s.settlement_amount || '0'), 0),
                    avgOrderValue,
                    conversionRate: state.metrics.conversionRate || 0,
                    shopRating: state.metrics.shopRating || 0
                };

                set({
                    products: products.length > 0 ? products : get().products,
                    orders: orders.length > 0 ? orders : get().orders,
                    metrics,
                    finance: {
                        statements,
                        payments: [],
                        withdrawals: [],
                        unsettledOrders: []
                    },
                    isLoading: false, // Never show overlay loader for background syncs
                    error: null,
                    lastFetchTime: Date.now(),
                    lastFetchShopId: shopId,
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
                    }
                });

                console.log(`[Store] DB data loaded. Products: ${products.length}, Orders: ${orders.length}`);
            }

            // Step 3: Trigger background sync if stale and not already syncing
            if (shouldSync && shopId && !skipSyncCheck && !get().cacheMetadata.isSyncing) {
                // Only auto-sync if we have NO data (first time). Otherwise prompt user.
                const hasData = get().products.length > 0 || get().orders.length > 0;

                if (!hasData) {
                    console.log('[Store] First time sync (no data) - auto triggering...');
                    await get().syncData(accountId, shopId, 'all');
                } else {
                    // Only show prompt if not dismissed in the last 30 minutes
                    const lastDismissed = get().cacheMetadata.lastPromptDismissedAt;
                    const shouldShowPrompt = !lastDismissed || (Date.now() - lastDismissed > 30 * 60 * 1000);

                    if (shouldShowPrompt) {
                        console.log('[Store] Data stale but exists - prompting user...');
                        set(state => ({
                            cacheMetadata: { ...state.cacheMetadata, showRefreshPrompt: true }
                        }));
                    } else {
                        console.log('[Store] Prompt recently dismissed, not showing again');
                    }
                }
            }

        } catch (error: any) {
            console.error('[Store] Fatal error fetching shop data:', error);
            set({ error: error.message, isLoading: false });
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
        finance: { statements: [], payments: [], withdrawals: [], unsettledOrders: [] },
        error: null,
        lastFetchTime: null,
        lastFetchShopId: null
    }),

    syncData: async (accountId: string, shopId: string, syncType: string = 'all') => {
        // Don't set isLoading to true for background syncs if we already have data
        const hasData = get().products.length > 0 || get().orders.length > 0;
        const isFirstSync = !hasData;

        // Determine what to sync
        const syncOrders = syncType === 'all' || syncType === 'orders';
        const syncProducts = syncType === 'all' || syncType === 'products';
        const syncSettlements = syncType === 'all' || syncType === 'finance' || syncType === 'settlements';

        // Get appropriate initial message
        const getInitialMessage = () => {
            if (isFirstSync) return '🚀 First time syncing! This may take a few minutes...';
            if (syncType === 'orders') return '📦 Syncing orders...';
            if (syncType === 'products') return '🛍️ Syncing products...';
            if (syncType === 'finance' || syncType === 'settlements') return '💰 Syncing financial data...';
            return '📦 Syncing orders...';
        };

        // Initialize sync progress
        set({
            isLoading: !hasData,
            error: null,
            cacheMetadata: { ...get().cacheMetadata, isSyncing: true },
            syncProgress: {
                isActive: true,
                isFirstSync,
                currentStep: syncOrders ? 'orders' : syncProducts ? 'products' : 'settlements',
                message: getInitialMessage(),
                ordersComplete: !syncOrders, // Mark as complete if not syncing
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

            // Step 1: Sync Orders (if requested)
            if (syncOrders) {
                const ordersResponse = await fetch(`${API_BASE_URL}/api/tiktok-shop/sync/${accountId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shopId, syncType: 'orders' }),
                });
                ordersData = await ordersResponse.json();

                if (!get().syncProgress.isActive) return; // Stop if cancelled

                set(s => ({
                    syncProgress: {
                        ...s.syncProgress,
                        currentStep: syncProducts ? 'products' : syncSettlements ? 'settlements' : 'complete',
                        message: syncProducts
                            ? '✅ Orders synced! 🛍️ Syncing products...'
                            : syncSettlements
                                ? '✅ Orders synced! 💰 Syncing financial data...'
                                : '✅ Orders synced successfully!',
                        ordersComplete: true,
                        ordersFetched: ordersData.stats?.orders?.fetched || 0
                    }
                }));
                // Note: Don't refresh UI here - will do one combined refresh at the end
            }

            // Step 2: Sync Products (if requested)
            if (syncProducts) {
                const productsResponse = await fetch(`${API_BASE_URL}/api/tiktok-shop/sync/${accountId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shopId, syncType: 'products' }),
                });
                productsData = await productsResponse.json();

                if (!get().syncProgress.isActive) return; // Stop if cancelled

                set(s => ({
                    syncProgress: {
                        ...s.syncProgress,
                        currentStep: syncSettlements ? 'settlements' : 'complete',
                        message: syncSettlements
                            ? '✅ Products synced! 💰 Syncing financial data...'
                            : '✅ Products synced successfully!',
                        productsComplete: true,
                        productsFetched: productsData.stats?.products?.fetched || 0
                    }
                }));
                // Note: Don't refresh UI here - will do one combined refresh at the end
            }

            // Step 3: Sync Settlements/Finance (if requested)
            if (syncSettlements) {
                const settlementsResponse = await fetch(`${API_BASE_URL}/api/tiktok-shop/sync/${accountId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shopId, syncType: 'settlements' }),
                });
                settlementsData = await settlementsResponse.json();

                if (!get().syncProgress.isActive) return; // Stop if cancelled
            }

            // Sync complete! Now refresh UI data
            const currentShopId = shopId;

            // Show "Updating display" while we fetch fresh data
            set(s => ({
                syncProgress: {
                    ...s.syncProgress,
                    currentStep: 'complete',
                    message: '🔄 Updating display...',
                    settlementsComplete: true,
                    settlementsFetched: settlementsData.stats?.settlements?.fetched || 0
                },
                isLoading: false // No loading overlay
            }));

            // Fetch fresh data from DB (blocking - wait for it to complete)
            await get().fetchShopData(accountId, shopId, {
                forceRefresh: true,
                showCached: true,
                skipSyncCheck: true
            });

            // Data is now updated! Show sync complete message
            set(s => {
                // Clear memory cache for this shop
                const newMemoryCache = { ...s.memoryCache };
                delete newMemoryCache[currentShopId];

                return {
                    syncProgress: {
                        ...s.syncProgress,
                        message: '✅ Sync complete!'
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
            console.error('Sync error:', error);
            set({
                error: error.message,
                isLoading: false,
                syncProgress: {
                    ...get().syncProgress,
                    isActive: false,
                    message: `❌ Sync failed: ${error.message}`
                }
            });
            throw error;
        } finally {
            set(s => ({ cacheMetadata: { ...s.cacheMetadata, isSyncing: false } }));
        }
    },

    cancelSync: () => {
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
            }
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
                lastPromptDismissedAt: Date.now() // Track when user dismissed to avoid re-prompting
            }
        });
    }
}));
