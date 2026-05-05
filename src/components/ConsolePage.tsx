import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { Sidebar } from './Sidebar';
import { HomeConsoleView } from './views/HomeConsoleView';
import { AgencyConsoleView } from './views/AgencyConsoleView';
import { AgencyBrandingView } from './views/AgencyBrandingView';
import { RoleManagementView } from './views/RoleManagementView';
import { MyAccessView } from './views/MyAccessView';
import { PlatformTenantsView } from './views/PlatformTenantsView';
import { AdminDashboard } from './views/AdminDashboard';
import { IngestionMonitoringView } from './views/IngestionMonitoringView';
import { ProfileView } from './views/ProfileView';
import { ConsoleNotificationsView } from './views/ConsoleNotificationsView';
import { ConsoleNotificationToast } from './ConsoleNotificationToast';
import { TeamInvitationStickyToast } from './TeamInvitationStickyToast';
import { useConsoleNotificationStore } from '../store/useConsoleNotificationStore';
import WelcomeScreen from './WelcomeScreen';
import { supabase, type Account } from '../lib/supabase';
import { apiFetch, getApiOrigin } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useTenantContext } from '../contexts/TenantContext';
import { SellerBrandingProvider } from '../contexts/SellerBrandingContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const API_BASE_URL = getApiOrigin();

const CONSOLE_ACTIVE_TAB_KEY = 'console.activeTab';

/** Restored from sessionStorage; must not apply to users without platform admin. */
const PLATFORM_ONLY_CONSOLE_TABS = new Set(['admin-dashboard', 'platform-tenants', 'ingestion-monitoring']);

