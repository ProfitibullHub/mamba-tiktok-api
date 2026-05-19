import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { NewOrdersToast } from './NewOrdersToast';
import { NotificationToast } from './NotificationToast';
import { OverviewView } from './views/OverviewView';
import { type Account, supabase } from '../lib/supabase';
import { matchesSlug } from '../utils/slugify';
import { useAuth } from '../contexts/AuthContext';
import { useTenantContext } from '../contexts/TenantContext';
import { fetchBranding } from '../lib/brandingApi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useShopStore } from '../store/useShopStore';
import { useNotificationStore } from '../store/useNotificationStore';
import { useTikTokAdsStore } from '../store/useTikTokAdsStore';
import { getTimezoneDisplay } from '../utils/timezoneMapping';
import { AlertTriangle, Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { VisibleShop } from './views/HomeConsoleView';
import { UnauthorizedShopAccess } from './UnauthorizedShopAccess';
import {
    SellerBrandingProvider,
    SELLER_FACING_BRANDING_QK,
    useSellerBranding,
} from '../contexts/SellerBrandingContext';
import type { DateRange } from './DateRangePicker';
import { clearShopTabMountBootstrapFingerprints } from '../utils/shopTabBootstrap';
import {
    useMergedShopEffectivePermissions,
    computeShopTabAccess,
    firstAccessibleShopTab,
    shopTabIsAllowed,
    effectiveHasTiktokShopData,
    effectiveAllowsMarketingFinanceTab,
} from '../hooks/useMyEffectivePermissions';

/** Lazy tabs — smaller initial bundle for the default Overview route; chunks load on first visit. */
const OrdersView = lazy(() => import('./views/OrdersView').then((m) => ({ default: m.OrdersView })));
const ProductsView = lazy(() => import('./views/ProductsView').then((m) => ({ default: m.ProductsView })));
const ProfitLossView = lazy(() => import('./views/ProfitLossView').then((m) => ({ default: m.ProfitLossView })));
const FinanceDebugView = lazy(() => import('./views/FinanceDebugView').then((m) => ({ default: m.FinanceDebugView })));
const DataAuditView = lazy(() => import('./views/DataAuditView').then((m) => ({ default: m.DataAuditView })));
const MarketingDashboardView = lazy(() =>
    import('./views/MarketingDashboardView').then((m) => ({ default: m.MarketingDashboardView })),
);
const NotificationsView = lazy(() => import('./views/NotificationsView').then((m) => ({ default: m.NotificationsView })));
const ProfileView = lazy(() => import('./views/ProfileView').then((m) => ({ default: m.ProfileView })));
const FinancialRestrictionsView = lazy(() =>
    import('./views/FinancialRestrictionsView').then((m) => ({ default: m.FinancialRestrictionsView })),
);

/** Tabs that drive `fetchShopData` + the shared date-range UI. Other tabs only hide the sync progress bar; in-flight fetches keep running. */
const SHOP_DATA_RANGE_TAB_IDS = new Set(['overview', 'profit-loss', 'orders']);

/** Per-tab period memory while this shop SPA session is mounted (lost on refresh / navigate away from shop). */
type ShopSessionRangeTab = 'overview' | 'orders' | 'profit-loss' | 'marketing';

export function ShopPage() {
    const { shopSlug } = useParams<{ shopSlug: string }>();
    const location = useLocation();
    const { user } = useAuth();
    const {
        profileTenantId,
        sellerFacingBrandingEligible,
        isTenantAccessLocked,
        tenantAccessLockReason,
        loading: tenantLoading,
    } = useTenantContext();
    const queryClient = useQueryClient();

    const passedShop = (location.state as { shop?: VisibleShop })?.shop ?? null;

    const [activeTab, setActiveTab] = useState('overview');
    const [targetOrderId, setTargetOrderId] = useState<string | undefined>(undefined);

    const navigationTarget = useNotificationStore((state) => state.navigationTarget);
    const setNavigationTarget = useNotificationStore((state) => state.setNavigationTarget);

    useEffect(() => {
        if (navigationTarget) {
            if (navigationTarget.tab && navigationTarget.tab !== activeTab) {
                setActiveTab(navigationTarget.tab);
            }
            if (navigationTarget.orderId) {
                setTargetOrderId(navigationTarget.orderId);
            }
            setTimeout(() => setNavigationTarget(null), 100);
        }
    }, [navigationTarget, activeTab, setNavigationTarget]);

    useEffect(() => {
        if (activeTab !== 'orders') {
            setTargetOrderId(undefined);
        }
    }, [activeTab]);

    // Resolve the shop from the URL slug
    const {
        data: resolvedShop,
        isLoading: loadingShop,
    } = useQuery({
        queryKey: ['shop-by-slug', shopSlug, user?.id],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('tiktok_shops')
                .select('id, shop_id, shop_name, region, timezone, seller_type, account_id, accounts!inner(id, name, tenant_id, tenants(id, name, type))')
                .order('shop_name');
            if (error) throw error;

            const match = (data || []).find((row: any) => matchesSlug(row.shop_name, shopSlug!));
            if (!match) return null;

            return {
                id: match.id,
                shop_id: match.shop_id,
                shop_name: match.shop_name,
                region: match.region,
                timezone: match.timezone,
                seller_type: match.seller_type,
                account_id: match.account_id,
                account_name: (match as any).accounts?.name ?? 'Unknown',
                tenant_id: (match as any).accounts?.tenants?.id ?? (match as any).accounts?.tenant_id ?? null,
                tenant_name: (match as any).accounts?.tenants?.name ?? (match as any).accounts?.name ?? null,
                tenant_type: (match as any).accounts?.tenants?.type ?? null,
            } as VisibleShop;
        },
        enabled: Boolean(shopSlug && user?.id && !isTenantAccessLocked),
        staleTime: 1000 * 60 * 10,
    });

    /** Prefer server row over navigation state so `timezone` and other fields stay in sync with Supabase after refresh. */
    const shop = resolvedShop ?? passedShop ?? null;

    /** After PATCH /timezone succeeds, TimezoneSelector calls this — merge into cache + refetch so UI matches DB. */
    const [timezoneOverride, setTimezoneOverride] = useState<string | null>(null);

    useEffect(() => {
        setTimezoneOverride(null);
    }, [shop?.shop_id]);

    useEffect(() => {
        if (timezoneOverride && shop?.timezone === timezoneOverride) {
            setTimezoneOverride(null);
        }
    }, [shop?.timezone, timezoneOverride]);

    // UX gate only — shop list and data are already scoped by RLS; API uses check_user_account_access.
    const {
        data: accessAllowed,
        isLoading: accessLoading,
        isError: accessCheckError,
    } = useQuery({
        queryKey: ['shop-account-access', user?.id, shop?.account_id],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('user_can_access_account', {
                p_account_id: shop!.account_id,
            });
            if (error) throw error;
            return data === true;
        },
        enabled: Boolean(user?.id && shop?.account_id && !isTenantAccessLocked),
        staleTime: 30_000,
    });

    const canMountShop = Boolean(shop && accessAllowed === true && !isTenantAccessLocked);
    const accessDenied = Boolean(
        shop && !accessLoading && (accessCheckError || accessAllowed === false),
    );

    const brandingCacheKey = profileTenantId ?? shop?.shop_id ?? '';

    const shopDocumentTitle = useMemo(() => {
        if (!shop?.shop_name) return null;
        return { kind: 'shop' as const, shopName: shop.shop_name };
    }, [shop?.shop_name]);

    const selectedAccount: Account | null = shop
        ? {
              id: shop.account_id,
              name: shop.account_name,
              tiktok_handle: '',
              status: 'active',
              tenant_id: shop.tenant_id ?? undefined,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
          }
        : null;

    const shopTimezone = timezoneOverride ?? shop?.timezone ?? 'America/Los_Angeles';

    const brandingPrefetchEnabled = Boolean(
        canMountShop && sellerFacingBrandingEligible && Boolean(brandingCacheKey) && !tenantLoading,
    );

    const { isFetched: brandingPrefetchFetched } = useQuery({
        queryKey: [SELLER_FACING_BRANDING_QK, brandingCacheKey, shop?.account_id ?? ''],
        queryFn: () => fetchBranding(undefined, shop?.account_id),
        enabled: brandingPrefetchEnabled,
        staleTime: 30 * 60 * 1000,
        gcTime: 60 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const brandingGateDone =
        !sellerFacingBrandingEligible ||
        (brandingPrefetchEnabled && brandingPrefetchFetched);

    /** Cold slug fetch without navigation state — wait for React Query row before treating as missing. */
    const awaitingSlugResolution = Boolean(
        user?.id && shopSlug && loadingShop && !passedShop && resolvedShop === undefined,
    );

    const awaitingAccess = Boolean(shop?.account_id && accessLoading);

    const needsFullDashboardGate = Boolean(
        shop &&
            shop.account_id &&
            accessAllowed === true &&
            !accessLoading &&
            !awaitingSlugResolution &&
            (tenantLoading || !brandingGateDone),
    );

    const showUnifiedDashboardGate =
        awaitingSlugResolution || awaitingAccess || needsFullDashboardGate;

    const unifiedGateLabel = awaitingSlugResolution
        ? 'Loading shop…'
        : awaitingAccess
          ? 'Checking access…'
          : tenantLoading
            ? 'Loading workspace…'
            : 'Loading brand…';

    /** Persists via PATCH; updates React Query cache so refresh and navigation state both reflect the saved timezone. */
    const handleTimezoneChange = useCallback(
        (newTz: string) => {
            setTimezoneOverride(newTz);
            queryClient.setQueryData<VisibleShop | null>(['shop-by-slug', shopSlug, user?.id], (old) =>
                old ? { ...old, timezone: newTz } : old,
            );
            void queryClient.invalidateQueries({ queryKey: ['shop-by-slug', shopSlug, user?.id] });
            void queryClient.invalidateQueries({ queryKey: ['all-visible-shops'] });
        },
        [queryClient, shopSlug, user?.id],
    );

    // Shop order/product data is loaded by the active view (Overview default) via fetchShopData with the
    // user's date range. Avoid a second no-date fetch here — it raced Overview and was skipped as "duplicate",
    // leaving the wrong range in the store.

    if (!user?.id) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-mamba-green border-t-transparent" />
            </div>
        );
    }

    if (isTenantAccessLocked) {
        return (
            <UnauthorizedShopAccess
                attemptedLabel={shopSlug}
                title="Tenant access is locked"
                message={`Your ${tenantAccessLockReason ?? 'inactive'} tenant cannot access shop dashboards until reactivated.`}
            />
        );
    }

    if (shop && !shop.account_id) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="text-center max-w-md">
                    <AlertTriangle className="w-14 h-14 text-yellow-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold brand-text mb-2">Shop not found</h2>
                    <p className="brand-muted text-sm mb-6">
                        This shop could not be loaded. Return to the console and open a shop from your list.
                    </p>
                    <Link
                        to="/"
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-mamba-green hover:bg-mamba-deep text-mamba-dark rounded-xl text-sm font-medium"
                    >
                        <Store className="w-4 h-4" />
                        Back to Console
                    </Link>
                </div>
            </div>
        );
    }

    if (accessDenied) {
        return <UnauthorizedShopAccess attemptedLabel={shopSlug} />;
    }

    if (showUnifiedDashboardGate) {
        return <ShopDashboardGateSpinner label={unifiedGateLabel} />;
    }

    if (!shop) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="text-center max-w-md">
                    <AlertTriangle className="w-14 h-14 text-yellow-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold brand-text mb-2">Shop not found</h2>
                    <p className="brand-muted text-sm mb-6">
                        No shop matching <span className="brand-text font-medium">{shopSlug}</span> was found, or you don't have access to it.
                    </p>
                    <Link
                        to="/"
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-mamba-green hover:bg-mamba-deep text-mamba-dark rounded-xl text-sm font-medium"
                    >
                        <Store className="w-4 h-4" />
                        Back to Console
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <SellerBrandingProvider
            enabled={canMountShop && sellerFacingBrandingEligible}
            brandingCacheKey={brandingCacheKey}
            brandingAccountId={shop.account_id}
            documentTitle={shopDocumentTitle}
        >
            <ShopShell
                shop={shop}
                shopSlug={shopSlug}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                shopTimezone={shopTimezone}
                selectedAccount={selectedAccount}
                targetOrderId={targetOrderId}
                setTargetOrderId={setTargetOrderId}
                handleTimezoneChange={handleTimezoneChange}
            />
        </SellerBrandingProvider>
    );
}

