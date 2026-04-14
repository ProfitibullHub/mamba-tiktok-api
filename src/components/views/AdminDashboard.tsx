import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, useEffect, useRef } from 'react';
import {
    Users, Store, Building2, ShoppingBag, Shield, BarChart3, Crown,
    Search, RefreshCw, ExternalLink, ChevronRight, X, Calculator, Wallet,
    Globe, MoreVertical, Ban, Unlock, KeyRound, Trash2, UserX, AlertTriangle, Copy, Check, Pencil,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTenantContext } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { adminPatchTenant, adminDeleteTenant } from '../../lib/adminTenantsApi';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

type StatsData = {
    totalUsers: number;
    totalStores: number;
    agencies: number;
    sellers: number;
    totalTenants: number;
    totalMemberships: number;
    superAdminCount: number;
    roleDistribution: { role_name: string; count: number }[];
};

type Membership = { role_name: string | null; tenant_name: string | null; tenant_type: string | null };
type AdminUser = {
    id: string;
    email: string;
    full_name: string;
    created_at: string;
    memberships: Membership[];
    shops: { id: string; shop_name: string }[];
    shop_count: number;
    is_banned?: boolean;
};

type TenantRow = {
    id: string;
    name: string;
    type: 'agency' | 'seller';
    status: string;
    created_at: string;
    parent_agency_name: string | null;
    member_count: number;
    linked_sellers?: number;
    shop_count: number;
    owner_name: string;
    members: { user_id: string; role_name: string | null; full_name: string | null; email: string | null }[];
};

type MembershipRow = {
    id: string;
    user_id: string;
    role_name: string;
    tenant_name: string;
    tenant_type: string;
    full_name: string;
    email: string;
    created_at: string;
};

type DrillView = 'users' | 'stores' | 'agencies' | 'sellers' | 'memberships' | 'superadmins';

const membershipColor = (m: Membership) => {
    if (m.role_name === 'Super Admin') return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    if (m.tenant_type === 'agency') return 'bg-violet-500/20 text-violet-300 border-violet-500/30';
    return 'bg-pink-500/20 text-pink-300 border-pink-500/30';
};

async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}` };
}

async function fetchApi<T>(path: string): Promise<T> {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE_URL}${path}`, { headers });
    const data = await res.json();
    if (data.success) return data.data;
    throw new Error(data.error);
}

type AdminStoresPayload = {
    accounts: any[];
    metricsWindow?: { kind: string; description: string };
};

async function fetchAdminStores(): Promise<AdminStoresPayload> {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE_URL}/api/admin/stores`, { headers });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return {
        accounts: Array.isArray(data.data) ? data.data : [],
        metricsWindow: data.metricsWindow,
    };
}

async function adminDelete(path: string): Promise<unknown> {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE_URL}${path}`, { method: 'DELETE', headers });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.data;
}

async function adminPost(path: string): Promise<unknown> {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.data;
}

