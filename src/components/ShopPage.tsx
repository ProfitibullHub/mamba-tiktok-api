import { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { SyncProgressBar } from './SyncProgressBar';
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
import { type Account, supabase } from '../lib/supabase';
import { matchesSlug } from '../utils/slugify';
import { useAuth } from '../contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useShopStore } from '../store/useShopStore';
import { useNotificationStore } from '../store/useNotificationStore';
import { useTikTokAdsStore } from '../store/useTikTokAdsStore';
import { getTimezoneDisplay } from '../utils/timezoneMapping';
import { AlertTriangle, Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { VisibleShop } from './views/HomeConsoleView';
import { UnauthorizedShopAccess } from './UnauthorizedShopAccess';

export function ShopPage() {
    const { shopSlug } = useParams<{ shopSlug: string }>();
    const location = useLocation();
    const { user } = useAuth();
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
        enabled: Boolean(shopSlug && user?.id),
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
        enabled: Boolean(user?.id && shop?.account_id),
        staleTime: 30_000,
    });

    const canMountShop = Boolean(shop && accessAllowed === true);
    const accessDenied = Boolean(
        shop && !accessLoading && (accessCheckError || accessAllowed === false),
    );

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
        if (canMountShop && shop?.shop_id) {
            fetchNotifications([shop.shop_id]);
            subscribeToNotifications([shop.shop_id]);
        } else {
            fetchNotifications([]);
            subscribeToNotifications([]);
        }
    }, [canMountShop, shop?.shop_id, fetchNotifications, subscribeToNotifications]);

    // Marketing preload
    useEffect(() => {
        if (!canMountShop || !shop?.account_id) return;
        const accountId = shop.account_id;
        const { checkConnection, loadMarketingFromDB, subscribeToMarketingUpdates } = useTikTokAdsStore.getState();

        checkConnection(accountId).then((isConnected) => {
            if (isConnected) {
                loadMarketingFromDB(accountId).catch((e) => console.warn('[ShopPage] Marketing preload failed:', e));
            }
        });

        const unsubscribe = subscribeToMarketingUpdates(accountId);
        return unsubscribe;
    }, [canMountShop, shop?.account_id]);

    // Realtime order subscription
    useEffect(() => {
        const internalShopId = canMountShop ? shop?.id : undefined;
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
    }, [canMountShop, shop?.id]);

    if (!user?.id) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent" />
            </div>
        );
    }

    if (loadingShop && !passedShop) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent" />
            </div>
        );
    }

    if (shop && !shop.account_id) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="text-center max-w-md">
                    <AlertTriangle className="w-14 h-14 text-yellow-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Shop not found</h2>
                    <p className="text-gray-400 text-sm mb-6">
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

    if (shop && accessLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent" />
            </div>
        );
    }

    if (accessDenied) {
        return <UnauthorizedShopAccess attemptedLabel={shopSlug} />;
    }

    if (!shop) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="text-center max-w-md">
                    <AlertTriangle className="w-14 h-14 text-yellow-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Shop not found</h2>
                    <p className="text-gray-400 text-sm mb-6">
                        No shop matching <span className="text-white font-medium">{shopSlug}</span> was found, or you don't have access to it.
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
        <div className="flex h-screen bg-gray-900">
            <Sidebar mode="shop" activeTab={activeTab} onTabChange={setActiveTab} shopName={shop.shop_name} />

            <main className="flex-1 overflow-y-auto min-w-0 bg-gray-900">
                <div className="p-8">
                    {/* Shop context header */}
                    <div className="mb-6 flex justify-between items-center min-h-[40px]">
                        <div />
                        <div className="text-gray-400 text-sm flex items-center gap-2">
                            Viewing: <span className="text-white font-medium">{shop.shop_name}</span>
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

                    <SyncProgressBar />
                    <NewOrdersToast />
                    <NotificationToast />
                </div>
            </main>
        </div>
    );
}
