import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, BookOpen, Building2, ChevronRight, Globe, LayoutDashboard, Loader2, Shield, Store, UserMinus, UserPlus, Search, AlertCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { platformCreateAgencyWithOwner, platformLinkSellerToAgency, type PlatformProfileSearchRow, type PlatformTenantSearchRow } from '../../lib/platformRpc';
import { grantSuperAdminMembership, listPlatformSuperAdmins, revokeSuperAdminMembership } from '../../lib/tenantRolesRpc';
import { useTenantContext } from '../../contexts/TenantContext';
import { OperatorProfilePicker, OperatorTenantPicker } from '../platform/PlatformOperatorPickers';

type SuperAdminRow = {
    user_id: string;
    email: string | null;
    full_name: string | null;
    membership_id: string;
};

type TabId = 'guide' | 'agencies' | 'directory' | 'super';

export function PlatformTenantsView() {
    const { isPlatformSuperAdmin } = useTenantContext();
    const queryClient = useQueryClient();
    const canManageSuperAdmins = isPlatformSuperAdmin;

    const [tab, setTab] = useState<TabId>('agencies');
    const [busy, setBusy] = useState<string | null>(null);
    const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

    const [agencyName, setAgencyName] = useState('');
    const [agencyOwner, setAgencyOwner] = useState<PlatformProfileSearchRow | null>(null);
    const [linkAgency, setLinkAgency] = useState<PlatformTenantSearchRow | null>(null);
    const [linkSeller, setLinkSeller] = useState<PlatformTenantSearchRow | null>(null);

    const [superGrantUser, setSuperGrantUser] = useState<PlatformProfileSearchRow | null>(null);
    const [superAdminUuidFallback, setSuperAdminUuidFallback] = useState('');
    const [showSuperUuidAdvanced, setShowSuperUuidAdvanced] = useState(false);

    const [directoryKind, setDirectoryKind] = useState<'all' | 'agency' | 'seller' | 'platform'>('all');
    const [directoryQuery, setDirectoryQuery] = useState('');

    const { data: rows = [], isLoading, error } = useQuery({
        queryKey: ['platform-tenants'],
        queryFn: async () => {
            const { data, error: e } = await supabase
                .from('tenants')
                .select('id, name, type, status, parent_tenant_id, created_at')
                .order('created_at', { ascending: false })
                .limit(500);
            if (e) throw e;
            return data || [];
        },
    });

    const filteredDirectory = useMemo(() => {
        const q = directoryQuery.trim().toLowerCase();
        return rows.filter((t: { id: string; name: string; type: string }) => {
            if (directoryKind !== 'all' && t.type !== directoryKind) return false;
            if (!q) return true;
            return t.name?.toLowerCase().includes(q) || String(t.id).toLowerCase().includes(q);
        });
    }, [rows, directoryKind, directoryQuery]);

    const {
        data: superAdmins = [],
        isLoading: loadingAdmins,
        error: adminsError,
    } = useQuery({
        queryKey: ['platform-super-admins'],
        queryFn: async () => {
            const { data, error: e } = await listPlatformSuperAdmins();
            if (e) throw e;
            return (data || []) as SuperAdminRow[];
        },
        enabled: canManageSuperAdmins,
    });

    const flash = (type: 'ok' | 'err', text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 6000);
    };

    const superGrantTargetId = superGrantUser?.id?.trim() || superAdminUuidFallback.trim();

    const grant = async () => {
        const id = superGrantTargetId;
        if (!id) return;
        setBusy('grant');
        const { error: e } = await grantSuperAdminMembership(id);
        setBusy(null);
        if (e) {
            flash('err', e.message);
            return;
        }
        setSuperGrantUser(null);
        setSuperAdminUuidFallback('');
        flash('ok', 'Super Admin membership granted (platform tenant).');
        queryClient.invalidateQueries({ queryKey: ['platform-super-admins'] });
        queryClient.invalidateQueries({ queryKey: ['tenant-memberships'] });
    };

    const createAgencyForOwner = async () => {
        const owner = agencyOwner?.id;
        if (!owner) return;
        setBusy('create-agency');
        const { data, error: e } = await platformCreateAgencyWithOwner(owner, agencyName.trim() || 'Agency');
        setBusy(null);
        if (e) {
            flash('err', e.message);
            return;
        }
        setAgencyName('');
        setAgencyOwner(null);
        flash('ok', `Agency created. Tenant id: ${data}`);
        queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
        queryClient.invalidateQueries({ queryKey: ['tenant-memberships'] });
    };

    const linkSellerUnderAgency = async () => {
        const a = linkAgency?.id;
        const s = linkSeller?.id;
        if (!a || !s) return;
        setBusy('link-seller');
        const { error: e } = await platformLinkSellerToAgency(a, s);
        setBusy(null);
        if (e) {
            flash('err', e.message);
            return;
        }
        setLinkSeller(null);
        flash('ok', 'Seller is now under that agency in the hierarchy.');
        queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
    };

    const revoke = async (userId: string) => {
        if (!confirm('Revoke Super Admin membership for this user?')) return;
        setBusy(`revoke-${userId}`);
        const { error: e } = await revokeSuperAdminMembership(userId);
        setBusy(null);
        if (e) {
            flash('err', e.message);
            return;
        }
        flash('ok', 'Membership revoked.');
        queryClient.invalidateQueries({ queryKey: ['platform-super-admins'] });
        queryClient.invalidateQueries({ queryKey: ['tenant-memberships'] });
    };

    const tabs: { id: TabId; label: string; icon: typeof Globe }[] = [
        { id: 'agencies', label: 'Agencies & hierarchy', icon: Building2 },
        { id: 'directory', label: 'Tenant directory', icon: LayoutDashboard },
        { id: 'super', label: 'Super Admins', icon: Shield },
        { id: 'guide', label: 'Model guide', icon: BookOpen },
    ];

    return (
        <div className="w-full max-w-none animate-in fade-in duration-500 pb-12 relative">
            <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-blue-500/10 via-pink-500/5 to-transparent -z-10 rounded-full blur-[100px] opacity-60 pointer-events-none" />
            
            <div className="relative z-10 mb-8">
                <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-100 to-white flex items-center gap-4">
                    <div className="p-2.5 bg-blue-500/10 rounded-2xl border border-blue-500/20 backdrop-blur-xl">
                        <Globe className="w-8 h-8 text-blue-400 drop-shadow-lg" />
                    </div>
                    Platform Tenants
                </h1>
                <p className="text-gray-400/90 mt-4 text-base max-w-2xl leading-relaxed">
                    Internal tools for platform operators. Search people and organizations, then run bootstrap actions without juggling raw UUIDs. Requires legacy <code className="text-pink-300/80">profiles.role = admin</code> or a <strong className="text-gray-200">Super Admin</strong> membership.
                </p>
            </div>

            <div className="flex flex-wrap gap-3 mb-8 relative z-10">
                {tabs.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setTab(id)}
                        className={`inline-flex items-center gap-2.5 px-5 py-2.5 rounded-2xl text-sm font-bold transition-all duration-300 border ${
                            tab === id
                                ? 'bg-blue-600/90 text-white shadow-xl shadow-blue-900/40 border-blue-500/50 -translate-y-0.5'
                                : 'bg-white/[0.02] text-gray-400 border-white/10 hover:text-white hover:border-white/20 hover:bg-white/5'
                        }`}
                    >
                        <Icon className="w-4 h-4" />
                        {label}
                    </button>
                ))}
            </div>

            {msg && (
                <div
                    className={`mb-6 text-sm px-4 py-3 rounded-xl border ${
                        msg.type === 'ok'
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                            : 'bg-red-500/10 border-red-500/30 text-red-300'
                    }`}
                >
                    {msg.text}
                </div>
            )}

            {tab === 'guide' && (
                <section className="rounded-2xl border border-gray-700 bg-gray-900/40 p-6 text-sm text-gray-300 space-y-4">
                    <h2 className="text-white font-semibold text-lg">How this maps to your product</h2>
                    <ul className="list-disc pl-5 space-y-3 text-gray-400">
                        <li>
                            <strong className="text-gray-200">Seller</strong> tenant holds TikTok shops via{' '}
                            <code className="text-gray-500">accounts.tenant_id</code>. Dashboard rows still depend on{' '}
                            <code className="text-gray-500">user_accounts</code> — use Team &amp; roles or{' '}
                            <code className="text-gray-500">grant_user_access_to_seller_account</code> for access.
                        </li>
                        <li>
                            <strong className="text-gray-200">Agency</strong> tenant (no parent) manages linked sellers through{' '}
                            <code className="text-gray-500">parent_tenant_id</code> on the seller tenant.
                        </li>
                        <li>
                            <strong className="text-gray-200">Agencies &amp; hierarchy</strong> tab is the supported place to
                            create an agency for an owner and attach seller organizations — search pickers replace UUID
                            text fields.
                        </li>
                    </ul>
                    <p className="text-xs text-gray-600 pt-2 border-t border-gray-800">
                        Apply <code className="text-gray-500">20260325130000_platform_agency_bootstrap_account_access.sql</code>{' '}
                        and <code className="text-gray-500">20260325140000_platform_search_rpcs.sql</code> if RPCs are missing.
                    </p>
                </section>
            )}

            {tab === 'agencies' && canManageSuperAdmins && (
                <div className="space-y-8">
                    <section className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 relative overflow-hidden backdrop-blur-sm">
                        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent pointer-events-none" />
                        <div className="relative z-10">
                            <div className="flex items-center gap-2 text-violet-400 font-extrabold uppercase tracking-widest text-xs mb-2">
                                Step 1
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-2">Create an agency for an owner</h2>
                            <p className="text-sm text-gray-400/90 leading-relaxed mb-8 max-w-3xl">
                                Search for the future Agency Admin by name, email, or user id. Then name the organization. This
                                creates the agency tenant and grants that user Agency Admin.
                            </p>
                            <div className="grid md:grid-cols-2 gap-6 bg-gray-900/30 p-5 rounded-2xl border border-white/5">
                                <OperatorProfilePicker
                                    value={agencyOwner}
                                    onChange={setAgencyOwner}
                                    disabled={busy === 'create-agency'}
                                    label="Agency owner"
                                    hint="Must already have a profile row."
                                />
                                <div className="space-y-1.5 flex flex-col justify-end">
                                    <label className="text-xs text-gray-400 font-bold uppercase tracking-wider block mb-1">Agency display name</label>
                                    <input
                                        value={agencyName}
                                        onChange={(e) => setAgencyName(e.target.value)}
                                        placeholder="e.g. Acme Media"
                                        disabled={busy === 'create-agency'}
                                        className="w-full bg-gray-950/80 border border-white/10 rounded-xl px-4 py-3 text-sm text-white disabled:opacity-50 placeholder-gray-600 focus:border-violet-500/50 focus:outline-none transition-all"
                                    />
                                </div>
                            </div>
                            <button
                                type="button"
                                disabled={busy === 'create-agency' || !agencyOwner}
                                onClick={createAgencyForOwner}
                                className="mt-8 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2 hover:shadow-lg hover:shadow-violet-500/20 transition-all hover:-translate-y-0.5"
                            >
                                {busy === 'create-agency' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                Create agency &amp; assign owner
                            </button>
                        </div>
                    </section>

                    <section className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 relative overflow-hidden backdrop-blur-sm mt-8">
                        <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500/5 to-transparent pointer-events-none" />
                        <div className="relative z-10">
                            <div className="flex items-center gap-2 text-fuchsia-400 font-extrabold uppercase tracking-widest text-xs mb-2">
                                Step 2
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-2">Attach a seller organization to an agency</h2>
                            <p className="text-sm text-gray-400/90 leading-relaxed mb-8 max-w-3xl">
                                Pick the parent agency, then the seller tenant to move under it. This sets{' '}
                                <code className="text-gray-300 font-bold bg-white/5 px-1.5 py-0.5 rounded">parent_tenant_id</code> — the same outcome as Agency console
                                &quot;Link seller&quot;, without needing that agency&apos;s admin session.
                            </p>

                            <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-4 items-center bg-gray-900/30 p-5 rounded-2xl border border-white/5">
                                <OperatorTenantPicker
                                    kind="agency"
                                    value={linkAgency}
                                    onChange={setLinkAgency}
                                    disabled={busy === 'link-seller'}
                                    label="Parent agency"
                                    hint="Search by agency name or tenant id."
                                />
                                <div className="hidden md:flex flex-col items-center justify-center text-fuchsia-500 bg-fuchsia-500/10 p-2 rounded-full mt-4 border border-fuchsia-500/20 shadow-[0_0_15px_rgba(217,70,239,0.3)]">
                                    <ChevronRight className="w-5 h-5" />
                                </div>
                                <div className="md:hidden flex justify-center py-2 text-fuchsia-500">
                                    <div className="bg-fuchsia-500/10 p-2 rounded-full border border-fuchsia-500/20 shadow-[0_0_15px_rgba(217,70,239,0.3)]">
                                        <ArrowDown className="w-5 h-5" />
                                    </div>
                                </div>
                                <OperatorTenantPicker
                                    kind="seller"
                                    value={linkSeller}
                                    onChange={setLinkSeller}
                                    disabled={busy === 'link-seller'}
                                    label="Seller to attach"
                                    hint="Only seller-type tenants are listed."
                                />
                            </div>

                            {linkAgency && linkSeller ? (
                                <div className="mt-6 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 px-5 py-3.5 text-sm text-fuchsia-200/80 flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-fuchsia-500 animate-pulse" />
                                    <span>
                                        <span className="text-white font-bold">{linkSeller.name}</span> will sit under <span className="text-white font-bold">{linkAgency.name}</span> in the hierarchy.
                                    </span>
                                </div>
                            ) : null}

                            <button
                                type="button"
                                disabled={busy === 'link-seller' || !linkAgency || !linkSeller}
                                onClick={linkSellerUnderAgency}
                                className="mt-8 px-6 py-3 rounded-xl border border-fuchsia-500/50 bg-white/5 text-fuchsia-50 hover:bg-fuchsia-500/20 hover:border-fuchsia-400 text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2 hover:shadow-lg hover:shadow-fuchsia-500/20 transition-all hover:-translate-y-0.5"
                            >
                                {busy === 'link-seller' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                Attach seller to agency
                            </button>
                        </div>
                    </section>
                </div>
            )}

            {tab === 'agencies' && !canManageSuperAdmins && (
                <p className="text-gray-500 text-sm">You do not have access to operator actions on this tab.</p>
            )}

            {tab === 'directory' && (
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-gray-900/40 p-3 rounded-2xl border border-white/5">
                        <div className="relative flex-1 max-w-md">
                            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-500">
                                <Search className="w-4 h-4" />
                            </div>
                            <input
                                value={directoryQuery}
                                onChange={(e) => setDirectoryQuery(e.target.value)}
                                placeholder="Filter by name or id…"
                                className="w-full bg-gray-950/80 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white focus:border-blue-500/50 focus:outline-none transition-all placeholder-gray-600"
                            />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {(
                                [
                                    ['all', 'All'],
                                    ['agency', 'Agencies'],
                                    ['seller', 'Sellers'],
                                    ['platform', 'Platform'],
                                ] as const
                            ).map(([k, lab]) => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => setDirectoryKind(k)}
                                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border ${
                                        directoryKind === k
                                            ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20'
                                            : 'bg-white/5 text-gray-400 border-white/5 hover:text-white hover:bg-white/10'
                                    }`}
                                >
                                    {lab}
                                </button>
                            ))}
                        </div>
                    </div>
                    <p className="text-xs text-gray-600">
                        Showing {filteredDirectory.length} of {rows.length} tenants (max 500 loaded).
                    </p>
                    {isLoading && <Loader2 className="w-6 h-6 animate-spin text-gray-500" />}
                    {error && <p className="text-red-400 text-sm">{(error as Error).message}</p>}
                    {!isLoading && !error && (
                        <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/[0.02] backdrop-blur-sm relative">
                            <table className="w-full text-sm text-left min-w-[640px]">
                                <thead>
                                    <tr className="text-gray-400 border-b border-white/10 text-xs uppercase tracking-wider bg-gray-900/50">
                                        <th className="p-4 font-bold">Type</th>
                                        <th className="p-4 font-bold">Name</th>
                                        <th className="p-4 font-bold">Status</th>
                                        <th className="p-4 font-bold">Parent</th>
                                        <th className="p-4 font-bold font-mono text-[10px]">id</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-300">
                                    {filteredDirectory.map((t: any) => (
                                        <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                            <td className="p-4">
                                                {t.type === 'agency' ? (
                                                    <span className="inline-flex items-center gap-1.5 text-violet-300 font-medium bg-violet-500/10 px-2.5 py-1 text-xs rounded-lg border border-violet-500/20">
                                                        <Building2 className="w-3 h-3" /> Agency
                                                    </span>
                                                ) : t.type === 'platform' ? (
                                                    <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium bg-amber-500/10 px-2.5 py-1 text-xs rounded-lg border border-amber-500/20">
                                                        <Shield className="w-3 h-3" /> Platform
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 text-pink-300 font-medium bg-pink-500/10 px-2.5 py-1 text-xs rounded-lg border border-pink-500/20">
                                                        <Store className="w-3 h-3" /> Seller
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-4 text-white font-bold">{t.name}</td>
                                            <td className="p-4">
                                                <span className={`inline-flex items-center px-2 py-1 rounded text-[11px] font-bold uppercase tracking-wider ${
                                                    t.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                                                }`}>
                                                    {t.status}
                                                </span>
                                            </td>
                                            <td className="p-4 font-mono text-xs text-gray-500 max-w-[140px] truncate" title={t.parent_tenant_id}>
                                                {t.parent_tenant_id || '—'}
                                            </td>
                                            <td className="p-4 font-mono text-[11px] text-gray-500 max-w-[160px] truncate" title={t.id}>
                                                {t.id}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {filteredDirectory.length === 0 ? (
                                <div className="p-12 text-center flex flex-col items-center justify-center text-gray-500">
                                    <Globe className="w-8 h-8 mb-3 opacity-20" />
                                    <p className="text-sm">No tenants match this filter.</p>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            )}

            {tab === 'super' && canManageSuperAdmins && (
                <section className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 relative overflow-hidden backdrop-blur-sm">
                    <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent pointer-events-none" />
                    <div className="relative z-10">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-3 mb-2">
                            <div className="p-2 bg-pink-500/20 rounded-xl">
                                <Shield className="w-6 h-6 text-pink-400" />
                            </div>
                            Super Admin memberships
                        </h2>
                        <p className="text-sm text-gray-400/90 leading-relaxed mb-8 max-w-3xl">
                            Grants the <code className="text-gray-300 font-bold bg-white/5 px-1.5 py-0.5 rounded">Super Admin</code> role on the internal platform tenant. Use
                            search to find the user, or expand advanced to paste a UUID.
                        </p>

                        <div className="grid md:grid-cols-2 gap-6 mb-8 bg-gray-900/30 p-5 rounded-2xl border border-white/5">
                            <OperatorProfilePicker
                                value={superGrantUser}
                                onChange={(u) => {
                                    setSuperGrantUser(u);
                                    if (u) setSuperAdminUuidFallback('');
                                }}
                                disabled={busy === 'grant'}
                                label="User to promote"
                                hint="Same search as agency owner: name, email, or id."
                            />
                            <div className="space-y-3 flex flex-col justify-end">
                                <button
                                    type="button"
                                    onClick={() => setShowSuperUuidAdvanced((v) => !v)}
                                    className="text-xs text-pink-400 hover:text-pink-300 font-bold uppercase tracking-wider text-left transition-colors flex items-center gap-1"
                                >
                                    <ChevronRight className={`w-3 h-3 transition-transform ${showSuperUuidAdvanced ? 'rotate-90' : ''}`} />
                                    {showSuperUuidAdvanced ? 'Hide' : 'Show'} advanced — paste UUID
                                </button>
                                {showSuperUuidAdvanced ? (
                                    <div className="animate-in fade-in slide-in-from-top-2">
                                        <label className="block text-xs text-gray-400 font-bold uppercase tracking-wider mb-1.5">User id (UUID)</label>
                                        <input
                                            value={superAdminUuidFallback}
                                            onChange={(e) => {
                                                setSuperAdminUuidFallback(e.target.value);
                                                if (e.target.value.trim()) setSuperGrantUser(null);
                                            }}
                                            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                            disabled={busy === 'grant'}
                                            className="w-full bg-gray-950/80 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono text-white disabled:opacity-50 placeholder-gray-600 focus:border-pink-500/50 focus:outline-none transition-all"
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <button
                            type="button"
                            disabled={busy === 'grant' || !superGrantTargetId}
                            onClick={grant}
                            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white text-sm font-bold disabled:opacity-50 mb-10 hover:shadow-lg hover:shadow-pink-500/20 transition-all hover:-translate-y-0.5"
                        >
                            {busy === 'grant' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                            Grant Super Admin
                        </button>

                        {adminsError && (
                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-amber-400 text-sm mb-6 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                <p>
                                    {(adminsError as Error).message}. Apply migration{' '}
                                    <code className="text-amber-200">20260325100000_platform_custom_roles_super_admin.sql</code> if this
                                    RPC is missing.
                                </p>
                            </div>
                        )}
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Current Super Admins</h3>
                        {loadingAdmins ? (
                            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
                        ) : (
                            <ul className="space-y-3">
                                {superAdmins.length === 0 ? (
                                    <li className="text-gray-500 text-sm bg-gray-900/30 rounded-2xl p-6 text-center border border-white/5">
                                        No explicit Super Admin memberships (legacy admins may still exist).
                                    </li>
                                ) : (
                                    superAdmins.map((a) => (
                                        <li
                                            key={a.membership_id}
                                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/[0.02] hover:bg-white/[0.04] transition-colors rounded-2xl p-4 border border-white/5"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 border border-white/10 flex items-center justify-center shrink-0">
                                                    <span className="text-white font-bold text-sm">
                                                        {(a.full_name || a.email || '?')[0].toUpperCase()}
                                                    </span>
                                                </div>
                                                <div>
                                                    <div className="text-white font-bold">{a.full_name || a.email || '—'}</div>
                                                    <div className="text-xs text-gray-400 mt-0.5">{a.email}</div>
                                                    <div className="text-[10px] text-gray-500 font-mono mt-1 flex items-center gap-1.5">
                                                        <span className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-400 border border-gray-700">ID</span> {a.user_id}
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={busy === `revoke-${a.user_id}`}
                                                onClick={() => revoke(a.user_id)}
                                                className="flex items-center justify-center gap-2 text-sm text-red-400 font-bold hover:text-red-300 px-4 py-2 rounded-xl border border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40 transition-all sm:w-auto w-full"
                                            >
                                                {busy === `revoke-${a.user_id}` ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <UserMinus className="w-4 h-4" />
                                                )}
                                                Revoke
                                            </button>
                                        </li>
                                    ))
                                )}
                            </ul>
                        )}
                    </div>
                </section>
            )}

            {tab === 'super' && !canManageSuperAdmins && (
                <p className="text-gray-500 text-sm">You do not have access to manage Super Admins.</p>
            )}
        </div>
    );
}
