import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { NewOrdersToast } from './NewOrdersToast';
import { NotificationToast } from './NotificationToast';
import { OverviewView } from './views/OverviewView';
import { ProfitLossView } from './views/ProfitLossView';
import { OrdersView } from './views/OrdersView';
import { ProductsView } from './views/ProductsView';
import { FinanceDebugView } from './views/FinanceDebugView';
import { DataAuditView } from './views/DataAuditView';
import { MarketingDashboardView } from './views/MarketingDashboardView';
import { NotificationsView } from './views/NotificationsView';
import { ProfileView } from './views/ProfileView';
import { FinancialRestrictionsView } from './views/FinancialRestrictionsView';
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
import { getDateRangeFromPreset } from '../utils/dateUtils';
import { AlertTriangle, Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { VisibleShop } from './views/HomeConsoleView';
import { UnauthorizedShopAccess } from './UnauthorizedShopAccess';
import {
    SellerBrandingProvider,
    SELLER_FACING_BRANDING_QK,
    useSellerBranding,
} from '../contexts/SellerBrandingContext';

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
    const plPrefetchKeyRef = useRef<string | null>(null);

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
        queryKey: [SELLER_FACING_BRANDING_QK, brandingCacheKey],
        queryFn: fetchBranding,
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

    const dashboardReady = Boolean(
        shop &&
            shop.account_id &&
            accessAllowed === true &&
            !accessLoading &&
            !awaitingSlugResolution &&
            !tenantLoading &&
            brandingGateDone &&
            !isTenantAccessLocked,
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

    // Warm the P&L default range as soon as the shop shell mounts (next macrotask) so refresh triggers prefetch immediately.
    // Overview keeps its own 1-day date range; these shared store loads are filtered per view.
    useEffect(() => {
        if (!dashboardReady || !shop?.shop_id || !selectedAccount?.id) return;

        const range = getDateRangeFromPreset('last30', shopTimezone);
        const prefetchKey = `${selectedAccount.id}:${shop.shop_id}:${range.startDate}:${range.endDate}:${shopTimezone}`;
        if (plPrefetchKeyRef.current === prefetchKey) return;
        plPrefetchKeyRef.current = prefetchKey;

        const timer = window.setTimeout(() => {
            const store = useShopStore.getState();
            void store.fetchShopData(
                selectedAccount.id,
                shop.shop_id,
                { skipSyncCheck: true, timezone: shopTimezone },
                range.startDate,
                range.endDate,
            );
            void store.fetchPLData(selectedAccount.id, shop.shop_id, range.startDate, range.endDate, false, shopTimezone);
            void store.fetchAffiliateSettlements(selectedAccount.id, shop.shop_id, range.startDate, range.endDate);
            void store.fetchAgencyFees(selectedAccount.id, shop.shop_id, range.startDate, range.endDate);
        }, 0);

        return () => window.clearTimeout(timer);
    }, [dashboardReady, selectedAccount?.id, shop?.shop_id, shopTimezone]);

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

    // Notifications
    const fetchNotifications = useNotificationStore((state) => state.fetchNotifications);
    const subscribeToNotifications = useNotificationStore((state) => state.subscribeToNotifications);

    useEffect(() => {
        if (dashboardReady && shop?.shop_id) {
            fetchNotifications([shop.shop_id]);
            subscribeToNotifications([shop.shop_id]);
        } else {
            fetchNotifications([]);
            subscribeToNotifications([]);
        }
    }, [dashboardReady, shop?.shop_id, fetchNotifications, subscribeToNotifications]);

    // Marketing preload
    useEffect(() => {
        if (!dashboardReady || !shop?.account_id) return;
        const accountId = shop.account_id;
        const { checkConnection, loadMarketingFromDB, subscribeToMarketingUpdates } = useTikTokAdsStore.getState();

        checkConnection(accountId).then((isConnected) => {
            if (isConnected) {
                loadMarketingFromDB(accountId).catch((e) => console.warn('[ShopPage] Marketing preload failed:', e));
            }
        });

        const unsubscribe = subscribeToMarketingUpdates(accountId);
        return unsubscribe;
    }, [dashboardReady, shop?.account_id]);

    // Realtime order subscription
    useEffect(() => {
        const internalShopId = dashboardReady ? shop?.id : undefined;
        if (!internalShopId) return;

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
    }, [dashboardReady, shop?.id]);

    if (!user?.id) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent" />
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
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-pink-600 hover:bg-pink-500 text-white rounded-xl text-sm font-medium"
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
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-pink-600 hover:bg-pink-500 text-white rounded-xl text-sm font-medium"
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
            documentTitle={shopDocumentTitle}
        >
            <ShopShell
                shop={shop}
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
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent shrink-0" />
            <p className="text-sm text-gray-400 text-center max-w-xs">{label}</p>
        </div>
    );
}

/** Inner shell — runs inside SellerBrandingProvider so it can read brand CSS vars. */
function ShopShell({
    shop,
    activeTab,
    setActiveTab,
    shopTimezone,
    selectedAccount,
    targetOrderId,
    setTargetOrderId,
    handleTimezoneChange,
}: {
    shop: VisibleShop;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    shopTimezone: string;
    selectedAccount: import('../lib/supabase').Account | null;
    targetOrderId: string | undefined;
    setTargetOrderId: (id: string | undefined) => void;
    handleTimezoneChange: (tz: string) => void;
}) {
    const { data: brand } = useSellerBranding();
    const { isSellerAdminOn } = useTenantContext();
    const canConfigureFinancialRestrictions = Boolean(
        selectedAccount?.tenant_id && isSellerAdminOn(selectedAccount.tenant_id)
    );

    /** Same row layout as ConsolePage: without `flex`, sidebar + main stack as blocks and the area beside the sidebar shows the page background (white). */
    return (
        <div className="flex h-screen min-h-0 w-full brand-bg">
            <Sidebar
                mode="shop"
                activeTab={activeTab}
                onTabChange={setActiveTab}
                shopName={shop.shop_name}
                canConfigureFinancialRestrictions={canConfigureFinancialRestrictions}
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
                                    />
                                );
                            case 'products':
                                return <ProductsView account={selectedAccount!} shopId={shop.shop_id} />;
                            case 'profit-loss':
                                return <ProfitLossView account={selectedAccount!} shopId={shop.shop_id} timezone={shopTimezone} />;
                            case 'financial-restrictions':
                                return <FinancialRestrictionsView account={selectedAccount!} />;
                            case 'data-audit':
                                return <DataAuditView account={selectedAccount!} shopId={shop.shop_id} timezone={shopTimezone} />;
                            case 'finance-debug':
                                return <FinanceDebugView account={selectedAccount!} shopId={shop.shop_id} timezone={shopTimezone} />;
                            case 'marketing':
                                return <MarketingDashboardView account={selectedAccount!} shopId={shop.shop_id} timezone={shopTimezone} />;
                            case 'notifications':
                                return <NotificationsView />;
                            case 'profile':
                                return <ProfileView />;
                            default:
                                return (
                                    <OverviewView
                                        account={selectedAccount!}
                                        shopId={shop.shop_id}
                                        timezone={shopTimezone}
                                        onTimezoneChange={handleTimezoneChange}
                                        onTabChange={setActiveTab}
                                    />
                                );
                        }
                    })()}

                    <NewOrdersToast />
                    <NotificationToast />
                </div>
            </main>
        </div>
    );
}