export function AdminDashboard({ onNavigateToTeamRoles }: { onNavigateToTeamRoles?: () => void }) {
    const { isPlatformSuperAdmin } = useTenantContext();
    const queryClient = useQueryClient();
    const [drillView, setDrillView] = useState<DrillView>('users');
    const [search, setSearch] = useState('');
    const [selectedAccount, setSelectedAccount] = useState<any>(null);
    const [selectedShopForPL, setSelectedShopForPL] = useState<any>(null);

    const { data: stats, isLoading: statsLoading } = useQuery<StatsData>({
        queryKey: ['admin-stats'],
        queryFn: () => fetchApi('/api/admin/stats'),
        enabled: isPlatformSuperAdmin,
    });

    const { data: users, isLoading: usersLoading } = useQuery<AdminUser[]>({
        queryKey: ['admin-users'],
        queryFn: () => fetchApi('/api/admin/users'),
        enabled: isPlatformSuperAdmin && (drillView === 'users' || drillView === 'superadmins'),
    });

    const { data: tenants, isLoading: tenantsLoading } = useQuery<TenantRow[]>({
        queryKey: ['admin-tenants'],
        queryFn: () => fetchApi('/api/admin/tenants'),
        enabled: isPlatformSuperAdmin && (drillView === 'agencies' || drillView === 'sellers'),
    });

    const { data: storesPayload, isLoading: storesLoading } = useQuery({
        queryKey: ['admin-stores'],
        queryFn: fetchAdminStores,
        enabled: isPlatformSuperAdmin && drillView === 'stores',
    });
    const accounts = storesPayload?.accounts;
    const storesMetricsWindow = storesPayload?.metricsWindow;

    const { data: membershipsData, isLoading: membershipsLoading } = useQuery<MembershipRow[]>({
        queryKey: ['admin-memberships'],
        queryFn: () => fetchApi('/api/admin/memberships'),
        enabled: isPlatformSuperAdmin && drillView === 'memberships',
    });

    const syncProfilesMutation = useMutation({
        mutationFn: async () => {
            const headers = await authHeaders();
            const res = await fetch(`${API_BASE_URL}/api/admin/sync-profiles`, { method: 'POST', headers });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            return data.data;
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    });

    const filteredUsers = useMemo(() => {
        if (!users) return [];
        let list = users;
        if (drillView === 'superadmins') {
            list = list.filter((u) =>
                u.memberships.some((m) => m.role_name === 'Super Admin')
            );
        }
        if (!search.trim()) return list;
        const q = search.toLowerCase();
        return list.filter((u) =>
            u.full_name?.toLowerCase().includes(q) ||
            u.email?.toLowerCase().includes(q) ||
            u.id.toLowerCase().includes(q)
        );
    }, [users, search, drillView]);

    const filteredTenants = useMemo(() => {
        if (!tenants) return [];
        let list = tenants;
        if (drillView === 'agencies') list = list.filter((t) => t.type === 'agency');
        else if (drillView === 'sellers') list = list.filter((t) => t.type === 'seller');
        if (!search.trim()) return list;
        const q = search.toLowerCase();
        return list.filter((t) =>
            t.name?.toLowerCase().includes(q) ||
            t.owner_name?.toLowerCase().includes(q) ||
            t.parent_agency_name?.toLowerCase().includes(q)
        );
    }, [tenants, search, drillView]);

    const filteredStores = useMemo(() => {
        if (!accounts) return [];
        const list = accounts;
        if (!search.trim()) return list;
        const q = search.toLowerCase();
        return list.filter((a: any) =>
            a.account_name?.toLowerCase().includes(q) ||
            a.tenant_name?.toLowerCase().includes(q) ||
            a.stores?.some((s: any) => s.shop_name?.toLowerCase().includes(q))
        );
    }, [accounts, search]);

    const filteredMemberships = useMemo(() => {
        if (!membershipsData) return [];
        if (!search.trim()) return membershipsData;
        const q = search.toLowerCase();
        return membershipsData.filter((m) =>
            m.full_name?.toLowerCase().includes(q) ||
            m.email?.toLowerCase().includes(q) ||
            m.role_name?.toLowerCase().includes(q) ||
            m.tenant_name?.toLowerCase().includes(q)
        );
    }, [membershipsData, search]);

    if (statsLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent" />
            </div>
        );
    }

    const allCards: { key: DrillView; label: string; value: number; icon: typeof Users; color: string; glow: string }[] = [
        { key: 'users', label: 'Total Users', value: stats?.totalUsers ?? 0, icon: Users, color: 'text-blue-400', glow: 'from-blue-500/20' },
        { key: 'agencies', label: 'Agencies', value: stats?.agencies ?? 0, icon: Building2, color: 'text-violet-400', glow: 'from-violet-500/20' },
        { key: 'sellers', label: 'Seller Tenants', value: stats?.sellers ?? 0, icon: Store, color: 'text-pink-400', glow: 'from-pink-500/20' },
        { key: 'stores', label: 'Connected Shops', value: stats?.totalStores ?? 0, icon: ShoppingBag, color: 'text-emerald-400', glow: 'from-emerald-500/20' },
        { key: 'memberships', label: 'Active Memberships', value: stats?.totalMemberships ?? 0, icon: Shield, color: 'text-cyan-400', glow: 'from-cyan-500/20' },
        { key: 'superadmins', label: 'Super Admins', value: stats?.superAdminCount ?? 0, icon: Crown, color: 'text-amber-400', glow: 'from-amber-500/20' },
    ];

    const roleColors: Record<string, string> = {
        'Super Admin': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        'Agency Admin': 'bg-violet-500/20 text-violet-300 border-violet-500/30',
        'Account Manager': 'bg-violet-500/15 text-violet-300/80 border-violet-500/20',
        'Account Coordinator': 'bg-violet-500/10 text-violet-300/70 border-violet-500/15',
        'Seller Admin': 'bg-pink-500/20 text-pink-300 border-pink-500/30',
        'Seller User': 'bg-pink-500/10 text-pink-300/70 border-pink-500/15',
    };

    const drillLabels: Record<DrillView, string> = {
        users: 'All Users',
        agencies: 'Agency Tenants',
        sellers: 'Seller Tenants',
        stores: 'Connected Shops',
        memberships: 'Active Memberships',
        superadmins: 'Super Admins',
    };

    const handleCardClick = (key: DrillView) => {
        setSearch('');
        setDrillView(key);
    };

    const isLoading =
        (drillView === 'users' || drillView === 'superadmins') ? usersLoading :
        (drillView === 'agencies' || drillView === 'sellers') ? tenantsLoading :
        drillView === 'stores' ? storesLoading :
        drillView === 'memberships' ? membershipsLoading :
        false;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 relative">
            <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-fuchsia-500/10 via-pink-500/5 to-transparent -z-10 rounded-full blur-[100px] opacity-50 pointer-events-none" />

            <div>
                <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-pink-100 to-white flex items-center gap-4">
                    <div className="p-2.5 bg-pink-500/10 rounded-2xl border border-pink-500/20 backdrop-blur-xl">
                        <BarChart3 className="w-8 h-8 text-pink-400 drop-shadow-lg" />
                    </div>
                    Admin Dashboard
                </h1>
                <p className="text-gray-400/90 mt-4 text-base max-w-2xl leading-relaxed">
                    Platform overview across all tenants, users, and connected TikTok shops.
                </p>
            </div>

            {/* All stat cards — always visible, all clickable */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {allCards.map((card) => {
                    const active = drillView === card.key;
                    return (
                        <button
                            key={card.key}
                            onClick={() => handleCardClick(card.key)}
                            className={`text-left bg-white/[0.02] border rounded-2xl p-5 backdrop-blur-md relative overflow-hidden group transition-all
                                ${active
                                    ? 'border-white/30 ring-2 ring-white/10 shadow-lg shadow-white/5'
                                    : 'border-white/10 hover:border-white/20'
                                }`}
                        >
                            <div className={`absolute inset-0 bg-gradient-to-br ${card.glow} to-transparent ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity pointer-events-none`} />
                            <div className="relative z-10">
                                <div className={`p-2 rounded-xl bg-white/5 border border-white/10 w-fit mb-3 ${active ? 'border-white/20' : 'group-hover:border-white/20'} transition-colors`}>
                                    <card.icon className={`w-5 h-5 ${card.color}`} />
                                </div>
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider leading-tight">{card.label}</p>
                                <h3 className="text-2xl font-extrabold text-white mt-0.5">{card.value.toLocaleString()}</h3>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Role distribution — compact inline */}
            {stats?.roleDistribution && stats.roleDistribution.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider mr-1">Roles:</span>
                    {stats.roleDistribution.map((r) => (
                        <span key={r.role_name} className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${roleColors[r.role_name] ?? 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                            {r.role_name} <span className="text-white/60 ml-1">{r.count}</span>
                        </span>
                    ))}
                </div>
            )}

            {/* Drill-down panel */}
            <div className="animate-in slide-in-from-top-4 fade-in duration-300">
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                        {drillLabels[drillView]}
                        {!isLoading && (
                            <span className="text-sm font-normal text-gray-500">
                                ({drillView === 'users' ? filteredUsers.length :
                                  drillView === 'superadmins' ? filteredUsers.length :
                                  (drillView === 'agencies' || drillView === 'sellers') ? filteredTenants.length :
                                  drillView === 'stores' ? filteredStores.length :
                                  drillView === 'memberships' ? filteredMemberships.length : 0} results)
                            </span>
                        )}
                    </h2>

                    <div className="flex items-center gap-2">
                        {(drillView === 'users' || drillView === 'superadmins') && onNavigateToTeamRoles && (
                            <button
                                onClick={onNavigateToTeamRoles}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white transition-all"
                            >
                                <ExternalLink className="w-4 h-4" /> Team & roles
                            </button>
                        )}
                        {(drillView === 'users' || drillView === 'superadmins') && (
                            <button
                                onClick={() => syncProfilesMutation.mutate()}
                                disabled={syncProfilesMutation.isPending}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-lg shadow-pink-500/20 hover:shadow-pink-500/40 transition-all disabled:opacity-50"
                            >
                                <RefreshCw className={`w-4 h-4 ${syncProfilesMutation.isPending ? 'animate-spin' : ''}`} />
                                Sync
                            </button>
                        )}
                    </div>
                </div>

                {/* Search bar */}
                <div className="relative max-w-md mb-5">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search…"
                        className="w-full pl-11 pr-4 py-3 bg-gray-950/80 border border-white/10 rounded-2xl text-white text-sm placeholder-gray-600 shadow-inner focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-500/40 transition-all"
                    />
                </div>

                {syncProfilesMutation.isSuccess && (drillView === 'users' || drillView === 'superadmins') && (
                    <div className="px-5 py-3 mb-5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400 text-sm font-medium">
                        Synced {syncProfilesMutation.data?.synced ?? 0} profiles.
                    </div>
                )}

                {isLoading ? (
                    <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-8 w-8 border-3 border-pink-500 border-t-transparent" />
                    </div>
                ) : (
                    <>
                        {(drillView === 'users' || drillView === 'superadmins') && (
                            <UsersTable users={filteredUsers} search={search} />
                        )}
                        {(drillView === 'agencies' || drillView === 'sellers') && (
                            <TenantsTable
                                tenants={filteredTenants}
                                search={search}
                                drillView={drillView}
                                showSuperAdminActions={isPlatformSuperAdmin}
                            />
                        )}
                        {drillView === 'stores' && (
                            <StoresTable
                                accounts={filteredStores}
                                search={search}
                                metricsWindow={storesMetricsWindow}
                                onShowAllStores={setSelectedAccount}
                                onShowPL={setSelectedShopForPL}
                            />
                        )}
                        {drillView === 'memberships' && (
                            <MembershipsTable memberships={filteredMemberships} search={search} />
                        )}
                    </>
                )}
            </div>

            {/* Modals */}
            {selectedAccount && (
                <AllStoresModal account={selectedAccount} onClose={() => setSelectedAccount(null)} onShowPL={setSelectedShopForPL} />
            )}
            {selectedShopForPL && (
                <PLBreakdownModal shop={selectedShopForPL} onClose={() => setSelectedShopForPL(null)} />
            )}
        </div>
    );
}

/* ═══════════════════ Users table ═══════════════════ */

function UsersTable({ users, search }: { users: AdminUser[]; search: string }) {
    const { user: currentUser } = useAuth();
    const queryClient = useQueryClient();
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [confirm, setConfirm] = useState<null | { type: 'delete' | 'revoke'; target: AdminUser }>(null);
    const [toast, setToast] = useState<null | { kind: 'ok' | 'err'; msg: string }>(null);

    useEffect(() => {
        const close = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
        };
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, []);

    const invalidateAdmin = () => {
        queryClient.invalidateQueries({ queryKey: ['admin-users'] });
        queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
        queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
        queryClient.invalidateQueries({ queryKey: ['admin-memberships'] });
        queryClient.invalidateQueries({ queryKey: ['admin-stores'] });
    };

    const deleteMut = useMutation({
        mutationFn: (id: string) => adminDelete(`/api/admin/users/${id}`),
        onSuccess: () => {
            invalidateAdmin();
            setToast({ kind: 'ok', msg: 'User deleted.' });
            setConfirm(null);
        },
        onError: (e: Error) => setToast({ kind: 'err', msg: e.message }),
    });

    const revokeMut = useMutation({
        mutationFn: (id: string) => adminPost(`/api/admin/users/${id}/revoke-memberships`),
        onSuccess: () => {
            invalidateAdmin();
            setToast({ kind: 'ok', msg: 'All tenant memberships removed.' });
            setConfirm(null);
        },
        onError: (e: Error) => setToast({ kind: 'err', msg: e.message }),
    });

    const suspendMut = useMutation({
        mutationFn: (id: string) => adminPost(`/api/admin/users/${id}/suspend`),
        onSuccess: () => {
            invalidateAdmin();
            setToast({ kind: 'ok', msg: 'User suspended.' });
            setOpenMenuId(null);
        },
        onError: (e: Error) => setToast({ kind: 'err', msg: e.message }),
    });

    const unsuspendMut = useMutation({
        mutationFn: (id: string) => adminPost(`/api/admin/users/${id}/unsuspend`),
        onSuccess: () => {
            invalidateAdmin();
            setToast({ kind: 'ok', msg: 'Suspension lifted.' });
            setOpenMenuId(null);
        },
        onError: (e: Error) => setToast({ kind: 'err', msg: e.message }),
    });

    const resetPwMut = useMutation({
        mutationFn: (id: string) => adminPost(`/api/admin/users/${id}/reset-password`),
        onSuccess: () => {
            setToast({ kind: 'ok', msg: 'Password reset email sent.' });
            setOpenMenuId(null);
        },
        onError: (e: Error) => setToast({ kind: 'err', msg: e.message }),
    });

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 5000);
        return () => clearTimeout(t);
    }, [toast]);

    const isSelf = (id: string) => currentUser?.id === id;
    const busy =
        deleteMut.isPending || revokeMut.isPending || suspendMut.isPending || unsuspendMut.isPending || resetPwMut.isPending;

    return (
        <div className="space-y-4">
            {toast && (
                <div
                    className={`px-5 py-3 rounded-2xl text-sm font-medium border ${
                        toast.kind === 'ok'
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                            : 'bg-red-500/10 border-red-500/20 text-red-300'
                    }`}
                >
                    {toast.msg}
                </div>
            )}

            <div className="bg-white/[0.02] border border-white/10 rounded-3xl overflow-visible backdrop-blur-md">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-white/10">
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">User</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Memberships</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Shops</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Joined</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider w-14 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {users.map((user) => (
                            <tr key={user.id} className="hover:bg-white/[0.03] transition-colors group">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500/30 to-violet-500/30 border border-white/10 flex items-center justify-center text-sm font-bold text-white shrink-0">
                                            {(user.full_name || user.email)?.[0]?.toUpperCase() ?? '?'}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-white truncate">{user.full_name || '—'}</p>
                                            <p className="text-xs text-gray-400 truncate">{user.email}</p>
                                            <p className="text-[10px] text-gray-600 font-mono opacity-0 group-hover:opacity-100 transition-opacity truncate">{user.id}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    {user.memberships.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5">
                                            {user.memberships.map((m, i) => (
                                                <span key={i} className={`inline-flex text-[11px] font-bold px-2.5 py-1 rounded-lg border ${membershipColor(m)}`}>
                                                    {m.role_name}{m.tenant_name ? ` on ${m.tenant_name}` : ''}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-gray-600 italic">No memberships</span>
                                    )}
                                </td>
                                <td className="px-6 py-4">
                                    {user.shops.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5">
                                            {user.shops.map((s) => (
                                                <span key={s.id} className="inline-flex items-center text-[11px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                                                    {s.shop_name}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-gray-600 italic">—</span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-400">
                                    {new Date(user.created_at).toLocaleDateString()}
                                </td>
                                <td className="px-6 py-4">
                                    {user.is_banned ? (
                                        <span className="inline-flex text-[10px] font-bold px-2 py-1 rounded-lg border bg-red-500/15 text-red-300 border-red-500/25">
                                            Suspended
                                        </span>
                                    ) : (
                                        <span className="text-xs text-gray-600">—</span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-right relative">
                                    {!isSelf(user.id) ? (
                                        <div className="relative inline-block" ref={openMenuId === user.id ? menuRef : undefined}>
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setOpenMenuId((id) => (id === user.id ? null : user.id));
                                                }}
                                                className="p-2 rounded-xl border border-white/10 bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
                                                aria-label="User actions"
                                            >
                                                <MoreVertical className="w-4 h-4" />
                                            </button>
                                            {openMenuId === user.id && (
                                                <div
                                                    className="absolute right-0 top-full mt-1 z-50 min-w-[220px] py-1 rounded-xl border border-white/10 bg-gray-950 shadow-2xl shadow-black/50"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    {user.is_banned ? (
                                                        <button
                                                            type="button"
                                                            disabled={unsuspendMut.isPending}
                                                            onClick={() => unsuspendMut.mutate(user.id)}
                                                            className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-200 hover:bg-white/10"
                                                        >
                                                            <Unlock className="w-4 h-4 text-emerald-400" />
                                                            Unsuspend
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            disabled={suspendMut.isPending}
                                                            onClick={() => suspendMut.mutate(user.id)}
                                                            className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-200 hover:bg-white/10"
                                                        >
                                                            <Ban className="w-4 h-4 text-amber-400" />
                                                            Suspend
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        disabled={resetPwMut.isPending}
                                                        onClick={() => resetPwMut.mutate(user.id)}
                                                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-200 hover:bg-white/10"
                                                    >
                                                        <KeyRound className="w-4 h-4 text-cyan-400" />
                                                        Send password reset
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setOpenMenuId(null);
                                                            setConfirm({ type: 'revoke', target: user });
                                                        }}
                                                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-200 hover:bg-white/10"
                                                    >
                                                        <UserX className="w-4 h-4 text-violet-400" />
                                                        Revoke all memberships
                                                    </button>
                                                    <div className="my-1 border-t border-white/10" />
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setOpenMenuId(null);
                                                            setConfirm({ type: 'delete', target: user });
                                                        }}
                                                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-red-300 hover:bg-red-500/10"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                        Delete user
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-[10px] text-gray-600 uppercase tracking-wide">You</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {users.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-gray-600 text-sm italic">
                                    {search ? 'No users match your search.' : 'No users found.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {confirm && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="bg-gray-950 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
                        <div className="px-6 py-5 border-b border-white/10 flex items-start gap-3">
                            <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 shrink-0">
                                <AlertTriangle className="w-5 h-5 text-red-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">
                                    {confirm.type === 'delete' ? 'Delete user' : 'Revoke all memberships'}
                                </h3>
                                <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                                    {confirm.type === 'delete' ? (
                                        <>
                                            Permanently remove <span className="text-white font-semibold">{confirm.target.full_name || confirm.target.email}</span> (
                                            {confirm.target.email}). Orphan seller tenants they solely own (and linked shops) will be removed; shared tenants stay intact.
                                        </>
                                    ) : (
                                        <>
                                            Remove <span className="text-white font-semibold">{confirm.target.full_name || confirm.target.email}</span> from every tenant.
                                            Same orphan rules apply; their login account will remain.
                                        </>
                                    )}
                                </p>
                            </div>
                        </div>
                        <div className="px-6 py-4 flex justify-end gap-3 border-t border-white/10">
                            <button
                                type="button"
                                onClick={() => setConfirm(null)}
                                className="px-4 py-2 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 text-sm font-semibold"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={deleteMut.isPending || revokeMut.isPending}
                                onClick={() =>
                                    confirm.type === 'delete'
                                        ? deleteMut.mutate(confirm.target.id)
                                        : revokeMut.mutate(confirm.target.id)
                                }
                                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50"
                            >
                                {confirm.type === 'delete' ? 'Delete' : 'Revoke'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ═══════════════════ Tenants table ═══════════════════ */

function TenantsTable({
    tenants,
    search,
    drillView,
    showSuperAdminActions,
}: {
    tenants: TenantRow[];
    search: string;
    drillView: string;
    showSuperAdminActions: boolean;
}) {
    const queryClient = useQueryClient();
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [editTarget, setEditTarget] = useState<TenantRow | null>(null);
    const [editName, setEditName] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<TenantRow | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [toast, setToast] = useState<null | { kind: 'ok' | 'err'; msg: string }>(null);

    useEffect(() => {
        const close = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
        };
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, []);

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
        queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
        queryClient.invalidateQueries({ queryKey: ['admin-memberships'] });
        queryClient.invalidateQueries({ queryKey: ['tenant-memberships'] });
    };

    const patchMut = useMutation({
        mutationFn: ({ id, body }: { id: string; body: { name?: string; status?: string } }) => adminPatchTenant(id, body),
        onSuccess: () => {
            invalidate();
            setToast({ kind: 'ok', msg: 'Tenant updated.' });
            setEditTarget(null);
            setOpenMenuId(null);
        },
        onError: (e: Error) => setToast({ kind: 'err', msg: e.message }),
    });

    const deleteMut = useMutation({
        mutationFn: (id: string) => adminDeleteTenant(id),
        onSuccess: () => {
            invalidate();
            setToast({ kind: 'ok', msg: 'Tenant deleted.' });
            setDeleteTarget(null);
            setOpenMenuId(null);
        },
        onError: (e: Error) => setToast({ kind: 'err', msg: e.message }),
    });

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 5000);
        return () => clearTimeout(t);
    }, [toast]);

    const copyId = async (id: string) => {
        try {
            await navigator.clipboard.writeText(id);
            setCopiedId(id);
            setOpenMenuId(null);
            setTimeout(() => setCopiedId(null), 2000);
        } catch {
            setToast({ kind: 'err', msg: 'Could not copy' });
        }
    };

    const openEdit = (t: TenantRow) => {
        setEditName(t.name);
        setEditTarget(t);
        setOpenMenuId(null);
    };

    const colCount = drillView === 'agencies' || drillView === 'sellers' ? (showSuperAdminActions ? 8 : 7) : 5;
    const busy = patchMut.isPending || deleteMut.isPending;

    return (
        <div className="space-y-4">
            {toast && (
                <div
                    className={`px-5 py-3 rounded-2xl text-sm font-medium border ${
                        toast.kind === 'ok'
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                            : 'bg-red-500/10 border-red-500/20 text-red-300'
                    }`}
                >
                    {toast.msg}
                </div>
            )}

            <div className="bg-white/[0.02] border border-white/10 rounded-3xl overflow-visible backdrop-blur-md">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-white/10">
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Tenant</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Owner</th>
                            {drillView === 'agencies' && (
                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Linked Sellers</th>
                            )}
                            {drillView === 'sellers' && (
                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Agency</th>
                            )}
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Members</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Shops</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Created</th>
                            {showSuperAdminActions && (
                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider w-14 text-right">Actions</th>
                            )}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {tenants.map((t) => (
                            <tr key={t.id} className="hover:bg-white/[0.03] transition-colors group">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-sm font-bold text-white shrink-0 ${
                                            t.type === 'agency'
                                                ? 'bg-gradient-to-br from-violet-500/30 to-indigo-500/30'
                                                : 'bg-gradient-to-br from-pink-500/30 to-rose-500/30'
                                        }`}>
                                            {t.name?.[0]?.toUpperCase() ?? '?'}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-white truncate">{t.name}</p>
                                            <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-md border mt-0.5 ${
                                                t.type === 'agency'
                                                    ? 'bg-violet-500/15 text-violet-300 border-violet-500/25'
                                                    : 'bg-pink-500/15 text-pink-300 border-pink-500/25'
                                            }`}>
                                                {t.type}
                                            </span>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-300">{t.owner_name}</td>
                                {drillView === 'agencies' && (
                                    <td className="px-6 py-4 text-center">
                                        <span className="text-sm font-bold text-white">{t.linked_sellers ?? 0}</span>
                                    </td>
                                )}
                                {drillView === 'sellers' && (
                                    <td className="px-6 py-4">
                                        {t.parent_agency_name ? (
                                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border bg-violet-500/15 text-violet-300 border-violet-500/25">
                                                <Building2 className="w-3 h-3" />
                                                {t.parent_agency_name}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-gray-600 italic">Independent</span>
                                        )}
                                    </td>
                                )}
                                <td className="px-6 py-4 text-center">
                                    <span className="text-sm font-bold text-white">{t.member_count}</span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <span className={`text-sm font-bold ${t.shop_count > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                                        {t.shop_count}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span
                                        className={`text-[10px] font-bold px-2 py-1 rounded-lg border uppercase ${
                                            t.status === 'active'
                                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
                                                : t.status === 'suspended'
                                                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/25'
                                                  : 'bg-gray-500/15 text-gray-400 border-gray-500/25'
                                        }`}
                                    >
                                        {t.status || '—'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-400">
                                    {new Date(t.created_at).toLocaleDateString()}
                                </td>
                                {showSuperAdminActions && (
                                    <td className="px-6 py-4 text-right relative">
                                        <div className="relative inline-block" ref={openMenuId === t.id ? menuRef : undefined}>
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setOpenMenuId((id) => (id === t.id ? null : t.id));
                                                }}
                                                className="p-2 rounded-xl border border-white/10 bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
                                                aria-label="Tenant actions"
                                            >
                                                <MoreVertical className="w-4 h-4" />
                                            </button>
                                            {openMenuId === t.id && (
                                                <div
                                                    className="absolute right-0 top-full mt-1 z-50 min-w-[240px] py-1 rounded-xl border border-white/10 bg-gray-950 shadow-2xl shadow-black/50"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => openEdit(t)}
                                                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-200 hover:bg-white/10"
                                                    >
                                                        <Pencil className="w-4 h-4 text-violet-400" />
                                                        Edit name
                                                    </button>
                                                    <div className="px-4 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Set status</div>
                                                    {(['active', 'inactive', 'suspended'] as const).map((st) => (
                                                        <button
                                                            key={st}
                                                            type="button"
                                                            disabled={busy || t.status === st}
                                                            onClick={() => {
                                                                patchMut.mutate({ id: t.id, body: { status: st } });
                                                                setOpenMenuId(null);
                                                            }}
                                                            className="w-full flex items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-white/10 disabled:opacity-40 capitalize"
                                                        >
                                                            {st}
                                                        </button>
                                                    ))}
                                                    <button
                                                        type="button"
                                                        onClick={() => copyId(t.id)}
                                                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-200 hover:bg-white/10"
                                                    >
                                                        {copiedId === t.id ? (
                                                            <Check className="w-4 h-4 text-emerald-400" />
                                                        ) : (
                                                            <Copy className="w-4 h-4 text-cyan-400" />
                                                        )}
                                                        Copy tenant ID
                                                    </button>
                                                    <div className="my-1 border-t border-white/10" />
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setOpenMenuId(null);
                                                            setDeleteTarget(t);
                                                        }}
                                                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-red-300 hover:bg-red-500/10"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                        Delete tenant
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                )}
                            </tr>
                        ))}
                        {tenants.length === 0 && (
                            <tr>
                                <td colSpan={colCount} className="px-6 py-12 text-center text-gray-600 text-sm italic">
                                    {search ? 'No tenants match your search.' : 'No tenants found.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {editTarget && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="bg-gray-950 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
                        <div className="px-6 py-5 border-b border-white/10">
                            <h3 className="text-lg font-bold text-white">Edit tenant name</h3>
                            <p className="text-xs text-gray-500 mt-1 capitalize">{editTarget.type}</p>
                        </div>
                        <div className="px-6 py-4">
                            <label className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Name</label>
                            <input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="mt-2 w-full px-4 py-3 bg-gray-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                            />
                        </div>
                        <div className="px-6 py-4 flex justify-end gap-3 border-t border-white/10">
                            <button
                                type="button"
                                onClick={() => setEditTarget(null)}
                                className="px-4 py-2 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 text-sm font-semibold"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={busy || !editName.trim()}
                                onClick={() => patchMut.mutate({ id: editTarget.id, body: { name: editName.trim() } })}
                                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deleteTarget && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="bg-gray-950 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
                        <div className="px-6 py-5 border-b border-white/10 flex items-start gap-3">
                            <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 shrink-0">
                                <AlertTriangle className="w-5 h-5 text-red-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Delete tenant</h3>
                                <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                                    {deleteTarget.type === 'agency' ? (
                                        <>
                                            Remove agency <span className="text-white font-semibold">{deleteTarget.name}</span>. Linked seller tenants will be{' '}
                                            <span className="text-amber-300">unlinked</span> (not deleted). Agency memberships and custom roles for this agency
                                            are removed.
                                        </>
                                    ) : (
                                        <>
                                            Permanently delete seller organization <span className="text-white font-semibold">{deleteTarget.name}</span> and all
                                            accounts / TikTok shops under it ({deleteTarget.shop_count} shops). This cannot be undone.
                                        </>
                                    )}
                                </p>
                            </div>
                        </div>
                        <div className="px-6 py-4 flex justify-end gap-3 border-t border-white/10">
                            <button
                                type="button"
                                onClick={() => setDeleteTarget(null)}
                                className="px-4 py-2 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 text-sm font-semibold"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => deleteMut.mutate(deleteTarget.id)}
                                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ═══════════════════ Memberships table ═══════════════════ */

function MembershipsTable({ memberships, search }: { memberships: MembershipRow[]; search: string }) {
    const roleColor = (name: string) => {
        if (name === 'Super Admin') return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
        if (name === 'Agency Admin' || name === 'Account Manager' || name === 'Account Coordinator') return 'bg-violet-500/20 text-violet-300 border-violet-500/30';
        return 'bg-pink-500/20 text-pink-300 border-pink-500/30';
    };

    const tenantBadge = (type: string) => {
        if (type === 'agency') return 'bg-violet-500/10 text-violet-300 border-violet-500/20';
        if (type === 'platform') return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
        return 'bg-pink-500/10 text-pink-300 border-pink-500/20';
    };

    return (
        <div className="bg-white/[0.02] border border-white/10 rounded-3xl overflow-hidden backdrop-blur-md">
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-white/10">
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">User</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Role</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Tenant</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Assigned</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                    {memberships.map((m) => (
                        <tr key={m.id} className="hover:bg-white/[0.03] transition-colors">
                            <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500/30 to-blue-500/30 border border-white/10 flex items-center justify-center text-xs font-bold text-white shrink-0">
                                        {(m.full_name || m.email)?.[0]?.toUpperCase() ?? '?'}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-white truncate">{m.full_name}</p>
                                        <p className="text-xs text-gray-400 truncate">{m.email}</p>
                                    </div>
                                </div>
                            </td>
                            <td className="px-6 py-4">
                                <span className={`inline-flex text-[11px] font-bold px-2.5 py-1 rounded-lg border ${roleColor(m.role_name)}`}>
                                    {m.role_name}
                                </span>
                            </td>
                            <td className="px-6 py-4">
                                <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border ${tenantBadge(m.tenant_type)}`}>
                                    {m.tenant_type === 'agency' ? <Building2 className="w-3 h-3" /> : m.tenant_type === 'platform' ? <Crown className="w-3 h-3" /> : <Store className="w-3 h-3" />}
                                    {m.tenant_name}
                                </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-400">
                                {new Date(m.created_at).toLocaleDateString()}
                            </td>
                        </tr>
                    ))}
                    {memberships.length === 0 && (
                        <tr>
                            <td colSpan={4} className="px-6 py-12 text-center text-gray-600 text-sm italic">
                                {search ? 'No memberships match your search.' : 'No memberships found.'}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

/* ═══════════════════ Stores table ═══════════════════ */

function StoresTable({
    accounts,
    search,
    metricsWindow,
    onShowAllStores,
    onShowPL,
}: {
    accounts: any[];
    search: string;
    metricsWindow?: { kind: string; description: string };
    onShowAllStores: (a: any) => void;
    onShowPL: (s: any) => void;
}) {
    return (
        <div className="space-y-3">
            <p className="text-xs text-gray-500 leading-relaxed px-1">
                <span className="text-gray-400 font-semibold">Orders, revenue &amp; net</span> are{' '}
                <span className="text-pink-300/90">today in each shop&apos;s timezone</span> (paid orders and settlements synced to your database).{' '}
                Two database queries for all shops — no TikTok API calls for this table.
                {metricsWindow?.description ? ` ${metricsWindow.description}` : ''}
            </p>
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl overflow-hidden backdrop-blur-md">
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-white/10">
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Account Owner</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Tenant</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Connected Stores</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">
                            Orders
                            <span className="block font-normal normal-case text-[10px] text-gray-600 mt-0.5">today · shop TZ</span>
                        </th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">
                            Revenue
                            <span className="block font-normal normal-case text-[10px] text-gray-600 mt-0.5">today · shop TZ</span>
                        </th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">
                            Net
                            <span className="block font-normal normal-case text-[10px] text-gray-600 mt-0.5">settlements today</span>
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                    {accounts.map((account: any) => (
                        <tr key={account.id} className="hover:bg-white/[0.03] transition-colors">
                            <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/30 to-cyan-500/30 border border-white/10 flex items-center justify-center text-sm font-bold text-white shrink-0">
                                        {(account.account_name || '?')[0].toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-white">{account.account_name}</p>
                                        <p className="text-xs text-gray-500">{account.original_name}</p>
                                    </div>
                                </div>
                            </td>
                            <td className="px-6 py-4">
                                {account.tenant_name ? (
                                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border ${
                                        account.tenant_type === 'agency'
                                            ? 'bg-violet-500/15 text-violet-300 border-violet-500/25'
                                            : 'bg-pink-500/15 text-pink-300 border-pink-500/25'
                                    }`}>
                                        <Building2 className="w-3 h-3" />
                                        {account.tenant_name}
                                    </span>
                                ) : (
                                    <span className="text-xs text-gray-600 italic">—</span>
                                )}
                            </td>
                            <td className="px-6 py-4">
                                <div className="flex flex-col gap-1">
                                    {account.stores.slice(0, 2).map((store: any) => (
                                        <div key={store.id} className="flex items-center gap-2">
                                            <Store className="w-3 h-3 text-pink-400" />
                                            <span className="text-xs text-gray-300 truncate max-w-[200px]">{store.shop_name}</span>
                                        </div>
                                    ))}
                                    {account.stores.length > 2 && (
                                        <button
                                            onClick={() => onShowAllStores(account)}
                                            className="text-[10px] text-pink-400 hover:text-pink-300 font-medium flex items-center gap-0.5 mt-1"
                                        >
                                            Show all {account.stores.length} stores
                                            <ChevronRight className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                                <div className="flex items-center justify-center gap-2">
                                    <ShoppingBag className="w-3.5 h-3.5 text-gray-500" />
                                    <span className="text-sm text-white font-bold">{account.totalOrders}</span>
                                </div>
                            </td>
                            <td className="px-6 py-4">
                                <span className="text-sm font-bold text-emerald-400">
                                    ${account.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                            </td>
                            <td className="px-6 py-4">
                                <span className={`text-sm font-bold ${account.totalNet >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                                    ${account.totalNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                            </td>
                        </tr>
                    ))}
                    {accounts.length === 0 && (
                        <tr>
                            <td colSpan={6} className="px-6 py-12 text-center text-gray-600 text-sm italic">
                                {search ? 'No accounts match your search.' : 'No stores connected yet.'}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
            </div>
        </div>
    );
}

/* ═══════════════════ All Stores Modal ═══════════════════ */

function AllStoresModal({ account, onClose, onShowPL }: { account: any; onClose: () => void; onShowPL: (s: any) => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-950 border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl">
                <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-white">{account.account_name}'s Stores</h3>
                        <p className="text-xs text-gray-500">{account.stores.length} stores connected</p>
                        <p className="text-[10px] text-gray-600 mt-1 max-w-md">
                            Figures are today in each store&apos;s timezone (synced DB only).
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>
                <div className="p-6 max-h-[60vh] overflow-y-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {account.stores.map((store: any) => (
                            <div key={store.id} className="bg-white/[0.02] border border-white/10 p-4 rounded-2xl flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-pink-500/10 p-2 rounded-xl border border-pink-500/20">
                                            <Store className="w-4 h-4 text-pink-400" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-white">{store.shop_name}</p>
                                            <div className="flex items-center gap-1 mt-0.5">
                                                <Globe className="w-3 h-3 text-gray-500" />
                                                <span className="text-[10px] text-gray-500 uppercase">{store.region}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs font-bold text-emerald-400">${store.revenue.toLocaleString()}</p>
                                        <p className="text-[10px] text-gray-500">{store.ordersCount} orders</p>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                                    <div className="text-left">
                                        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Net Profit</p>
                                        <p className={`text-sm font-bold ${store.net >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                                            ${store.net.toLocaleString()}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => onShowPL(store)}
                                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[10px] font-bold rounded-xl transition-colors flex items-center gap-1"
                                    >
                                        <Calculator className="w-3 h-3" />
                                        View P&L
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="px-6 py-4 border-t border-white/10 flex justify-end">
                    <button onClick={onClose} className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium rounded-xl transition-colors">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ═══════════════════ P&L Modal ═══════════════════ */

function PLBreakdownModal({ shop, onClose }: { shop: any; onClose: () => void }) {
    const { data: plData, isLoading } = useQuery({
        queryKey: ['admin-shop-pl', shop.id],
        queryFn: async () => {
            const headers = await authHeaders();
            const res = await fetch(`${API_BASE_URL}/api/admin/stores/${shop.id}/pl`, { headers });
            const data = await res.json();
            if (data.success) return data.data;
            throw new Error(data.error);
        },
    });

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="bg-gray-950 border border-white/10 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
                <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-white">P&L Breakdown</h3>
                        <p className="text-xs text-gray-500">{shop.shop_name} &bull; {shop.region}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>
                <div className="p-6">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-2 border-pink-500 border-t-transparent" />
                        </div>
                    ) : plData ? (
                        <div className="space-y-6">
                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-400">Sales Revenue (Orders)</span>
                                    <span className="text-white font-bold">${plData.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-gray-500">Unsettled Revenue</span>
                                    <span className="text-cyan-400">+${plData.unsettledRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                                <div className="h-px bg-white/5" />
                                <div className="space-y-2">
                                    {[
                                        ['Platform Fees', plData.platformFees],
                                        ['Shipping Fees', plData.shippingFees],
                                        ['Affiliate Commissions', plData.affiliateCommissions],
                                        ['Refunds', plData.refunds],
                                    ].map(([label, val]) => (
                                        <div key={label as string} className="flex items-center justify-between text-xs">
                                            <span className="text-gray-500">{label}</span>
                                            <span className="text-red-400">-${(val as number).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </div>
                                    ))}
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-gray-500">Adjustments</span>
                                        <span className={plData.adjustments >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                            {plData.adjustments >= 0 ? '+' : ''}${plData.adjustments.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                    <div className="h-px bg-white/5 my-1" />
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-gray-500">Product Costs</span>
                                        <span className="text-red-400">-${plData.productCosts.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-1.5 rounded-xl ${plData.netProfit >= 0 ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                                            <Wallet className={`w-4 h-4 ${plData.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`} />
                                        </div>
                                        <span className="text-sm font-bold text-white">Net Profit</span>
                                    </div>
                                    <span className={`text-xl font-black ${plData.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        ${plData.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </span>
                                </div>
                            </div>
                            <p className="text-center text-[10px] text-gray-600 italic">
                                Based on {plData.settlementCount} settlements
                            </p>
                        </div>
                    ) : (
                        <p className="text-center py-8 text-gray-600">No P&L data found.</p>
                    )}
                </div>
                <div className="px-6 py-4 border-t border-white/10 flex justify-end">
                    <button onClick={onClose} className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium rounded-xl transition-colors">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
