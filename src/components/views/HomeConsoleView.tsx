import { Building2, Globe, LayoutDashboard, Loader2, Search, Shield, Store, Users, ChevronRight, ArrowRight, Palette } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { apiFetch } from '../../lib/apiClient';
import type { MembershipRow } from '../../contexts/TenantContext';
import { useTenantContext } from '../../contexts/TenantContext';
import { useSellerBranding } from '../../contexts/SellerBrandingContext';

import { slugify } from '../../utils/slugify';

export type VisibleShop = {
    id: string;
    shop_id: string;
    shop_name: string;
    region: string;
    timezone: string | null;
    seller_type: string;
    account_id: string;
    account_name: string;
    tenant_id: string | null;
    tenant_name: string | null;
    tenant_type: string | null;
    tenant_status: string | null;
};

type HierarchyTenant = {
    id: string;
    name: string;
    type: string;
    parent_tenant_id: string | null;
    status?: string;
};

type AgencyGroup = {
    agencyId: string;
    agencyName: string;
    agencyStatus?: string;
    /** True agency tenant vs parent row that is not typed agency (legacy / mislink). */
    groupKind: 'agency' | 'organization';
    sellers: { sellerId: string; sellerName: string; shops: VisibleShop[] }[];
    totalShops: number;
};

type DisplayAgencyGroup = AgencyGroup & {
    headerTitle: string;
    accentColor: string | null;
};

type HomeConsoleViewProps = {
    hasAgencyAccess: boolean;
    canManageTeamRoles: boolean;
    onNavigate: (tab: string) => void;
    memberships: MembershipRow[];
    onAddShop: () => void;
    /** False for Seller User and other roles without tiktok.auth — hides Connect new shop. */
    canConnectShop?: boolean;
    connectShopError?: string | null;
    connectShopBusy?: boolean;
};