function ShopDashboardGateSpinner({ label }: { label: string }) {
    return (
        <div className="flex flex-col items-center justify-center gap-4 h-screen bg-gray-900 px-6">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-mamba-green border-t-transparent shrink-0" />
            <p className="text-sm text-gray-400 text-center max-w-xs">{label}</p>
        </div>
    );
}

/** Inner shell — runs inside SellerBrandingProvider so it can read brand CSS vars. */
function ShopShell({
    shop,
    shopSlug,
    activeTab,
    setActiveTab,
    shopTimezone,
    selectedAccount,
    targetOrderId,
    setTargetOrderId,
    handleTimezoneChange,
}: {
    shop: VisibleShop;
    shopSlug: string | undefined;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    shopTimezone: string;
    selectedAccount: import('../lib/supabase').Account | null;
    targetOrderId: string | undefined;
    setTargetOrderId: (id: string | undefined) => void;
    handleTimezoneChange: (tz: string) => void;
}) {
    const { data: brand } = useSellerBranding();
    const { profile } = useAuth();
    const { isPlatformSuperAdmin, isSellerAdminOn } = useTenantContext();
    /** Platform Super Admins (and legacy JWT admins) are not on seller/agency tenants, so effective perms on the shop can be empty — do not lock the sidebar. */
    const bypassShopTabCeiling =
        isPlatformSuperAdmin || profile?.role?.toLowerCase() === 'admin';
    const tenantId = selectedAccount?.tenant_id;
    const accountId = shop.account_id;
    const {
        data: mergedCapPerms,
        isLoading: mergedPermsLoading,
    } = useMergedShopEffectivePermissions(tenantId, accountId, {
        enabled: Boolean(tenantId || accountId),
    });
    /** Financial Restrictions tab: seller admins on this shop's tenant, or platform / legacy super-admins — not agency-side roles with users.manage. */
    const canConfigureFinancialRestrictions = Boolean(
        bypassShopTabCeiling ||
            Boolean(selectedAccount?.tenant_id && isSellerAdminOn(selectedAccount.tenant_id)),
    );
    const tabAccess = useMemo(() => {
        if (bypassShopTabCeiling) return null;
        if (!tenantId && !accountId) return null;
        if (mergedPermsLoading) return null;
        return computeShopTabAccess(mergedCapPerms ?? new Set());
    }, [bypassShopTabCeiling, tenantId, accountId, mergedPermsLoading, mergedCapPerms]);

    useEffect(() => {
        if (!tabAccess) return;
        if (!shopTabIsAllowed(activeTab, tabAccess, canConfigureFinancialRestrictions)) {
            setActiveTab(firstAccessibleShopTab(tabAccess, canConfigureFinancialRestrictions));
        }
    }, [activeTab, tabAccess, canConfigureFinancialRestrictions, setActiveTab]);

    const operationalShop = Boolean(
        bypassShopTabCeiling ||
            ((tenantId || accountId) && mergedCapPerms && effectiveHasTiktokShopData(mergedCapPerms)),
    );
    const canPreloadMarketing = Boolean(
        bypassShopTabCeiling ||
            ((tenantId || accountId) && mergedCapPerms && effectiveAllowsMarketingFinanceTab(mergedCapPerms)),
    );

    const fetchNotifications = useNotificationStore((state) => state.fetchNotifications);
    const subscribeToNotifications = useNotificationStore((state) => state.subscribeToNotifications);

    useEffect(() => {
        if (shop?.shop_id) {
            fetchNotifications([shop.shop_id]);
            subscribeToNotifications([shop.shop_id]);
        } else {
            fetchNotifications([]);
            subscribeToNotifications([]);
        }
    }, [shop?.shop_id, fetchNotifications, subscribeToNotifications]);

    useEffect(() => {
        if (!shop?.account_id || !canPreloadMarketing) return undefined;
        const accountId = shop.account_id;
        const { checkConnection, loadMarketingFromDB, subscribeToMarketingUpdates } = useTikTokAdsStore.getState();
        let cancelled = false;
        void checkConnection(accountId).then((isConnected) => {
            if (cancelled || !isConnected) return;
            loadMarketingFromDB(accountId).catch((e) => console.warn('[ShopPage] Marketing preload failed:', e));
        });
        const unsubscribe = subscribeToMarketingUpdates(accountId);
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [shop?.account_id, canPreloadMarketing]);

    useEffect(() => {
        if (!shop?.id || !operationalShop) return undefined;
        const internalShopId = shop.id;
        const channel = supabase
            .channel(`shop-orders-realtime-${internalShopId}`)
            .on('broadcast', { event: 'order_update' }, (payload) => {
                useShopStore.getState().mergeRealtimeOrder(payload.payload);
            })
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'shop_orders',
                    filter: `shop_id=eq.${internalShopId}`,
                },
                (payload) => {
                    if (payload.new && payload.eventType !== 'DELETE') {
                        useShopStore.getState().mergeRealtimeOrder(payload.new);
                    }
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [shop?.id, operationalShop]);

    const [sessionRangeByTab, setSessionRangeByTab] = useState<Partial<Record<ShopSessionRangeTab, DateRange>>>({});

    useEffect(() => {
        setSessionRangeByTab({});
        clearShopTabMountBootstrapFingerprints();
    }, [shop.shop_id]);

    useEffect(() => {
        if (!SHOP_DATA_RANGE_TAB_IDS.has(activeTab)) {
            useShopStore.getState().releaseShopDataFetchForAuxiliaryTab();
        }
    }, [activeTab]);

    if ((tenantId || accountId) && mergedPermsLoading && !bypassShopTabCeiling) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 h-screen brand-bg px-6">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-mamba-green border-t-transparent shrink-0" />
                <p className="text-sm text-gray-400 text-center max-w-xs">Loading access…</p>
            </div>
        );
    }

    /** Same row layout as ConsolePage: without `flex`, sidebar + main stack as blocks and the area beside the sidebar shows the page background (white). */
    return (
        <div className="flex h-screen min-h-0 w-full brand-bg">
            <Sidebar
                mode="shop"
                activeTab={activeTab}
                onTabChange={setActiveTab}
                shopName={shop.shop_name}
                shopTabAccess={tabAccess}
                canConfigureFinancialRestrictions={canConfigureFinancialRestrictions}
                bugReportContext={{
                    accountId: selectedAccount?.id,
                    shopId: shop.shop_id,
                    shopName: shop.shop_name,
                }}
                supportReturnPath={shopSlug ? `/shop/${shopSlug}` : '/'}
            />

            <main className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto brand-bg">
                <div className="p-8">
                    {/* Shop context header */}
                    <div className="mb-6 flex justify-between items-center min-h-[40px]">
                        <div />
                        <div className="brand-muted text-sm flex items-center gap-2">
                            Viewing:{' '}
                            <span className="font-medium" style={{ color: brand.primaryColor }}>
                                {shop.shop_name}
                            </span>
                            <span className="text-gray-500 text-xs">({getTimezoneDisplay(shopTimezone)})</span>
                        </div>
                    </div>

                    <Suspense
                        fallback={
                            <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading tab">
                                <div className="h-10 w-10 animate-spin rounded-full border-2 border-mamba-green border-t-transparent" />
                            </div>
                        }
                    >
                    {(() => {
                        switch (activeTab) {
                            case 'overview':
                                return (
                                    <OverviewView
                                        account={selectedAccount!}
                                        shopId={shop.shop_id}
                                        timezone={shopTimezone}
                                        onTimezoneChange={handleTimezoneChange}
                                        onTabChange={setActiveTab}
                                        sessionDateRange={sessionRangeByTab.overview}
                                        onSessionDateRangeChange={(r) =>
                                            setSessionRangeByTab((prev) => ({ ...prev, overview: r }))
                                        }
                                    />
                                );
                            case 'orders':
                                return (
                                    <OrdersView
                                        account={selectedAccount!}
                                        shopId={shop.shop_id}
                                        timezone={shopTimezone}
                                        preSelectedOrderId={targetOrderId}
                                        onClearSelection={() => setTargetOrderId(undefined)}
                                        sessionDateRange={sessionRangeByTab.orders}
                                        onSessionDateRangeChange={(r) =>
                                            setSessionRangeByTab((prev) => ({ ...prev, orders: r }))
                                        }
                                    />
                                );
                            case 'products':
                                return <ProductsView account={selectedAccount!} shopId={shop.shop_id} />;
                            case 'profit-loss':
                                return (
                                    <ProfitLossView
                                        account={selectedAccount!}
                                        shopId={shop.shop_id}
                                        timezone={shopTimezone}
                                        sessionDateRange={sessionRangeByTab['profit-loss']}
                                        onSessionDateRangeChange={(r) =>
                                            setSessionRangeByTab((prev) => ({ ...prev, 'profit-loss': r }))
                                        }
                                    />
                                );
                            case 'financial-restrictions':
                                return <FinancialRestrictionsView account={selectedAccount!} shopId={shop.shop_id} />;
                            case 'data-audit':
                                return <DataAuditView account={selectedAccount!} shopId={shop.shop_id} timezone={shopTimezone} />;
                            case 'finance-debug':
                                return <FinanceDebugView account={selectedAccount!} shopId={shop.shop_id} timezone={shopTimezone} />;
                            case 'marketing':
                                return (
                                    <MarketingDashboardView
                                        account={selectedAccount!}
                                        shopId={shop.shop_id}
                                        timezone={shopTimezone}
                                        sessionDateRange={sessionRangeByTab.marketing}
                                        onSessionDateRangeChange={(r) =>
                                            setSessionRangeByTab((prev) => ({ ...prev, marketing: r }))
                                        }
                                    />
                                );
                            case 'notifications':
                                return <NotificationsView />;
                            case 'profile':
                                return <ProfileView />;
                            default:
                                return null;
                        }
                    })()}
                    </Suspense>

                    {operationalShop && <NewOrdersToast />}
                    <NotificationToast />
                </div>
            </main>
        </div>
    );
}
