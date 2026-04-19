import { Shield, Copy, Check, Store, Building2, Globe, Key, ChevronDown, User } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
    useTenantContext,
    type MembershipRow,
    primaryRoleBadgeClassName,
    computePrimaryRoleBadge,
} from '../../contexts/TenantContext';

type PermRow = { action: string; description: string | null };

function permissionGroupLabel(action: string): string {
    const prefix = action.split('.')[0];
    const map: Record<string, string> = {
        users: 'Team',
        billing: 'Billing',
        tiktok: 'TikTok',
        financials: 'Financials',
        tasks: 'Tasks',
        messages: 'Messages',
        agency: 'Agency',
        roles: 'Roles',
    };
    return map[prefix] || 'Other';
}

function pickDefaultTenantId(memberships: MembershipRow[]): string | null {
    if (!memberships.length) return null;
    const productTenant = memberships.find((m) => m.tenants?.type === 'seller' || m.tenants?.type === 'agency');
    return productTenant?.tenant_id ?? memberships[0].tenant_id;
}

function roleScopeLine(m: MembershipRow | undefined): string {
    if (!m?.roles) return '';
    const t = m.tenants?.type ?? 'tenant';
    const scope = m.roles.scope || '';
    const kind = m.roles.type === 'custom' ? 'Custom role' : 'System role';
    return `${kind} · ${scope || t} scope`;
}