export function ConsolePage() {
    const { user } = useAuth();
    const {
        isPlatformSuperAdmin,
        memberships,
        loading: tenantLoading,
        hasAgencyAccess,
        manageableAdminTenants,
        profileTenantId,
        sellerFacingBrandingEligible,
        isTenantAccessLocked,
        tenantAccessLockReason,
    } = useTenantContext();
    const queryClient = useQueryClient();

    const [activeTab, setActiveTab] = useState(() => {
        const saved = sessionStorage.getItem(CONSOLE_ACTIVE_TAB_KEY);
        return saved && saved.trim().length > 0 ? saved : 'home';
    });
    const adminTabInitialized = useRef(false);
    const [hasSkippedWelcome, setHasSkippedWelcome] = useState(false);

    useEffect(() => {
        if (isPlatformSuperAdmin && !adminTabInitialized.current) {
            adminTabInitialized.current = true;
            const saved = sessionStorage.getItem(CONSOLE_ACTIVE_TAB_KEY);
            if (!saved) {
                setActiveTab('admin-dashboard');
            }
        }
    }, [isPlatformSuperAdmin]);

    useLayoutEffect(() => {
        if (!user?.id || tenantLoading) return;
        if (!isPlatformSuperAdmin && PLATFORM_ONLY_CONSOLE_TABS.has(activeTab)) {
            setActiveTab('home');
        }
    }, [user?.id, tenantLoading, isPlatformSuperAdmin, activeTab]);

    useEffect(() => {
        sessionStorage.setItem(CONSOLE_ACTIVE_TAB_KEY, activeTab);
    }, [activeTab]);

    const handleConsoleTabChange = (tab: string) => {
        setActiveTab(tab);
    };

    const fetchNotifications = useConsoleNotificationStore((state) => state.fetchNotifications);
    const subscribeToNotifications = useConsoleNotificationStore((state) => state.subscribeToNotifications);
    const unsubscribeFromNotifications = useConsoleNotificationStore((state) => state.unsubscribeFromNotifications);

    useEffect(() => {
        if (user?.id) {
            fetchNotifications(user.id);
            subscribeToNotifications(user.id);
        }
        return () => {
            unsubscribeFromNotifications();
        };
    }, [user?.id, fetchNotifications, subscribeToNotifications, unsubscribeFromNotifications]);

    const {
        data: accounts = [],
        isLoading: isLoadingAccounts,
        isFetched: isAccountsFetched,
    } = useQuery({
        queryKey: ['accounts', user?.id],
        queryFn: async () => {
            if (!user?.id) return [];
            const { data, error } = await supabase
                .from('accounts')
                .select('*')
                .eq('status', 'active')
                .order('is_agency_view', { ascending: false, nullsFirst: false })
                .order('name');
            if (error) throw error;
            return (data || []) as Account[];
        },
        enabled: !!user?.id,
        staleTime: 1000 * 60 * 5,
    });

    useEffect(() => {
        if (isPlatformSuperAdmin) {
            const prefetchAdminData = async () => {
                const {
                    data: { session },
                } = await supabase.auth.getSession();
                const token = session?.access_token;
                if (!token) return;

                const headers = { Authorization: `Bearer ${token}` };

                queryClient.prefetchQuery({
                    queryKey: ['admin-stats'],
                    queryFn: async () => {
                        const res = await fetch(`${API_BASE_URL}/api/admin/stats`, { headers });
                        const data = await res.json();
                        return data.success ? data.data : null;
                    },
                });
            };

            prefetchAdminData();
        }
    }, [isPlatformSuperAdmin, queryClient]);

    const ensureAccountExists = async (): Promise<Account> => {
        try {
            if (!user?.id) throw new Error('User not authenticated');

            const cached = queryClient.getQueryData<Account[]>(['accounts', user.id]);
            if (cached?.length) {
                return cached[0];
            }

            const metaName =
                typeof user.user_metadata?.seller_org_name === 'string'
                    ? user.user_metadata.seller_org_name.trim()
                    : '';
            const displayName = metaName.length > 0 ? metaName : 'New Seller';
            const { data: account, error: rpcError } = await supabase.rpc('create_seller_account_for_user', {
                p_name: displayName,
                p_email: user.email ?? null,
                p_tiktok_handle: null,
            });

            if (rpcError) throw rpcError;
            if (!account) throw new Error('No account returned from create_seller_account_for_user');

            await queryClient.invalidateQueries({ queryKey: ['accounts', user.id] });
            return account;
        } catch (error: any) {
            console.error('Error ensuring account exists:', error);
            throw new Error('Failed to create account record: ' + error.message);
        }
    };

    const handleConnectShop = async () => {
        try {
            const account = await ensureAccountExists();
            const response = await apiFetch('/api/tiktok-shop/auth/start', {
                method: 'POST',
                body: JSON.stringify({ accountId: account.id, accountName: account.name }),
            });
            const data = await response.json();
            if (data.authUrl || data.url) {
                window.location.href = data.authUrl || data.url;
            }
        } catch (error: any) {
            console.error('Error starting auth:', error);
        }
    };

    const handleConnectAgency = async () => {
        try {
            const account = await ensureAccountExists();
            const response = await apiFetch('/api/tiktok-shop/auth/partner/start', {
                method: 'POST',
                body: JSON.stringify({ accountId: account.id, accountName: account.name }),
            });
            const data = await response.json();
            if (data.authUrl || data.url) {
                window.location.href = data.authUrl || data.url;
            }
        } catch (error: any) {
            console.error('Error starting agency auth:', error);
        }
    };

    // Handle TikTok redirect query params
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const tiktokConnected = params.get('tiktok_connected');
        const tiktokError = params.get('tiktok_error');
        const accountId = params.get('account_id');

        if (tiktokConnected === 'true') {
            window.history.replaceState({}, '', window.location.pathname);
            if (accountId) {
                queryClient.invalidateQueries({ queryKey: ['shops', accountId] });
            }
        } else if (tiktokError) {
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, [queryClient]);

    /** Resolve GET /api/branding only for agency JWTs or sellers linked to an agency (see TenantContext). */
    const consoleAgencyBrandingEnabled = sellerFacingBrandingEligible;

    const consoleDocumentTitle = useMemo(() => ({ kind: 'console' as const }), []);

    if (!user?.id || tenantLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent" />
            </div>
        );
    }

    if (isLoadingAccounts && !accounts.length) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent" />
            </div>
        );
    }

    const hasAnyOrgRole = isPlatformSuperAdmin || memberships.length > 0;
    const needsWelcome = !hasSkippedWelcome && !hasAnyOrgRole && accounts.length === 0 && isAccountsFetched;

    if (needsWelcome) {
        return (
            <WelcomeScreen
                onConnect={handleConnectShop}
                onConnectAgency={handleConnectAgency}
                onSkip={() => setHasSkippedWelcome(true)}
                isConnecting={false}
            />
        );
    }

    return (
        <SellerBrandingProvider
            enabled={consoleAgencyBrandingEnabled}
            brandingCacheKey={profileTenantId || '_'}
            documentTitle={consoleAgencyBrandingEnabled ? consoleDocumentTitle : null}
        >
            <div className="flex h-screen brand-bg">
                <Sidebar
                    mode="console"
                    activeTab={activeTab}
                    onTabChange={handleConsoleTabChange}
                />
                <ConsoleNotificationToast />
                <TeamInvitationStickyToast activeTab={activeTab} onOpenNotifications={() => handleConsoleTabChange('notifications')} />

                <main className="flex-1 min-w-0 w-full overflow-y-auto brand-bg relative">
                    {isTenantAccessLocked && (
                        <div className="absolute inset-0 z-20 flex items-start justify-center pointer-events-none p-6">
                            <div className="max-w-2xl w-full rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-100 backdrop-blur-sm">
                                Tenant is {tenantAccessLockReason ?? 'inactive'}.
                                This console is locked until reactivation.
                            </div>
                        </div>
                    )}
                    <div
                        className={`w-full min-w-0 px-4 sm:px-5 lg:px-6 py-4 box-border ${
                            isTenantAccessLocked ? 'pointer-events-none blur-[2px] opacity-60' : ''
                        }`}
                    >
                        {(() => {
                            switch (activeTab) {
                            case 'home':
                                return (
                                    <HomeConsoleView
                                        hasAgencyAccess={hasAgencyAccess}
                                        canManageTeamRoles={manageableAdminTenants.length > 0}
                                        onNavigate={handleConsoleTabChange}
                                        memberships={memberships}
                                        onAddShop={handleConnectShop}
                                    />
                                );
                            case 'agency-console':
                                return <AgencyConsoleView />;
                            case 'agency-branding':
                                return <AgencyBrandingView onNavigate={handleConsoleTabChange} />;
                            case 'my-access':
                                return <MyAccessView />;
                            case 'team-roles':
                                return <RoleManagementView />;
                            case 'platform-tenants':
                                return isPlatformSuperAdmin ? (
                                    <PlatformTenantsView />
                                ) : (
                                    <p className="text-red-400">Platform view requires an internal administrator.</p>
                                );
                            case 'ingestion-monitoring':
                                return isPlatformSuperAdmin ? (
                                    <IngestionMonitoringView />
                                ) : (
                                    <p className="text-red-400">Ingestion monitoring requires a platform administrator.</p>
                                );
                            case 'admin-dashboard':
                                return <AdminDashboard onNavigateToTeamRoles={() => handleConsoleTabChange('team-roles')} />;
                            case 'notifications':
                                return <ConsoleNotificationsView />;
                            case 'profile':
                                return <ProfileView />;
                            default:
                                return (
                                    <HomeConsoleView
                                        hasAgencyAccess={hasAgencyAccess}
                                        canManageTeamRoles={manageableAdminTenants.length > 0}
                                        onNavigate={handleConsoleTabChange}
                                        memberships={memberships}
                                        onAddShop={handleConnectShop}
                                    />
                                );
                            }
                        })()}
                    </div>
                </main>
            </div>
        </SellerBrandingProvider>
    );
}
