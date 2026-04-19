import { useState, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { HomeConsoleView } from './views/HomeConsoleView';
import { AgencyConsoleView } from './views/AgencyConsoleView';
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
import { apiFetch } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useTenantContext } from '../contexts/TenantContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

const FULL_WIDTH_TABS = new Set([
    'home',
    'agency-console',
    'team-roles',
    'my-access',
    'platform-tenants',
    'notifications',
    'ingestion-monitoring',
]);
const CONSOLE_ACTIVE_TAB_KEY = 'console.activeTab';

export function ConsolePage() {
    const { user } = useAuth();
    const {
        isPlatformSuperAdmin,
        memberships,
        loading: tenantLoading,
        hasAgencyAccess,
        manageableAdminTenants,
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

    useEffect(() => {
        sessionStorage.setItem(CONSOLE_ACTIVE_TAB_KEY, activeTab);
    }, [activeTab]);

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

            const { data: existingProfile } = await supabase.from('profiles').select('id').eq('id', user.id).single();

            if (!existingProfile) {
                const { error: profileError } = await supabase.from('profiles').insert({
                    id: user.id,
                    email: user.email,
                    full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
                    role: 'client',
                    updated_at: new Date().toISOString(),
                });
                if (profileError) throw profileError;
            }

            const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'New Seller';
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

    const mainFullWidth = FULL_WIDTH_TABS.has(activeTab);

    return (
        <div className="flex h-screen bg-gray-900">
            <Sidebar mode="console" activeTab={activeTab} onTabChange={setActiveTab} />
            <ConsoleNotificationToast />
            <TeamInvitationStickyToast activeTab={activeTab} onOpenNotifications={() => setActiveTab('notifications')} />

            <main className="flex-1 overflow-y-auto min-w-0 bg-gray-900">
                <div className={mainFullWidth ? 'w-full min-h-full px-4 sm:px-5 lg:px-6 py-4' : 'p-8'}>
                    {(() => {
                        switch (activeTab) {
                            case 'home':
                                return (
                                    <HomeConsoleView
                                        hasAgencyAccess={hasAgencyAccess}
                                        canManageTeamRoles={manageableAdminTenants.length > 0}
                                        onNavigate={setActiveTab}
                                        memberships={memberships}
                                        onAddShop={handleConnectShop}
                                    />
                                );
                            case 'agency-console':
                                return <AgencyConsoleView />;
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
                                return <AdminDashboard onNavigateToTeamRoles={() => setActiveTab('team-roles')} />;
                            case 'notifications':
                                return <ConsoleNotificationsView />;
                            case 'profile':
                                return <ProfileView />;
                            default:
                                return (
                                    <HomeConsoleView
                                        hasAgencyAccess={hasAgencyAccess}
                                        canManageTeamRoles={manageableAdminTenants.length > 0}
                                        onNavigate={setActiveTab}
                                        memberships={memberships}
                                        onAddShop={handleConnectShop}
                                    />
                                );
                        }
                    })()}
                </div>
            </main>
        </div>
    );
}