export function MyAccessView() {
    const { user } = useAuth();
    const { memberships, loading } = useTenantContext();
    const [copied, setCopied] = useState<string | null>(null);
    const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

    useEffect(() => {
        if (!memberships.length) {
            setSelectedTenantId(null);
            return;
        }
        setSelectedTenantId((prev) => {
            if (prev && memberships.some((m) => m.tenant_id === prev)) return prev;
            return pickDefaultTenantId(memberships);
        });
    }, [memberships]);

    const selected = useMemo(
        () => memberships.find((m) => m.tenant_id === selectedTenantId),
        [memberships, selectedTenantId]
    );

    const badge = computePrimaryRoleBadge(memberships);

    const { data: accounts = [] } = useQuery({
        queryKey: ['my-accounts-tenant', user?.id],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('user_accounts')
                .select('account_id, accounts ( id, name, tenant_id )')
                .eq('user_id', user!.id);
            if (error) throw error;
            return (data || []).map((r: { accounts: unknown }) => r.accounts).filter(Boolean) as {
                id: string;
                name: string;
                tenant_id: string;
            }[];
        },
        enabled: !!user?.id,
    });

    const accountsForSelectedTenant = useMemo(() => {
        if (!selectedTenantId || selected?.tenants?.type !== 'seller') return [];
        return accounts.filter((a) => a.tenant_id === selectedTenantId);
    }, [accounts, selectedTenantId, selected?.tenants?.type]);

    const { data: permissionRows = [], isLoading: permsLoading } = useQuery({
        queryKey: ['my-access-permissions', selected?.role_id],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('role_permissions')
                .select('permissions ( action, description )')
                .eq('role_id', selected!.role_id);
            if (error) throw error;
            const rows = (data || [])
                .flatMap((r: { permissions: PermRow[] | PermRow | null }) =>
                    Array.isArray(r.permissions) ? r.permissions : r.permissions ? [r.permissions] : []
                )
                .filter((p): p is PermRow => !!p?.action);
            rows.sort((a, b) => a.action.localeCompare(b.action));
            return rows;
        },
        enabled: !!selected?.role_id,
    });

    const permGroups = useMemo(() => {
        const m = new Map<string, PermRow[]>();
        for (const p of permissionRows) {
            const g = permissionGroupLabel(p.action);
            if (!m.has(g)) m.set(g, []);
            m.get(g)!.push(p);
        }
        return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [permissionRows]);

    const copy = async (id: string) => {
        await navigator.clipboard.writeText(id);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    return (
        <div className="w-full max-w-none space-y-8 pb-10 animate-in fade-in duration-500">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-6 sm:p-8 backdrop-blur-sm">
                <div className="absolute inset-0 bg-gradient-to-br from-pink-500/10 via-transparent to-violet-500/5 pointer-events-none" />
                <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 flex-1 gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-pink-500/25 bg-pink-500/10">
                            <Shield className="h-7 w-7 text-pink-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">My access & roles</h1>
                            <p className="mt-2 text-sm leading-relaxed text-gray-400 lg:max-w-4xl xl:max-w-none">
                                See exactly what you can do in your tenant context. This reflects your assigned role and
                                permission catalog for the current tenant, not a generic role list.
                            </p>
                            {user?.email && (
                                <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                    <User className="h-3.5 w-3.5 shrink-0" />
                                    <span className="font-mono">{user.email}</span>
                                    {badge && (
                                        <span
                                            className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${primaryRoleBadgeClassName(badge.variant)}`}
                                        >
                                            {badge.label}
                                        </span>
                                    )}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {loading ? (
                <p className="text-center text-sm text-gray-500">Loading your access…</p>
            ) : memberships.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-gray-900/40 p-10 text-center">
                    <p className="text-gray-300">You don&apos;t have any active tenant memberships yet.</p>
                    <p className="mt-2 text-sm text-gray-500">
                        When an admin invites you to a team and you accept, your permissions will appear here.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-8 xl:grid-cols-12 xl:items-start">
                    <div className="space-y-6 xl:col-span-4">
                        <section className="rounded-2xl border border-white/10 bg-gray-900/35 p-6 backdrop-blur-sm">
                            <label className="mb-3 block text-xs font-bold uppercase tracking-wider text-gray-500">
                                Tenant context
                            </label>
                            <div className="relative">
                                <select
                                    value={selectedTenantId ?? ''}
                                    onChange={(e) => setSelectedTenantId(e.target.value || null)}
                                    className="w-full appearance-none rounded-xl border border-white/10 bg-black/40 py-3.5 pl-4 pr-11 text-sm font-semibold text-white shadow-inner focus:border-pink-500/40 focus:outline-none"
                                >
                                    {memberships.map((m) => (
                                        <option key={m.id} value={m.tenant_id} className="bg-gray-900">
                                            {m.tenants?.name ?? 'Tenant'} — {m.roles?.name ?? 'Role'}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
                            </div>
                            {selected && (
                                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-black/25 px-4 py-3">
                                    <div className="flex min-w-0 flex-1 items-center gap-2">
                                        {selected.tenants?.type === 'agency' ? (
                                            <Building2 className="h-4 w-4 shrink-0 text-violet-400" />
                                        ) : selected.tenants?.type === 'platform' ? (
                                            <Globe className="h-4 w-4 shrink-0 text-amber-400" />
                                        ) : (
                                            <Store className="h-4 w-4 shrink-0 text-pink-400" />
                                        )}
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-bold text-white">
                                                {selected.tenants?.name}
                                            </div>
                                            <div className="text-xs text-gray-500">{roleScopeLine(selected)}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="rounded-lg border border-pink-500/25 bg-pink-500/10 px-3 py-1 text-xs font-bold text-pink-200">
                                            {selected.roles?.name ?? '—'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => copy(selected.tenant_id)}
                                            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                                            title="Copy tenant id"
                                        >
                                            {copied === selected.tenant_id ? (
                                                <Check className="h-4 w-4 text-emerald-400" />
                                            ) : (
                                                <Copy className="h-4 w-4" />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </section>

                        {selected?.tenants?.type === 'seller' && (
                            <section className="rounded-2xl border border-white/10 bg-gray-900/35 p-6 backdrop-blur-sm">
                                <h2 className="mb-2 text-lg font-bold text-white">Shop accounts on this seller</h2>
                                <p className="mb-4 text-xs text-gray-500 leading-relaxed">
                                    TikTok Shop accounts you can open for{' '}
                                    <span className="text-gray-400">{selected.tenants?.name}</span>. Share the{' '}
                                    <strong className="text-gray-400">tenant id</strong> with your agency if they need to
                                    link this seller.
                                </p>
                                {accountsForSelectedTenant.length === 0 ? (
                                    <p className="text-sm text-gray-500">
                                        No shop accounts linked to your user for this tenant.
                                    </p>
                                ) : (
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        {accountsForSelectedTenant.map((a) => (
                                            <div
                                                key={a.id}
                                                className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/25 px-4 py-3 text-sm"
                                            >
                                                <span className="min-w-0 truncate font-medium text-white">{a.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => copy(a.tenant_id)}
                                                    className="shrink-0 text-gray-400 hover:text-white"
                                                    title="Copy tenant id"
                                                >
                                                    {copied === a.tenant_id ? (
                                                        <Check className="h-4 w-4 text-emerald-400" />
                                                    ) : (
                                                        <Copy className="h-4 w-4" />
                                                    )}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        )}

                        {selected?.tenants?.type === 'agency' && (
                            <section className="rounded-2xl border border-dashed border-white/10 bg-gray-900/20 p-5 text-sm leading-relaxed text-gray-500">
                                Shop dashboard access is tied to <strong className="text-gray-400">seller</strong>{' '}
                                tenants. Choose a seller organization in the selector above (if you have one) to see shop
                                accounts you can use.
                            </section>
                        )}
                    </div>

                    <section className="rounded-2xl border border-white/10 bg-gray-900/35 p-6 backdrop-blur-sm xl:col-span-8">
                        <div className="mb-6 flex flex-wrap items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/25 bg-violet-500/10">
                                <Key className="h-5 w-5 text-violet-300" />
                            </div>
                            <div className="min-w-0">
                                <h2 className="text-lg font-bold text-white">What you can do here</h2>
                                <p className="text-xs text-gray-500">
                                    Permissions for <span className="text-gray-400">{selected?.tenants?.name}</span> under
                                    your <span className="text-gray-400">{selected?.roles?.name}</span> role.
                                </p>
                            </div>
                        </div>

                        {permsLoading ? (
                            <p className="text-sm text-gray-500">Loading permissions…</p>
                        ) : permissionRows.length === 0 ? (
                            <div className="rounded-xl border border-white/5 bg-black/20 p-5 text-sm leading-relaxed text-gray-400">
                                <p>
                                    No granular permissions are listed for this role in the catalog. Your access may still
                                    be enforced by <strong className="text-gray-300">Row Level Security</strong> and the
                                    conventions of the <strong className="text-gray-300">{selected?.roles?.name}</strong>{' '}
                                    role (for example platform-wide tools for Super Admins).
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-10">
                                {permGroups.map(([group, perms]) => (
                                    <div key={group}>
                                        <h3 className="mb-4 text-xs font-extrabold uppercase tracking-widest text-pink-400">
                                            {group}
                                        </h3>
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-2 2xl:grid-cols-3">
                                            {perms.map((p) => (
                                                <div
                                                    key={p.action}
                                                    className="flex h-full flex-col rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3"
                                                >
                                                    <div className="text-sm font-semibold leading-snug text-gray-100">
                                                        {p.description || p.action}
                                                    </div>
                                                    <div className="mt-auto pt-2 font-mono text-[10px] leading-tight text-gray-500 break-words">
                                                        {p.action}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}
