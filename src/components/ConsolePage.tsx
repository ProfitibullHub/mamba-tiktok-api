import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { HomeConsoleView } from './views/HomeConsoleView';
import { AgencyConsoleView } from './views/AgencyConsoleView';
import { AgencyBrandingView } from './views/AgencyBrandingView';
import { RoleManagementView } from './views/RoleManagementView';
import { AgencyTasksView } from './views/AgencyTasksView';
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
import {
    useMyEffectivePermissions,
    effectiveAllowsTasksBoard,
    fetchMyEffectivePermissionsOnTenant,
} from '../hooks/useMyEffectivePermissions';
import { SellerBrandingProvider } from '../contexts/SellerBrandingContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CONSOLE_TASK_TAB, isAgencyTaskId } from '../lib/taskDeepLinks';

const API_BASE_URL = getApiOrigin();

const CONSOLE_ACTIVE_TAB_KEY = 'console.activeTab';

/** Restored from sessionStorage; must not apply to users without platform admin. */
const PLATFORM_ONLY_CONSOLE_TABS = new Set(['admin-dashboard', 'platform-tenants', 'ingestion-monitoring']);

export function ConsolePage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { user } = useAuth();
    const {
        isPlatformSuperAdmin,
        memberships,
        loading: tenantLoading,
        hasAgencyAccess,
        manageableAdminTenants,
        profileTenantId,
        profileTenantType,
        agencyMemberships,
        sellerFacingBrandingEligible,
        isTenantAccessLocked,
        tenantAccessLockReason,
    } = useTenantContext();
    const queryClient = useQueryClient();

    const agencyTenantForTasksNav = useMemo(
        () =>
            profileTenantType === 'agency' && profileTenantId
                ? profileTenantId
                : agencyMemberships.filter((m) => m.status === 'active')[0]?.tenant_id ?? null,
        [agencyMemberships, profileTenantId, profileTenantType],
    );

    const { data: taskNavPerms } = useMyEffectivePermissions(agencyTenantForTasksNav, {
        enabled: Boolean(hasAgencyAccess && agencyTenantForTasksNav),
    });

    const showTeamTasksBoard =
        Boolean(hasAgencyAccess && taskNavPerms && effectiveAllowsTasksBoard(taskNavPerms));

    const [activeTab, setActiveTab] = useState(() => {
        try {
            const sp = new URLSearchParams(window.location.search);
            if (sp.get('tab') === CONSOLE_TASK_TAB) return 'tasks';
        } catch {
            /* ignore */
        }
        const saved = sessionStorage.getItem(CONSOLE_ACTIVE_TAB_KEY);
        return saved && saved.trim().length > 0 ? saved : 'home';
    });
    const adminTabInitialized = useRef(false);
    const [hasSkippedWelcome, setHasSkippedWelcome] = useState(false);
    const [connectShopBusy, setConnectShopBusy] = useState(false);
    const [connectShopError, setConnectShopError] = useState<string | null>(null);

    const sellerMembershipTenantIds = useMemo(
        () =>
            memberships
                .filter((m) => m.status === 'active' && m.tenants?.type === 'seller')
                .map((m) => m.tenant_id),
        [memberships],
    );

    const connectPermissionTenantIds = useMemo(() => {
        const ids = new Set<string>(sellerMembershipTenantIds);
        if (profileTenantId && profileTenantType === 'seller') ids.add(profileTenantId);
        return [...ids];
    }, [sellerMembershipTenantIds, profileTenantId, profileTenantType]);

    const { data: canConnectShop = false } = useQuery({
        queryKey: ['can-connect-tiktok-shop', user?.id, connectPermissionTenantIds],
        queryFn: async () => {
            if (isPlatformSuperAdmin) return true;
            for (const tenantId of connectPermissionTenantIds) {
                const perms = await fetchMyEffectivePermissionsOnTenant(tenantId);
                if (perms.has('tiktok.auth')) return true;
            }
            return false;
        },
        enabled: Boolean(user?.id) && (isPlatformSuperAdmin || connectPermissionTenantIds.length > 0),
        staleTime: 60_000,
    });

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
        if (activeTab === 'tasks' && !showTeamTasksBoard) {
            setActiveTab('home');
        }
    }, [user?.id, tenantLoading, isPlatformSuperAdmin, activeTab, showTeamTasksBoard]);

    /** Deep links e.g. `/?tab=tasks&taskId=<uuid>` from messaging or bookmarks. */
    useEffect(() => {
        if (!showTeamTasksBoard) return;
        if (searchParams.get('tab') === CONSOLE_TASK_TAB) {
            setActiveTab('tasks');
        }
    }, [searchParams, showTeamTasksBoard]);

    useEffect(() => {
        sessionStorage.setItem(CONSOLE_ACTIVE_TAB_KEY, activeTab);
    }, [activeTab]);

    const handleConsoleTabChange = useCallback(
        (tab: string) => {
            setActiveTab(tab);
            if (tab !== 'tasks') {
                setSearchParams(
                    (prev) => {
                        const next = new URLSearchParams(prev);
                        next.delete('tab');
                        next.delete('taskId');
                        return next;
                    },
                    { replace: true },
                );
            }
        },
        [setSearchParams],
    );

    const onConsumeTaskDeepLink = useCallback(() => {
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.delete('taskId');
                return next;
            },
            { replace: true },
        );
    }, [setSearchParams]);

    const deepLinkTaskId =
        activeTab === 'tasks' && showTeamTasksBoard ?
            (() => {
                const raw = searchParams.get('taskId');
                return isAgencyTaskId(raw) ? raw : null;
            })()
        :   null;

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

    const resolveAccountForTikTokConnect = async (pool: Account[]): Promise<Account | null> => {
        const tenantIds: string[] = [];
        if (profileTenantId && profileTenantType === 'seller') tenantIds.push(profileTenantId);
        for (const id of sellerMembershipTenantIds) {
            if (!tenantIds.includes(id)) tenantIds.push(id);
        }
        for (const tid of tenantIds) {
            const { data: accountId, error } = await supabase.rpc('get_seller_account_id', {
                p_seller_tenant_id: tid,
            });
            if (error) {
                console.warn('[Console] get_seller_account_id', error.message);
                continue;
            }
            if (typeof accountId === 'string') {
                const hit = pool.find((a) => a.id === accountId);
                if (hit) return hit;
            }
        }
        const nonAgency = pool.find((a) => !a.is_agency_view);
        if (nonAgency) return nonAgency;
        return pool[0] ?? null;
    };

    const ensureAccountExists = async (): Promise<Account> => {
        try {
            if (!user?.id) throw new Error('User not authenticated');

            const cached =
                queryClient.getQueryData<Account[]>(['accounts', user.id]) ??
                (accounts.length > 0 ? accounts : undefined);
            if (cached?.length) {
                const resolved = await resolveAccountForTikTokConnect(cached);
                if (resolved) return resolved;
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
        setConnectShopError(null);
        setConnectShopBusy(true);
        try {
            const account = await ensureAccountExists();
            const response = await apiFetch('/api/tiktok-shop/auth/start', {
                method: 'POST',
                body: JSON.stringify({ accountId: account.id, accountName: account.name }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(
                    typeof data.error === 'string'
                        ? data.error
                        : `Could not start TikTok connection (${response.status})`,
                );
            }
            const authUrl = data.authUrl || data.url;
            if (!authUrl) {
                throw new Error('No authorization URL returned from server');
            }
            window.location.href = authUrl;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Could not connect TikTok Shop';
            console.error('Error starting auth:', error);
            setConnectShopError(msg);
        } finally {
            setConnectShopBusy(false);
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
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-mamba-green border-t-transparent" />
            </div>
        );
    }

    if (isLoadingAccounts && !accounts.length) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-mamba-green border-t-transparent" />
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
                    showTeamTasksBoard={showTeamTasksBoard}
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
                                        canConnectShop={canConnectShop}
                                        connectShopError={connectShopError}
                                        connectShopBusy={connectShopBusy}
                                    />
                                );
                            case 'agency-console':
                                return <AgencyConsoleView />;
                            case 'tasks':
                                return (
                                    <AgencyTasksView
                                        deepLinkTaskId={deepLinkTaskId}
                                        onConsumeTaskDeepLink={onConsumeTaskDeepLink}
                                    />
                                );
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
                                        canConnectShop={canConnectShop}
                                        connectShopError={connectShopError}
                                        connectShopBusy={connectShopBusy}
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