export function HomeConsoleView({
    hasAgencyAccess,
    canManageTeamRoles,
    onNavigate,
    memberships,
    onAddShop,
    canConnectShop = false,
    connectShopError = null,
    connectShopBusy = false,
}: HomeConsoleViewProps) {
    const navigate = useNavigate();

    const onSelectShop = (shop: VisibleShop) => {
        navigate(`/shop/${slugify(shop.shop_name)}`, { state: { shop } });
    };
    const { isPlatformSuperAdmin } = useTenantContext();
    const isUnrestrictedViewer = isPlatformSuperAdmin;
    const [searchQuery, setSearchQuery] = useState('');
    const { data: brand, agencyConsoleBranding } = useSellerBranding();

    const agencyTenantIds = useMemo(
        () => memberships.filter((m) => m.tenants?.type === 'agency').map((m) => m.tenant_id),
        [memberships],
    );
    const directSellerTenantIds = useMemo(
        () => memberships.filter((m) => m.tenants?.type === 'seller').map((m) => m.tenant_id),
        [memberships],
    );

    const { data: linkedSellerTenantIds = [] } = useQuery({
        queryKey: ['agency-linked-seller-ids', agencyTenantIds],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('tenants')
                .select('id')
                .in('parent_tenant_id', agencyTenantIds)
                .eq('type', 'seller');
            if (error) throw error;
            return (data || []).map((t: any) => t.id as string);
        },
        enabled: agencyTenantIds.length > 0,
    });

    const allowedTenantIds = useMemo(
        () => new Set([...directSellerTenantIds, ...linkedSellerTenantIds]),
        [directSellerTenantIds, linkedSellerTenantIds],
    );

    // For admins: fetch agency → seller hierarchy
    const { data: agencyHierarchy = [] } = useQuery({
        queryKey: ['agency-seller-hierarchy'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('tenants')
                .select('id, name, type, parent_tenant_id, status')
                .in('type', ['agency', 'seller'])
                .order('name');
            if (error) throw error;
            const rows: HierarchyTenant[] = [...((data || []) as HierarchyTenant[])];
            const byId = new Map(rows.map((r) => [r.id, r]));
            const missingParentIds = new Set<string>();
            for (const r of rows) {
                if (r.type === 'seller' && r.parent_tenant_id && !byId.has(r.parent_tenant_id)) {
                    missingParentIds.add(r.parent_tenant_id);
                }
            }
            if (missingParentIds.size > 0) {
                const { data: extra, error: extraErr } = await supabase
                    .from('tenants')
                    .select('id, name, type, parent_tenant_id, status')
                    .in('id', [...missingParentIds]);
                if (extraErr) throw extraErr;
                for (const r of (extra || []) as HierarchyTenant[]) {
                    if (!byId.has(r.id)) {
                        byId.set(r.id, r);
                        rows.push(r);
                    }
                }
            }
            rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
            return rows;
        },
        enabled: isUnrestrictedViewer,
    });

    const { data: rawShops = [], isLoading: loadingShops } = useQuery({
        queryKey: ['all-visible-shops', isUnrestrictedViewer, [...allowedTenantIds].sort().join(',')],
        queryFn: async () => {
            if (!isUnrestrictedViewer && allowedTenantIds.size === 0) return [];

            let query = supabase
                .from('tiktok_shops')
                .select('id, shop_id, shop_name, region, timezone, seller_type, account_id, accounts!inner(id, name, tenant_id, tenants(id, name, type, status))')
                .order('shop_name');

            // Defense in depth: RLS must scope rows; also restrict request to known tenant ids.
            if (!isUnrestrictedViewer) {
                query = query.in('accounts.tenant_id', [...allowedTenantIds]);
            }

            const { data, error } = await query;
            if (error) throw error;
            return (data || []).map((row: any) => ({
                id: row.id,
                shop_id: row.shop_id,
                shop_name: row.shop_name,
                region: row.region,
                timezone: row.timezone,
                seller_type: row.seller_type,
                account_id: row.account_id,
                account_name: row.accounts?.name ?? 'Unknown',
                tenant_id: row.accounts?.tenants?.id ?? row.accounts?.tenant_id ?? null,
                tenant_name: row.accounts?.tenants?.name ?? row.accounts?.name ?? null,
                tenant_type: row.accounts?.tenants?.type ?? null,
                tenant_status: row.accounts?.tenants?.status ?? null,
            })) as VisibleShop[];
        },
    });

    const allShops = useMemo(() => {
        if (isUnrestrictedViewer) return rawShops;
        if (allowedTenantIds.size === 0) return [];
        return rawShops.filter((shop) => shop.tenant_id != null && allowedTenantIds.has(shop.tenant_id));
    }, [rawShops, isUnrestrictedViewer, allowedTenantIds]);

    // Apply search filter
    const filteredShops = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return allShops;
        return allShops.filter(
            (s) =>
                s.shop_name.toLowerCase().includes(q) ||
                s.account_name.toLowerCase().includes(q) ||
                (s.tenant_name && s.tenant_name.toLowerCase().includes(q)) ||
                s.region.toLowerCase().includes(q),
        );
    }, [allShops, searchQuery]);

    // For admins: group by agency → seller hierarchy
    const agencyGroups = useMemo((): AgencyGroup[] => {
        if (!isUnrestrictedViewer || agencyHierarchy.length === 0) return [];

        const agencies = agencyHierarchy.filter((t) => t.type === 'agency');
        const sellers = agencyHierarchy.filter((t) => t.type === 'seller');
        const tenantById = new Map(agencyHierarchy.map((t) => [t.id, t]));

        const shopsByTenant = new Map<string, VisibleShop[]>();
        for (const shop of filteredShops) {
            if (!shop.tenant_id) continue;
            if (!shopsByTenant.has(shop.tenant_id)) shopsByTenant.set(shop.tenant_id, []);
            shopsByTenant.get(shop.tenant_id)!.push(shop);
        }

        const groups: AgencyGroup[] = [];

        for (const agency of agencies) {
            const linkedSellers = sellers.filter((s) => s.parent_tenant_id === agency.id);
            const sellerGroups = linkedSellers
                .map((s) => ({
                    sellerId: s.id,
                    sellerName: s.name,
                    shops: shopsByTenant.get(s.id) || [],
                }))
                .filter((sg) => sg.shops.length > 0);

            if (sellerGroups.length > 0) {
                groups.push({
                    agencyId: agency.id,
                    agencyName: agency.name,
                    agencyStatus: agency.status,
                    groupKind: 'agency',
                    sellers: sellerGroups,
                    totalShops: sellerGroups.reduce((sum, sg) => sum + sg.shops.length, 0),
                });
            }
        }

        // Sellers linked to a parent tenant that is not in the agency list (e.g. inactive agency
        // was omitted before we loaded all statuses, or legacy parent id) — still show shops.
        const agencyIdSet = new Set(agencies.map((a) => a.id));
        const sellersOrphanedFromList = sellers.filter(
            (s) => s.parent_tenant_id && !agencyIdSet.has(s.parent_tenant_id),
        );
        const byParent = new Map<string, HierarchyTenant[]>();
        for (const s of sellersOrphanedFromList) {
            const p = s.parent_tenant_id!;
            if (!byParent.has(p)) byParent.set(p, []);
            byParent.get(p)!.push(s);
        }
        for (const [parentId, sellerRows] of byParent) {
            const sellerGroups = sellerRows
                .map((s) => ({
                    sellerId: s.id,
                    sellerName: s.name,
                    shops: shopsByTenant.get(s.id) || [],
                }))
                .filter((sg) => sg.shops.length > 0);
            if (sellerGroups.length === 0) continue;
            const parentRow = tenantById.get(parentId);
            const isAgencyParent = parentRow?.type === 'agency';
            const displayName =
                parentRow?.name?.trim() ||
                (isAgencyParent ? `Agency ${parentId.slice(0, 8)}…` : `Organization ${parentId.slice(0, 8)}…`);
            groups.push({
                agencyId: parentId,
                agencyName: displayName,
                agencyStatus: parentRow?.status,
                groupKind: isAgencyParent ? 'agency' : 'organization',
                sellers: sellerGroups,
                totalShops: sellerGroups.reduce((sum, sg) => sum + sg.shops.length, 0),
            });
        }

        return groups;
    }, [isUnrestrictedViewer, agencyHierarchy, filteredShops]);

    const agencyIdsForBranding = useMemo(
        () => [...new Set(agencyGroups.map((g) => g.agencyId))].sort(),
        [agencyGroups],
    );

    const { data: brandingByTenant = {} } = useQuery({
        queryKey: ['admin-tenant-branding-map', agencyIdsForBranding.join('|')],
        queryFn: async () => {
            const res = await apiFetch(
                `/api/admin/tenant-branding-map?tenantIds=${encodeURIComponent(agencyIdsForBranding.join(','))}`,
            );
            const json = (await res.json()) as {
                success?: boolean;
                data?: Record<string, { displayName: string | null; primaryColor: string | null }>;
                error?: string;
            };
            if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load branding map');
            return json.data || {};
        },
        enabled: isUnrestrictedViewer && agencyIdsForBranding.length > 0,
    });

    const enrichedAgencyGroups: DisplayAgencyGroup[] = useMemo(() => {
        const hexOk = (c: string) => /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?([0-9A-Fa-f]{2})?$/.test(c.trim());
        return agencyGroups.map((g) => {
            const b = brandingByTenant[g.agencyId];
            const brandName = b?.displayName?.trim();
            const accent =
                b?.primaryColor && hexOk(b.primaryColor) ? b.primaryColor.trim() : null;
            return {
                ...g,
                headerTitle: brandName || g.agencyName,
                accentColor: accent,
            };
        });
    }, [agencyGroups, brandingByTenant]);

    const shopIdsPlacedUnderAgency = useMemo(() => {
        const ids = new Set<string>();
        for (const ag of agencyGroups) {
            for (const sg of ag.sellers) {
                for (const sh of sg.shops) ids.add(sh.id);
            }
        }
        return ids;
    }, [agencyGroups]);

    // Shops not shown under any agency group (true independents + any fallback)
    const independentShops = useMemo(() => {
        if (!isUnrestrictedViewer) return filteredShops;
        return filteredShops.filter((s) => !shopIdsPlacedUnderAgency.has(s.id));
    }, [isUnrestrictedViewer, filteredShops, shopIdsPlacedUnderAgency]);

    // For non-admin users: simple tenant grouping
    const simpleGroups = useMemo(() => {
        if (isUnrestrictedViewer) return [];
        const map = new Map<string, { tenantName: string; tenantType: string | null; shops: VisibleShop[] }>();
        for (const shop of filteredShops) {
            const key = shop.tenant_id ?? shop.account_id;
            if (!map.has(key)) {
                map.set(key, { tenantName: shop.tenant_name ?? shop.account_name, tenantType: shop.tenant_type, shops: [] });
            }
            map.get(key)!.shops.push(shop);
        }
        return [...map.entries()];
    }, [isUnrestrictedViewer, filteredShops]);

    const totalShopCount = filteredShops.length;

    return (
        <div className="w-full min-w-0 max-w-none space-y-10 animate-in fade-in duration-500 pb-12 relative">
            <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-mamba-green/5 via-violet-500/5 to-transparent -z-10 rounded-full blur-[100px] opacity-60 pointer-events-none" />

            {/* Header */}
            <div className="relative z-10">
                <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-mamba-text to-white flex items-center gap-4">
                    <div
                        className="p-2.5 rounded-2xl backdrop-blur-xl"
                        style={agencyConsoleBranding
                            ? { backgroundColor: `${brand.primaryColor}18`, border: `1px solid ${brand.primaryColor}30` }
                            : { backgroundColor: 'rgba(236,72,153,0.1)', border: '1px solid rgba(236,72,153,0.2)' }
                        }
                    >
                        <LayoutDashboard
                            className="w-8 h-8 drop-shadow-lg"
                            style={{ color: agencyConsoleBranding ? brand.primaryColor : undefined }}
                        />
                    </div>
                    {agencyConsoleBranding ? brand.displayName : 'System Console'}
                </h1>
                <p className="brand-muted opacity-90 mt-4 text-base max-w-2xl leading-relaxed">
                    {isUnrestrictedViewer
                        ? 'Platform overview. All shops and organizations are securely tracked. Select a shop to inspect its analytics in detail.'
                        : 'Your operations hub. Organization tools are accessible from the sidebar. Select a shop below to open performance analytics.'}
                </p>
            </div>

            {/* Quick actions */}
            {(hasAgencyAccess || canManageTeamRoles || isUnrestrictedViewer) && (
                <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 relative z-10">
                    {hasAgencyAccess && (
                        <button
                            type="button"
                            onClick={() => onNavigate('agency-console')}
                            className="group relative text-left rounded-3xl border border-white/10 bg-white/[0.02] hover:bg-violet-500/[0.04] hover:border-violet-500/30 p-6 transition-all duration-300 hover:shadow-2xl hover:shadow-violet-500/10 hover:-translate-y-1 overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                            <div className="relative">
                                <div className="p-3 bg-violet-500/10 rounded-2xl w-fit mb-5 border border-violet-500/20 group-hover:scale-110 transition-transform duration-300">
                                    <Building2 className="w-7 h-7 text-violet-400" />
                                </div>
                                <div className="brand-text text-lg font-bold tracking-tight mb-1 flex items-center justify-between">
                                    Agency Admin
                                    <ArrowRight className="w-4 h-4 text-violet-400 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                                </div>
                                <p className="text-sm brand-muted opacity-90 leading-relaxed font-medium">Manage linked sellers, staff roles, and agency configurations.</p>
                            </div>
                        </button>
                    )}
                    {hasAgencyAccess && (
                        <button
                            type="button"
                            onClick={() => onNavigate('agency-branding')}
                            className="group relative text-left rounded-3xl border border-white/10 bg-white/[0.02] hover:bg-mamba-green/[0.04] hover:border-mamba-green/30 p-6 transition-all duration-300 hover:shadow-2xl hover:shadow-mamba-green/10 hover:-translate-y-1 overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-mamba-green/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                            <div className="relative">
                                <div className="p-3 bg-mamba-green/10 rounded-2xl w-fit mb-5 border border-mamba-green/20 group-hover:scale-110 transition-transform duration-300">
                                    <Palette className="w-7 h-7 text-mamba-neon" />
                                </div>
                                <div className="brand-text text-lg font-bold tracking-tight mb-1 flex items-center justify-between">
                                    Seller branding
                                    <ArrowRight className="w-4 h-4 text-mamba-neon opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                                </div>
                                <p className="text-sm brand-muted opacity-90 leading-relaxed font-medium">
                                    White-label display name and colors for linked sellers (agency-level).
                                </p>
                            </div>
                        </button>
                    )}
                    {(canManageTeamRoles || isUnrestrictedViewer) && (
                        <button
                            type="button"
                            onClick={() => onNavigate('team-roles')}
                            className="group relative text-left rounded-3xl border border-white/10 bg-white/[0.02] hover:bg-cyan-500/[0.04] hover:border-cyan-500/30 p-6 transition-all duration-300 hover:shadow-2xl hover:shadow-cyan-500/10 hover:-translate-y-1 overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                            <div className="relative">
                                <div className="p-3 bg-cyan-500/10 rounded-2xl w-fit mb-5 border border-cyan-500/20 group-hover:scale-110 transition-transform duration-300">
                                    <Users className="w-7 h-7 text-cyan-400" />
                                </div>
                                <div className="brand-text text-lg font-bold tracking-tight mb-1 flex items-center justify-between">
                                    Team & Roles
                                    <ArrowRight className="w-4 h-4 text-cyan-400 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                                </div>
                                <p className="text-sm brand-muted opacity-90 leading-relaxed font-medium">Invite organization members and manage tenant-level access.</p>
                            </div>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => onNavigate('my-access')}
                        className="group relative text-left rounded-3xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/20 p-6 transition-all duration-300 hover:shadow-2xl hover:shadow-white/5 hover:-translate-y-1 overflow-hidden"
                    >
                        <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        <div className="relative">
                            <div className="p-3 bg-gray-800 rounded-2xl w-fit mb-5 border border-gray-700 group-hover:scale-110 transition-transform duration-300">
                                <Shield className="w-7 h-7 brand-muted" />
                            </div>
                            <div className="brand-text text-lg font-bold tracking-tight mb-1 flex items-center justify-between">
                                Identity Details
                                <ArrowRight className="w-4 h-4 brand-muted opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                            </div>
                            <p className="text-sm brand-muted opacity-90 leading-relaxed font-medium">View your tenant memberships, underlying IDs, and permissions.</p>
                        </div>
                    </button>
                </section>
            )}

            {/* Organizations (non-admin) */}
            {!isUnrestrictedViewer && memberships.length > 0 && (
                <section className="rounded-2xl border border-gray-700 bg-gray-800/40 p-6">
                        <h2 className="text-sm font-semibold brand-muted uppercase tracking-wide mb-3">Your organizations</h2>
                    <ul className="space-y-2">
                        {memberships.map((m) => (
                            <li
                                key={m.id}
                                className="flex flex-wrap items-center justify-between gap-2 text-sm bg-gray-900/60 rounded-xl px-4 py-2 border border-gray-700/80"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    {m.tenants?.type === 'agency' ? (
                                        <Building2 className="w-4 h-4 text-violet-400 shrink-0" />
                                    ) : (
                                        <Store className="w-4 h-4 text-mamba-neon shrink-0" />
                                    )}
                                    <span className="brand-text font-medium truncate">{m.tenants?.name ?? 'Tenant'}</span>
                                </div>
                                <span className="text-mamba-neon/90 text-xs font-medium shrink-0">{m.roles?.name}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* Shops section */}
            <section>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
                    <div>
                        <h2 className="text-xl font-semibold brand-text flex items-center gap-2">
                            <Store className="w-6 h-6 text-mamba-neon" />
                            {isUnrestrictedViewer ? 'All platform shops' : 'Shops you can access'}
                        </h2>
                        <p className="text-sm brand-muted mt-1">
                            {isUnrestrictedViewer
                                ? `${allShops.length} shops across the platform, grouped by managing agency.`
                                : hasAgencyAccess
                                    ? 'Shops from seller organizations linked to your agency.'
                                    : 'TikTok shops you have dashboard access to.'}
                        </p>
                    </div>
                    {canConnectShop && (
                        <button
                            type="button"
                            onClick={onAddShop}
                            disabled={connectShopBusy}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-60 ${
                                agencyConsoleBranding ? 'brand-on-primary' : 'text-white'
                            }`}
                            style={agencyConsoleBranding
                                ? { backgroundColor: brand.primaryColor }
                                : { backgroundColor: '#db2777' }
                            }
                            onMouseEnter={(e) => { if (!connectShopBusy) (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                        >
                            <Store className="w-4 h-4" />
                            {connectShopBusy ? 'Connecting…' : 'Connect new shop'}
                        </button>
                    )}
                </div>
                {connectShopError && (
                    <p className="text-sm text-red-400 mb-4" role="alert">
                        {connectShopError}
                    </p>
                )}

                {/* Search bar (visible when there are multiple shops) */}
                {allShops.length > 3 && (
                    <div className="relative mb-5">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 brand-muted" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search shops by name, account, organization, or region..."
                            className="w-full bg-gray-800/60 border border-gray-700 rounded-xl py-2.5 pl-10 pr-4 text-sm brand-text brand-input focus:outline-none focus:border-mamba-green/50"
                        />
                        {searchQuery && (
                            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs brand-muted">
                                {totalShopCount} result{totalShopCount !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                )}

                {loadingShops && (
                    <div className="flex items-center gap-2 brand-muted text-sm py-8">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Loading shops...
                    </div>
                )}

                {!loadingShops && totalShopCount === 0 && (
                    <div className="rounded-2xl border border-gray-700 bg-gray-800/40 p-8 text-center">
                        <Store className="w-10 h-10 opacity-70 brand-muted mx-auto mb-3" />
                        <h3 className="brand-text font-semibold mb-1">
                            {searchQuery ? 'No shops match your search' : 'No shops available'}
                        </h3>
                        <p className="text-sm brand-muted max-w-md mx-auto">
                            {searchQuery
                                ? 'Try a different search term.'
                                : hasAgencyAccess
                                    ? 'Sellers linked to your agency have no connected TikTok shops yet.'
                                    : memberships.length > 0
                                        ? 'You have organization roles but no TikTok shop accounts linked yet.'
                                        : 'Connect your TikTok Shop to get started with analytics.'}
                        </p>
                    </div>
                )}

                {/* Admin view: agency-grouped layout */}
                {!loadingShops && isUnrestrictedViewer && (agencyGroups.length > 0 || independentShops.length > 0) && (
                    <div className="space-y-8">
                        {enrichedAgencyGroups.map((ag) => (
                            <div
                                key={ag.agencyId}
                                className="rounded-2xl border overflow-hidden"
                                style={{
                                    borderColor: ag.accentColor ? `${ag.accentColor}55` : 'rgba(139, 92, 246, 0.2)',
                                    backgroundColor: ag.accentColor ? `${ag.accentColor}0d` : 'rgba(139, 92, 246, 0.03)',
                                }}
                            >
                                {/* Agency header */}
                                <div
                                    className="flex items-center justify-between px-5 py-3.5 border-b bg-black/20"
                                    style={{
                                        borderBottomColor: ag.accentColor ? `${ag.accentColor}40` : 'rgba(139, 92, 246, 0.15)',
                                        backgroundColor: ag.accentColor ? `${ag.accentColor}14` : 'rgba(139, 92, 246, 0.05)',
                                    }}
                                >
                                    <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                                        <Building2
                                            className="w-5 h-5 shrink-0"
                                            style={{ color: ag.accentColor ?? '#a78bfa' }}
                                        />
                                        <h3 className="brand-text font-semibold truncate">{ag.headerTitle}</h3>
                                        {ag.agencyStatus && ag.agencyStatus !== 'active' && (
                                            <span className="text-[10px] text-amber-300/90 bg-amber-500/15 px-2 py-0.5 rounded-full capitalize">
                                                {ag.agencyStatus}
                                            </span>
                                        )}
                                        {ag.groupKind === 'agency' ? (
                                            <span className="text-[11px] text-violet-300/70 bg-violet-500/10 px-2 py-0.5 rounded-full">
                                                Agency
                                            </span>
                                        ) : (
                                            <span className="text-[11px] brand-muted bg-gray-700/60 px-2 py-0.5 rounded-full">
                                                Organization
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-xs brand-muted shrink-0">
                                        {ag.sellers.length} seller{ag.sellers.length !== 1 ? 's' : ''} &middot; {ag.totalShops} shop{ag.totalShops !== 1 ? 's' : ''}
                                    </span>
                                </div>

                                {/* Sellers within this agency */}
                                <div className="p-4 space-y-5">
                                    {ag.sellers.map((seller) => (
                                        <div key={seller.sellerId}>
                                            <div className="flex items-center gap-2 mb-2.5 pl-1">
                                                <Store
                                                    className="w-3.5 h-3.5 shrink-0"
                                                    style={{ color: ag.accentColor ?? 'var(--brand-primary)' }}
                                                />
                                                <span className="text-xs font-semibold brand-muted uppercase tracking-wide">
                                                    {seller.sellerName}
                                                </span>
                                                <span className="text-[11px] opacity-75 brand-muted">
                                                    {seller.shops.length} {seller.shops.length === 1 ? 'shop' : 'shops'}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                                {seller.shops.map((shop) => (
                                                    <ShopCard key={shop.id} shop={shop} onSelect={onSelectShop} />
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Independent / unmanaged sellers */}
                        {independentShops.length > 0 && (
                            <div className="rounded-2xl border border-gray-700 bg-gray-800/30 overflow-hidden">
                                <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-700 bg-gray-800/40">
                                    <div className="flex items-center gap-2.5">
                                        <Globe className="w-5 h-5 brand-muted" />
                                        <h3 className="brand-text font-semibold">Independent sellers</h3>
                                        <span className="text-[11px] brand-muted bg-gray-700/50 px-2 py-0.5 rounded-full">
                                            No agency
                                        </span>
                                    </div>
                                    <span className="text-xs brand-muted">
                                        {independentShops.length} shop{independentShops.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                                <div className="p-4">
                                    <IndependentShopsGrid shops={independentShops} onSelect={onSelectShop} />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Non-admin view: simple tenant grouping */}
                {!loadingShops && !isUnrestrictedViewer && simpleGroups.length > 0 && (
                    <div className="space-y-6">
                        {simpleGroups.map(([tenantKey, { tenantName, tenantType, shops }]) => (
                            <div key={tenantKey}>
                                {simpleGroups.length > 1 && (
                                    <div className="flex items-center gap-2 mb-3">
                                        {tenantType === 'agency' ? (
                                            <Building2 className="w-4 h-4 text-violet-400" />
                                        ) : (
                                            <Store className="w-4 h-4 text-mamba-neon" />
                                        )}
                                        <h3 className="text-sm font-semibold brand-muted uppercase tracking-wide">
                                            {tenantName}
                                        </h3>
                                        <span className="text-xs opacity-75 brand-muted">
                                            {shops.length} {shops.length === 1 ? 'shop' : 'shops'}
                                        </span>
                                    </div>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {shops.map((shop) => (
                                        <ShopCard key={shop.id} shop={shop} onSelect={onSelectShop} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

function ShopCard({ shop, onSelect }: { shop: VisibleShop; onSelect: (s: VisibleShop) => void }) {
    const sellerLocked = shop.tenant_status === 'inactive' || shop.tenant_status === 'suspended';

    return (
        <button
            type="button"
            onClick={() => {
                if (sellerLocked) return;
                onSelect(shop);
            }}
            disabled={sellerLocked}
            className={`group relative text-left rounded-3xl p-5 transition-all duration-500 overflow-hidden backdrop-blur-sm brand-card hover:opacity-[0.98] shadow-lg hover:shadow-xl ${
                sellerLocked ? 'opacity-70 cursor-not-allowed' : 'hover:-translate-y-1.5 hover:shadow-xl'
            }`}
        >
            <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{
                    background: `linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 12%, transparent), transparent)`,
                }}
            />

            <div className="relative z-10 flex flex-col h-full">
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0 flex-1">
                        <div className="brand-text font-bold truncate text-lg tracking-tight transition-colors duration-300 group-hover:opacity-95">
                            {shop.shop_name}
                        </div>
                        <div className="text-xs brand-muted mt-1 truncate max-w-[95%] font-medium flex items-center gap-1.5">
                            <Store className="w-3 h-3 opacity-70 brand-muted" />
                            {shop.account_name}
                        </div>
                    </div>
                    <span
                        className="shrink-0 text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full whitespace-nowrap shadow-inner border"
                        style={{
                            color: 'var(--brand-primary)',
                            backgroundColor: 'color-mix(in srgb, var(--brand-primary) 14%, transparent)',
                            borderColor: 'color-mix(in srgb, var(--brand-primary) 35%, transparent)',
                        }}
                    >
                        {shop.region}
                    </span>
                </div>
                {sellerLocked && (
                    <div className="mb-3 inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                        Seller {shop.tenant_status}
                    </div>
                )}

                <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between">
                    <span className="text-[11px] font-semibold tracking-wide uppercase brand-muted bg-gray-900/50 border border-white/5 px-2.5 py-1 rounded-lg">
                        {shop.seller_type}
                    </span>
                    {sellerLocked ? (
                        <span className="text-[11px] font-semibold text-amber-300/90 tracking-wide uppercase">
                            Locked
                        </span>
                    ) : (
                        <span className="text-[11px] font-semibold opacity-75 brand-muted group-hover:opacity-100 transition-colors flex items-center gap-1 tracking-wide uppercase">
                            View <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform duration-300" />
                        </span>
                    )}
                </div>
            </div>
        </button>
    );
}

function IndependentShopsGrid({ shops, onSelect }: { shops: VisibleShop[]; onSelect: (s: VisibleShop) => void }) {
    // Group independent shops by their seller tenant
    const grouped = useMemo(() => {
        const map = new Map<string, { name: string; shops: VisibleShop[] }>();
        for (const shop of shops) {
            const key = shop.tenant_id ?? shop.account_id;
            if (!map.has(key)) map.set(key, { name: shop.tenant_name ?? shop.account_name, shops: [] });
            map.get(key)!.shops.push(shop);
        }
        return [...map.entries()];
    }, [shops]);

    return (
        <div className="space-y-4">
            {grouped.map(([key, { name, shops: groupShops }]) => (
                <div key={key}>
                    {grouped.length > 1 && (
                        <div className="flex items-center gap-2 mb-2 pl-1">
                            <Store className="w-3.5 h-3.5 opacity-80" style={{ color: 'var(--brand-primary)' }} />
                            <span className="text-xs font-semibold brand-muted uppercase tracking-wide">{name}</span>
                            <span className="text-[11px] opacity-75 brand-muted">
                                {groupShops.length} {groupShops.length === 1 ? 'shop' : 'shops'}
                            </span>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {groupShops.map((shop) => (
                            <ShopCard key={shop.id} shop={shop} onSelect={onSelect} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
