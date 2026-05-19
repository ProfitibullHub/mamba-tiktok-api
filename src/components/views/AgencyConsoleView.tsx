import { useState, useMemo, useEffect } from 'react';
import {
    Building2,
    Users,
    Settings,
    Store,
    Loader2,
    Shield,
    Check,
    Link2,
    Copy,
    UserPlus,
    Pencil,
    Search,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useTenantContext } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { agencyGrantStaffSellerAccess, agencyLinkSellerTenant } from '../../lib/agencyRpc';
import { tenantSetMemberRole } from '../../lib/tenantRolesRpc';
import {
    getPendingSellerLinks,
    inviteTeamMember,
    linkSellerToAgency,
    searchTeamProfiles,
    searchSellerTenants,
    unlinkAgencySeller,
    getAgencySellerAssignments,
    unassignSellerAccess,
    type AgencySellerAssignmentRow,
    type PendingSellerLinkRow,
    type SellerSearchRow,
    type TeamProfileRow,
} from '../../lib/teamApi';
import { patchAgencyTenantAsAdmin } from '../../lib/adminTenantsApi';
import { showAppToast } from '../../store/useAppToastStore';

/** Match system and custom AM/AC-style role titles (e.g. "Test Account Manager"). */
function roleLabelLooksLikeAccountManager(roleName: string | null | undefined): boolean {
    return (roleName || '').toLowerCase().includes('account manager');
}
function roleLabelLooksLikeAccountCoordinator(roleName: string | null | undefined): boolean {
    return (roleName || '').toLowerCase().includes('account coordinator');
}

type ChildTenant = {
    id: string;
    name: string;
    type: string;
    status: string;
    parent_tenant_id: string | null;
    link_status?: 'pending' | 'active';
};

export function AgencyConsoleView() {
    const { agencyMemberships, isAgencyAdminOn, isAccountManagerOn, memberships, isPlatformSuperAdmin } =
        useTenantContext();
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [selectedAgencyId, setSelectedAgencyId] = useState<string | null>(
        () => agencyMemberships[0]?.tenant_id ?? null
    );
    const [sellerTenantToLink, setSellerTenantToLink] = useState('');
    const [staffRoleId, setStaffRoleId] = useState('');
    const [staffSearchQuery, setStaffSearchQuery] = useState('');
    const [staffSearchResults, setStaffSearchResults] = useState<TeamProfileRow[]>([]);
    const [staffSearchLoading, setStaffSearchLoading] = useState(false);
    const [staffPickedUser, setStaffPickedUser] = useState<TeamProfileRow | null>(null);
    const [staffInviteEmail, setStaffInviteEmail] = useState('');
    const [assignStaffUserId, setAssignStaffUserId] = useState('');
    const [assignSellerTenantId, setAssignSellerTenantId] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const [agencySettingsName, setAgencySettingsName] = useState('');
    const [agencySettingsOpen, setAgencySettingsOpen] = useState(false);

    const [sellerSearchQuery, setSellerSearchQuery] = useState('');
    const [sellerLookupQuery, setSellerLookupQuery] = useState('');
    const [sellerLookupResults, setSellerLookupResults] = useState<SellerSearchRow[]>([]);
    const [sellerLookupLoading, setSellerLookupLoading] = useState(false);
    const [sellerLookupSelection, setSellerLookupSelection] = useState<SellerSearchRow | null>(null);
    const [staffFilterQuery, setStaffFilterQuery] = useState('');

    useEffect(() => {
        if (!selectedAgencyId && agencyMemberships[0]) {
            setSelectedAgencyId(agencyMemberships[0].tenant_id);
        }
    }, [agencyMemberships, selectedAgencyId]);

    const selected = useMemo(
        () => agencyMemberships.find((m) => m.tenant_id === selectedAgencyId),
        [agencyMemberships, selectedAgencyId]
    );

    const { data: myAgencyPermActions = [] } = useQuery({
        queryKey: ['my-agency-effective-perms', selectedAgencyId, user?.id],
        queryFn: async () => {
            if (!selectedAgencyId || !user?.id) return [];
            const { data, error } = await supabase.rpc('get_my_effective_permissions_on_tenant', {
                p_tenant_id: selectedAgencyId,
            });
            if (error) throw error;
            return (data || [])
                .map((row: { action?: string }) => row.action)
                .filter((a: string | undefined): a is string => typeof a === 'string');
        },
        enabled: !!selectedAgencyId && !!user?.id,
    });

    const canAdmin = selectedAgencyId
        ? isAgencyAdminOn(selectedAgencyId) ||
          myAgencyPermActions.includes('agency.sellers.link') ||
          myAgencyPermActions.includes('billing.manage')
        : false;
    const canManageStaff = canAdmin || (selectedAgencyId ? isAccountManagerOn(selectedAgencyId) : false);

    const canLinkSellers =
        canAdmin || isPlatformSuperAdmin || myAgencyPermActions.includes('agency.sellers.link');
    /** Full linked-seller directory (admin UI) — not the AM/AC assigned-only slice */
    const canSeeAllLinkedSellers = canAdmin || canLinkSellers || isPlatformSuperAdmin;
    const hasCoordinatorRoleOnSelectedAgency =
        !!selectedAgencyId &&
        memberships.some((m: any) => {
            if (m.tenant_id !== selectedAgencyId || m.tenants?.type !== 'agency' || m.status !== 'active') return false;
            if (m.roles?.name === 'Account Coordinator') return true;
            const linked = Array.isArray(m.membership_roles) ? m.membership_roles : [];
            return linked.some((mr: any) => !mr?.revoked_at && mr?.roles?.name === 'Account Coordinator');
        });
    /** Team directory RPC returns names under profiles RLS — any staff who needs the console should use it. */
    const canLoadTeamDirectoryRpc =
        canManageStaff || hasCoordinatorRoleOnSelectedAgency || canLinkSellers;

    const canViewAgencyAssignmentMatrix =
        !!selectedAgencyId &&
        !!user?.id &&
        agencyMemberships.some((m) => m.tenant_id === selectedAgencyId && m.status === 'active');

    const { data: agencyDetail, isLoading: loadingAgencyDetail } = useQuery({
        queryKey: ['agency-console-tenant', selectedAgencyId],
        queryFn: async () => {
            if (!selectedAgencyId) return null;
            const { data, error } = await supabase.from('tenants').select('id, name, status').eq('id', selectedAgencyId).single();
            if (error) throw error;
            return data as { id: string; name: string; status: string };
        },
        enabled: !!selectedAgencyId,
    });

    const { data: linkedSellers = [], isLoading: loadingSellers } = useQuery({
        queryKey: ['agency-sellers', selectedAgencyId, canSeeAllLinkedSellers, user?.id],
        queryFn: async () => {
            if (!selectedAgencyId) return [];
            if (canSeeAllLinkedSellers) {
                const { data: activeRows, error: activeErr } = await supabase
                    .from('tenants')
                    .select('id, name, type, status, parent_tenant_id, link_status')
                    .eq('parent_tenant_id', selectedAgencyId)
                    .eq('type', 'seller')
                    .order('name');
                if (activeErr) throw activeErr;

                const pendingRows = await getPendingSellerLinks(selectedAgencyId);

                const merged = new Map<string, ChildTenant>();
                for (const row of activeRows || []) {
                    const seller = row as ChildTenant;
                    merged.set(seller.id, { ...seller, link_status: seller.link_status || 'active' });
                }
                for (const row of pendingRows || ([] as PendingSellerLinkRow[])) {
                    merged.set(row.seller_tenant_id, {
                        id: row.seller_tenant_id,
                        name: row.seller_name,
                        type: 'seller',
                        status: row.seller_status || 'active',
                        parent_tenant_id: row.parent_tenant_id,
                        link_status: 'pending',
                    });
                }

                return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
            }

            const { data, error } = await supabase
                .from('user_seller_assignments')
                .select('seller_tenant_id, tenants!seller_tenant_id(id, name, type, status, parent_tenant_id)')
                .eq('agency_tenant_id', selectedAgencyId)
                .eq('user_id', user!.id);
            if (error) throw error;

            return (data || [])
                .map((row: any) => row.tenants)
                .filter((row: any) => row && row.type === 'seller') as ChildTenant[];
        },
        enabled: !!selectedAgencyId && !!user?.id,
    });

    const { data: agencyAssignableRoles = [] } = useQuery({
        queryKey: ['agency-assignable-roles', selectedAgencyId, canAdmin],
        queryFn: async () => {
            if (!selectedAgencyId) return [];
            const [{ data: system, error: e1 }, { data: custom, error: e2 }] = await Promise.all([
                supabase
                    .from('roles')
                    .select('id,name,type,scope,tenant_id')
                    .is('tenant_id', null)
                    .eq('scope', 'agency')
                    .order('name'),
                supabase
                    .from('roles')
                    .select('id,name,type,scope,tenant_id')
                    .eq('tenant_id', selectedAgencyId)
                    .eq('type', 'custom')
                    .is('deleted_at', null)
                    .order('name'),
            ]);
            if (e1) throw e1;
            if (e2) throw e2;
            const sys = (system || []).filter((r: { name: string }) => r.name !== 'Super Admin');
            const allRoles = [...sys, ...(custom || [])];
            // AMs can only assign Account Coordinator
            if (!canAdmin) {
                return allRoles.filter((r: { name: string }) => r.name === 'Account Coordinator');
            }
            return allRoles;
        },
        enabled: !!selectedAgencyId,
    });

    useEffect(() => {
        if (agencyAssignableRoles.length > 0 && !staffRoleId) {
            setStaffRoleId((agencyAssignableRoles[0] as { id: string }).id);
        }
    }, [agencyAssignableRoles, staffRoleId, canAdmin]);

    useEffect(() => {
        if (!selectedAgencyId || !canManageStaff) {
            setStaffSearchResults([]);
            return;
        }
        const q = staffSearchQuery.trim();
        if (q.length < 2) {
            setStaffSearchResults([]);
            return;
        }
        let cancelled = false;
        const t = setTimeout(async () => {
            setStaffSearchLoading(true);
            try {
                const rows = await searchTeamProfiles(selectedAgencyId, q);
                if (!cancelled) setStaffSearchResults(rows);
            } catch {
                if (!cancelled) setStaffSearchResults([]);
            } finally {
                if (!cancelled) setStaffSearchLoading(false);
            }
        }, 350);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [staffSearchQuery, selectedAgencyId, canManageStaff]);

    useEffect(() => {
        if (!selectedAgencyId || !canLinkSellers) {
            setSellerLookupResults([]);
            return;
        }
        const q = sellerLookupQuery.trim();
        if (q.length < 2) {
            setSellerLookupResults([]);
            return;
        }
        let cancelled = false;
        const t = setTimeout(async () => {
            setSellerLookupLoading(true);
            try {
                const rows = await searchSellerTenants(selectedAgencyId, q);
                if (!cancelled) setSellerLookupResults(rows);
            } catch {
                if (!cancelled) setSellerLookupResults([]);
            } finally {
                if (!cancelled) setSellerLookupLoading(false);
            }
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [sellerLookupQuery, selectedAgencyId, canLinkSellers]);

    const { data: agencyTeam = [], isLoading: loadingTeam } = useQuery({
        queryKey: ['agency-team', selectedAgencyId, canLoadTeamDirectoryRpc],
        queryFn: async () => {
            if (!selectedAgencyId) return [];
            // SECURITY DEFINER RPC: AA, AM, and AC (on this agency) are allowed; returns emails/names despite profiles RLS.
            if (canLoadTeamDirectoryRpc) {
                const { data, error } = await supabase.rpc('tenant_directory_for_admin', {
                    p_tenant_id: selectedAgencyId,
                });
                if (error) throw error;
                return (data || []).map((r: Record<string, string>) => ({
                    id: r.membership_id,
                    user_id: r.user_id,
                    email: r.email,
                    full_name: r.full_name,
                    role_id: r.role_id,
                    role_name: r.role_name,
                    role_type: r.role_type,
                    status: r.status,
                }));
            }
            const { data, error } = await supabase
                .from('tenant_memberships')
                .select(`id, user_id, status, roles ( id, name, type )`)
                .eq('tenant_id', selectedAgencyId)
                .eq('status', 'active');
            if (error) throw error;
            return (data || []).map((row: any) => ({
                id: row.id,
                user_id: row.user_id,
                email: null as string | null,
                full_name: null as string | null,
                role_id: row.roles?.id,
                role_name: row.roles?.name,
                role_type: row.roles?.type,
                status: row.status,
            }));
        },
        enabled: !!selectedAgencyId,
    });

    const { data: sellerAssignments = [], isLoading: loadingAssignments } = useQuery({
        queryKey: ['agency-seller-assignments', selectedAgencyId, canViewAgencyAssignmentMatrix],
        queryFn: async () => {
            if (!selectedAgencyId) return [];
            if (canViewAgencyAssignmentMatrix) {
                return await getAgencySellerAssignments(selectedAgencyId);
            }
            const { data, error } = await supabase
                .from('user_seller_assignments')
                .select('seller_tenant_id,user_id')
                .eq('agency_tenant_id', selectedAgencyId)
                .eq('user_id', user!.id);
            if (error) throw error;
            return (data || []) as AgencySellerAssignmentRow[];
        },
        enabled: !!selectedAgencyId && !!user?.id,
    });

    const filteredSellers = useMemo(() => {
        if (!sellerSearchQuery.trim()) return linkedSellers;
        const q = sellerSearchQuery.toLowerCase();
        return linkedSellers.filter((s: ChildTenant) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    }, [linkedSellers, sellerSearchQuery]);

    const filteredTeam = useMemo(() => {
        if (!staffFilterQuery.trim()) return agencyTeam;
        const q = staffFilterQuery.toLowerCase();
        return agencyTeam.filter((u: any) => 
            (u.full_name && u.full_name.toLowerCase().includes(q)) ||
            (u.email && u.email.toLowerCase().includes(q)) ||
            u.user_id.toLowerCase().includes(q) ||
            (u.role_name && u.role_name.toLowerCase().includes(q))
        );
    }, [agencyTeam, staffFilterQuery]);

    const sellerLookupGrouped = useMemo(() => {
        const linkable = sellerLookupResults.filter((s) => s.linkable);
        const notLinkable = sellerLookupResults.filter((s) => !s.linkable);
        return { linkable, notLinkable };
    }, [sellerLookupResults]);

    // Staff members that can be assigned a seller (AM or AC)
    const assignableStaff = useMemo(() => {
        return agencyTeam.filter(
            (u: any) => roleLabelLooksLikeAccountManager(u.role_name) || roleLabelLooksLikeAccountCoordinator(u.role_name)
        );
    }, [agencyTeam]);

    const sellerAssignmentsBySeller = useMemo(() => {
        const teamByUserId = new Map<string, any>();
        for (const member of agencyTeam) {
            teamByUserId.set(member.user_id, member);
        }

        const grouped = new Map<string, any[]>();
        for (const row of sellerAssignments) {
            const member = teamByUserId.get(row.user_id);
            const withFallback = member || {
                user_id: row.user_id,
                full_name: null,
                email: null,
                role_name: 'Unknown',
            };
            const existing = grouped.get(row.seller_tenant_id) || [];
            existing.push(withFallback);
            grouped.set(row.seller_tenant_id, existing);
        }
        return grouped;
    }, [agencyTeam, sellerAssignments]);

    const sellerAssignmentCoverage = useMemo(() => {
        const amAssigned: ChildTenant[] = [];
        const acAssigned: ChildTenant[] = [];
        const unassigned: ChildTenant[] = [];

        for (const seller of linkedSellers) {
            const assignees = sellerAssignmentsBySeller.get(seller.id) || [];
            const hasAM = assignees.some((a: any) => roleLabelLooksLikeAccountManager(a.role_name));
            const hasAC = assignees.some((a: any) => roleLabelLooksLikeAccountCoordinator(a.role_name));

            if (!hasAM && !hasAC) {
                unassigned.push(seller);
                continue;
            }
            if (hasAM) amAssigned.push(seller);
            if (hasAC) acAssigned.push(seller);
        }

        return { amAssigned, acAssigned, unassigned };
    }, [linkedSellers, sellerAssignmentsBySeller]);

    const copyId = async (id: string) => {
        await navigator.clipboard.writeText(id);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    const flash = (type: 'ok' | 'err', text: string) => {
        showAppToast(text, type === 'ok' ? 'ok' : 'err');
    };


    const handleLinkSeller = async () => {
        if (!selectedAgencyId || !sellerTenantToLink.trim() || !canLinkSellers) return;
        setBusy('link');
        try {
            let result: { token: string; notifiedSellerAdmins: number; alreadyLinked: boolean } | null = null;
            try {
                result = await linkSellerToAgency(selectedAgencyId, sellerTenantToLink.trim());
            } catch (e: any) {
                const msg = String(e?.message || '');
                // Fallback path: keep link flow working even if API auth token is stale.
                if (/Not authenticated|401/.test(msg)) {
                    await agencyLinkSellerTenant(selectedAgencyId, sellerTenantToLink.trim());
                    result = { token: '', notifiedSellerAdmins: 0, alreadyLinked: false };
                    flash(
                        'err',
                        'Link request created, but notification delivery needs a fresh login. Please sign out/in and retry to notify Seller Admin.'
                    );
                } else {
                    throw e;
                }
            }
            setSellerTenantToLink('');
            setSellerLookupSelection(null);
            setSellerLookupQuery('');
            setSellerLookupResults([]);
            await queryClient.invalidateQueries({ queryKey: ['agency-sellers', selectedAgencyId] });
            if (result?.alreadyLinked) {
                flash('ok', 'Seller is already linked to this agency.');
            } else if (result && result.notifiedSellerAdmins > 0) {
                flash('ok', 'Seller link request sent. Seller Admin received notification/email. Status stays Pending until accepted.');
            } else {
                flash('ok', 'Seller link request is pending. If no notification appeared, verify seller has an active Seller Admin and retry after re-login.');
            }
        } catch (e: any) {
            flash('err', e.message || 'Link failed');
        } finally {
            setBusy(null);
        }
    };

    const handleAddStaffMember = async () => {
        if (!selectedAgencyId || !staffPickedUser || !staffRoleId) return;
        setBusy('staff');
        try {
            const r = await inviteTeamMember(
                selectedAgencyId,
                staffPickedUser.email || undefined,
                staffRoleId,
                staffPickedUser.id
            );
            setStaffPickedUser(null);
            setStaffSearchQuery('');
            await queryClient.invalidateQueries({ queryKey: ['agency-team', selectedAgencyId] });
            flash(
                'ok',
                r.invited
                    ? 'Invitation sent. User will see it in Notifications and receive email.'
                    : 'Existing active member found — role assigned successfully.'
            );
        } catch (e: any) {
            flash('err', e.message || 'Failed to add staff');
        } finally {
            setBusy(null);
        }
    };

    const handleInviteStaff = async () => {
        if (!selectedAgencyId || !staffInviteEmail.trim() || !staffRoleId) return;
        setBusy('invite-staff');
        try {
            const r = await inviteTeamMember(selectedAgencyId, staffInviteEmail.trim(), staffRoleId);
            setStaffInviteEmail('');
            await queryClient.invalidateQueries({ queryKey: ['agency-team', selectedAgencyId] });
            flash(
                'ok',
                r.invited
                    ? 'Invitation email sent! They will receive a magic link to set their password and join.'
                    : 'Existing user found — role assigned successfully.'
            );
        } catch (e: any) {
            flash('err', e.message || 'Invite failed');
        } finally {
            setBusy(null);
        }
    };

    const handleAgencyMemberRoleChange = async (userId: string, newRoleId: string) => {
        if (!selectedAgencyId) return;
        setBusy(`role-${userId}`);
        try {
            const { error } = await tenantSetMemberRole(selectedAgencyId, userId, newRoleId);
            if (error) throw error;
            await queryClient.invalidateQueries({ queryKey: ['agency-team', selectedAgencyId] });
            flash('ok', 'Role updated.');
        } catch (e: any) {
            flash('err', e.message || 'Failed to update role');
        } finally {
            setBusy(null);
        }
    };

    const handlePatchAgency = async (body: { name?: string; status?: string }) => {
        if (!selectedAgencyId || !canAdmin) return;
        setBusy('agency-settings');
        try {
            await patchAgencyTenantAsAdmin(selectedAgencyId, body);
            await queryClient.invalidateQueries({ queryKey: ['agency-console-tenant', selectedAgencyId] });
            await queryClient.invalidateQueries({ queryKey: ['tenant-memberships'] });
            setAgencySettingsOpen(false);
            flash('ok', 'Agency updated.');
        } catch (e: any) {
            flash('err', e.message || 'Update failed');
        } finally {
            setBusy(null);
        }
    };

    const handleAssignSeller = async () => {
        if (!selectedAgencyId || !assignStaffUserId.trim() || !assignSellerTenantId.trim()) return;
        setBusy('assign');
        try {
            await agencyGrantStaffSellerAccess(
                selectedAgencyId,
                assignStaffUserId.trim(),
                assignSellerTenantId.trim()
            );
            setAssignStaffUserId('');
            setAssignSellerTenantId('');
            flash('ok', 'Account Manager / Coordinator can now access that seller (per your RLS rules).');
        } catch (e: any) {
            flash('err', e.message || 'Assignment failed');
        } finally {
            setBusy(null);
        }
    };

    const handleUnlinkSeller = async (sellerTenantId: string) => {
        if (!selectedAgencyId || !canLinkSellers) return;
        setBusy(`unlink-${sellerTenantId}`);
        try {
            await unlinkAgencySeller(selectedAgencyId, sellerTenantId);
            await queryClient.invalidateQueries({ queryKey: ['agency-sellers', selectedAgencyId] });
            flash('ok', 'Seller unlinked. Agency assignments were cleared and future scheduled exports were disabled.');
        } catch (e: any) {
            flash('err', e.message || 'Unlink failed');
        } finally {
            setBusy(null);
        }
    };

    const handleUnassignSellerAccess = async (sellerTenantId: string, staffUserId: string) => {
        if (!selectedAgencyId || !canManageStaff) return;
        setBusy(`unassign-${sellerTenantId}-${staffUserId}`);
        try {
            await unassignSellerAccess(selectedAgencyId, sellerTenantId, staffUserId);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['agency-seller-assignments', selectedAgencyId] }),
                queryClient.invalidateQueries({ queryKey: ['agency-sellers', selectedAgencyId] }),
            ]);
            flash('ok', 'Seller unassigned from staff.');
        } catch (e: any) {
            flash('err', e.message || 'Unassign failed');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="w-full max-w-none space-y-10 animate-in fade-in duration-500 pb-12 relative">
            <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-violet-500/10 via-mamba-green/5 to-transparent -z-10 rounded-full blur-[100px] opacity-60 pointer-events-none" />

            <div className="relative z-10">
                <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-100 to-white flex items-center gap-4">
                    <div className="p-2.5 bg-violet-500/10 rounded-2xl border border-violet-500/20 backdrop-blur-xl">
                        <Building2 className="w-8 h-8 text-violet-400 drop-shadow-lg" />
                    </div>
                    Agency Console
                </h1>
                <p className="text-gray-400/90 mt-4 text-base max-w-2xl leading-relaxed">
                    Manage agency tenants, link seller organizations, staff roles, and scoped seller access.
                    Data isolation is enforced in Postgres (RLS) and on the API for TikTok routes.
                </p>
            </div>

            {/* Select agency */}
            {agencyMemberships.length > 0 && (
                <section className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 relative overflow-hidden backdrop-blur-sm">
                    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                    <div className="relative">
                        <div className="text-white font-bold text-lg mb-5 flex items-center gap-3">
                            <div className="p-2 bg-gray-800 rounded-xl border border-white/5">
                                <Building2 className="w-5 h-5 text-gray-300" />
                            </div>
                            Agency context
                        </div>
                        <div className="flex flex-wrap gap-3">
                            {agencyMemberships.map((m) => (
                                <button
                                    key={m.tenant_id}
                                    type="button"
                                    onClick={() => setSelectedAgencyId(m.tenant_id)}
                                    className={`px-5 py-3 rounded-2xl text-sm font-semibold transition-all border block text-left group hover:shadow-lg hover:-translate-y-0.5 ${selectedAgencyId === m.tenant_id
                                            ? 'bg-violet-500/20 border-violet-500/50 text-white shadow-violet-500/10'
                                            : 'bg-gray-900/50 border-white/10 text-gray-300 hover:border-violet-500/30 hover:bg-violet-500/5'
                                        }`}
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <span>{m.tenants?.name || 'Agency'}</span>
                                        {selectedAgencyId === m.tenant_id && <Check className="w-4 h-4 text-violet-400" />}
                                    </div>
                                    <span className={`block text-[11px] mt-1 ${selectedAgencyId === m.tenant_id ? 'text-violet-300' : 'text-gray-500 group-hover:text-gray-400'
                                        }`}>
                                        Role: {m.roles?.name}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                </section>
            )}

            {agencyMemberships.length === 0 && (
                <p className="text-gray-500 text-sm">
                    You are not a member of an agency tenant.
                </p>
            )}

            {selectedAgencyId && selected && (
                <>
                    <section className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 backdrop-blur-sm relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent pointer-events-none" />
                        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-violet-500/15 rounded-2xl border border-violet-500/25">
                                    <Settings className="w-6 h-6 text-violet-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">Agency settings</h2>
                                    <p className="text-sm text-gray-400 mt-1 max-w-xl">
                                        Organization name, status, and ID for this agency. Setting an agency inactive or suspended immediately removes access to linked sellers. Seller-facing colors and display name are configured under <strong className="text-gray-300">Seller branding</strong> in the sidebar.
                                    </p>
                                    {loadingAgencyDetail ? (
                                        <Loader2 className="w-5 h-5 animate-spin text-gray-500 mt-3" />
                                    ) : (
                                        <div className="mt-4 flex flex-wrap items-center gap-3">
                                            <span className="text-white font-semibold text-lg">{agencyDetail?.name ?? selected.tenants?.name}</span>
                                            <span
                                                className={`text-[10px] font-bold px-2 py-1 rounded-lg border uppercase ${agencyDetail?.status === 'active'
                                                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
                                                        : agencyDetail?.status === 'suspended'
                                                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/25'
                                                            : 'bg-gray-500/15 text-gray-400 border-gray-500/25'
                                                    }`}
                                            >
                                                {agencyDetail?.status ?? '—'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2 lg:justify-end">
                                <button
                                    type="button"
                                    onClick={() => copyId(selectedAgencyId)}
                                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10 transition-colors"
                                >
                                    {copied === selectedAgencyId ? (
                                        <Check className="w-4 h-4 text-emerald-400" />
                                    ) : (
                                        <Copy className="w-4 h-4" />
                                    )}
                                    Copy org ID
                                </button>
                                {canAdmin && (
                                    <>
                                        <button
                                            type="button"
                                            disabled={busy === 'agency-settings'}
                                            onClick={() => {
                                                setAgencySettingsName(agencyDetail?.name ?? selected.tenants?.name ?? '');
                                                setAgencySettingsOpen(true);
                                            }}
                                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 transition-colors"
                                        >
                                            <Pencil className="w-4 h-4" />
                                            Edit name
                                        </button>
                                        <div className="flex flex-wrap gap-2">
                                            {(['active', 'inactive', 'suspended'] as const).map((st) => (
                                                <button
                                                    key={st}
                                                    type="button"
                                                    disabled={busy === 'agency-settings' || agencyDetail?.status === st}
                                                    onClick={() => handlePatchAgency({ status: st })}
                                                    className="px-3 py-2 rounded-xl text-xs font-bold border border-white/10 bg-gray-900/80 text-gray-300 hover:bg-white/10 disabled:opacity-40 capitalize"
                                                >
                                                    {st}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </section>

                    {agencySettingsOpen && canAdmin && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                            <div className="bg-gray-950 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
                                <div className="px-6 py-5 border-b border-white/10">
                                    <h3 className="text-lg font-bold text-white">Rename agency</h3>
                                </div>
                                <div className="px-6 py-4">
                                    <input
                                        value={agencySettingsName}
                                        onChange={(e) => setAgencySettingsName(e.target.value)}
                                        className="w-full px-4 py-3 bg-gray-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                                        placeholder="Agency name"
                                    />
                                </div>
                                <div className="px-6 py-4 flex justify-end gap-3 border-t border-white/10">
                                    <button
                                        type="button"
                                        onClick={() => setAgencySettingsOpen(false)}
                                        className="px-4 py-2 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 text-sm font-semibold"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy === 'agency-settings' || !agencySettingsName.trim()}
                                        onClick={() => handlePatchAgency({ name: agencySettingsName.trim() })}
                                        className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50"
                                    >
                                        Save
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <section className="grid lg:grid-cols-2 gap-6">
                        {/* Linked Sellers Section */}
                        <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 backdrop-blur-sm flex flex-col relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-mamba-green/5 to-transparent pointer-events-none" />
                            <div className="relative flex flex-col h-full">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3 text-white font-bold text-lg">
                                        <div className="p-2 bg-mamba-green/20 rounded-xl">
                                            <Link2 className="w-5 h-5 text-mamba-neon" />
                                        </div>
                                        Linked Sellers
                                    </div>
                                    <div className="relative w-48 shrink-0">
                                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            value={sellerSearchQuery}
                                            onChange={(e) => setSellerSearchQuery(e.target.value)}
                                            placeholder="Filter sellers..."
                                            className="w-full pl-9 pr-4 py-2 bg-gray-950/50 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:border-mamba-green/50 focus:outline-none"
                                        />
                                    </div>
                                </div>
                                <p className="text-[12px] text-gray-400 leading-relaxed mb-4">
                                    Agency Admin sees all linked sellers. Account Managers and Coordinators only see sellers assigned to them.
                                </p>
                                {(canAdmin || canLinkSellers || canManageStaff || hasCoordinatorRoleOnSelectedAgency) && (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                                        <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2">
                                            <p className="text-[10px] uppercase tracking-wider text-violet-300 font-bold">AM Assigned</p>
                                            <p className="text-xl font-extrabold text-white">{sellerAssignmentCoverage.amAssigned.length}</p>
                                        </div>
                                        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2">
                                            <p className="text-[10px] uppercase tracking-wider text-cyan-300 font-bold">AC Assigned</p>
                                            <p className="text-xl font-extrabold text-white">{sellerAssignmentCoverage.acAssigned.length}</p>
                                        </div>
                                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                                            <p className="text-[10px] uppercase tracking-wider text-amber-300 font-bold">Unassigned</p>
                                            <p className="text-xl font-extrabold text-white">{sellerAssignmentCoverage.unassigned.length}</p>
                                        </div>
                                    </div>
                                )}
                                
                                {canLinkSellers ? (
                                    <div className="mb-4 shrink-0 space-y-2">
                                        <div className="relative">
                                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                            <input
                                                value={sellerLookupQuery}
                                                onChange={(e) => {
                                                    const next = e.target.value;
                                                    setSellerLookupQuery(next);
                                                    setSellerLookupSelection(null);
                                                    setSellerTenantToLink(next);
                                                }}
                                                placeholder="Search seller name or seller tenant UUID..."
                                                className="w-full pl-9 pr-4 py-2.5 bg-gray-950/50 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:border-mamba-green/50 focus:outline-none"
                                            />
                                        </div>
                                        {sellerLookupLoading && (
                                            <div className="text-xs text-gray-500 flex items-center gap-2">
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                Searching sellers...
                                            </div>
                                        )}
                                        {sellerLookupResults.length > 0 && (
                                            <div className="max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-gray-950/95">
                                                {sellerLookupGrouped.linkable.length > 0 && (
                                                    <>
                                                        <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-emerald-300 bg-emerald-500/10 border-b border-emerald-500/20 font-bold">
                                                            Linkable Sellers
                                                        </div>
                                                        <ul className="divide-y divide-white/5">
                                                            {sellerLookupGrouped.linkable.map((seller) => (
                                                                <li key={seller.id}>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setSellerLookupSelection(seller);
                                                                            setSellerLookupQuery(seller.name);
                                                                            setSellerTenantToLink(seller.id);
                                                                            setSellerLookupResults([]);
                                                                        }}
                                                                        className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors"
                                                                    >
                                                                        <div className="text-sm font-semibold text-gray-100 flex items-center gap-2">
                                                                            {seller.name}
                                                                            {seller.already_linked && (
                                                                                <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-cyan-500/40 text-cyan-300 bg-cyan-500/10 uppercase tracking-wide">
                                                                                    Already linked here
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="text-[11px] text-gray-500 font-mono mt-0.5">{seller.id}</div>
                                                                    </button>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </>
                                                )}
                                                {sellerLookupGrouped.notLinkable.length > 0 && (
                                                    <>
                                                        <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-amber-300 bg-amber-500/10 border-y border-amber-500/20 font-bold">
                                                            Not linkable (already linked to another agency)
                                                        </div>
                                                        <ul className="divide-y divide-white/5">
                                                            {sellerLookupGrouped.notLinkable.map((seller) => (
                                                                <li key={seller.id} className="px-3 py-2.5 opacity-80">
                                                                    <div className="text-sm font-semibold text-gray-200">{seller.name}</div>
                                                                    <div className="text-[11px] text-gray-500 font-mono mt-0.5">{seller.id}</div>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                        <div className="flex gap-2">
                                            <input
                                                value={sellerTenantToLink}
                                                onChange={(e) => setSellerTenantToLink(e.target.value)}
                                                placeholder="Selected seller UUID"
                                                className="flex-1 px-3 py-2 bg-gray-950/50 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:border-mamba-green/50 focus:outline-none"
                                            />
                                            <button
                                                type="button"
                                                disabled={busy === 'link' || !sellerTenantToLink.trim()}
                                                onClick={handleLinkSeller}
                                                className="px-4 py-2 rounded-lg font-bold bg-mamba-deep hover:bg-mamba-green text-mamba-dark text-sm disabled:opacity-50 transition-colors"
                                            >
                                                Link
                                            </button>
                                        </div>
                                        <p className="text-[11px] text-gray-500">
                                            Search by seller name, then link. UUID paste still works as fallback.
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-amber-400/90 text-sm mb-4 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20 shrink-0">
                                        Linking requires Agency Admin or the “Link or unlink seller tenants” permission on
                                        your role.
                                    </p>
                                )}

                                <div className="h-[600px] overflow-y-auto border border-white/5 rounded-xl bg-gray-950/30 scrollbar-thin scrollbar-thumb-gray-700">
                                    {loadingSellers || loadingAssignments ? (
                                        <div className="flex justify-center p-8">
                                            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
                                        </div>
                                    ) : filteredSellers.length === 0 ? (
                                        <div className="text-center p-8">
                                            <Store className="w-8 h-8 text-gray-600 mx-auto mb-3" />
                                            <p className="text-gray-400 text-sm">No linked seller tenants found.</p>
                                        </div>
                                    ) : (
                                        <table className="w-full text-left text-sm text-gray-300">
                                            <thead className="text-xs text-gray-500 uppercase bg-gray-900/50 sticky top-0 z-10 backdrop-blur-md border-b border-white/5">
                                                <tr>
                                                    <th className="px-4 py-3 font-semibold">Seller Name</th>
                                                    <th className="px-4 py-3 font-semibold">Assignment</th>
                                                    <th className="px-4 py-3 font-semibold w-40 text-right">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {filteredSellers.map((s: any) => (
                                                    <tr key={s.id} className={`hover:bg-white/[0.02] transition-colors group ${s.link_status === 'pending' ? 'opacity-75' : ''}`}>
                                                        <td className="px-4 py-3">
                                                            <div className="font-semibold text-gray-100 flex items-center gap-2">
                                                                {s.name}
                                                                {s.link_status === 'pending' && (
                                                                    <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wide">
                                                                        Pending
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-[10px] text-gray-500 font-mono mt-0.5" title={s.id}>
                                                                {s.id.substring(0, 12)}...
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {(() => {
                                                                const assignees = sellerAssignmentsBySeller.get(s.id) || [];
                                                                if (assignees.length === 0) {
                                                                    return (
                                                                        <span className="inline-flex items-center text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-1 rounded-md font-bold uppercase tracking-wide">
                                                                            Unassigned
                                                                        </span>
                                                                    );
                                                                }
                                                                return (
                                                                    <div className="flex flex-wrap gap-1.5">
                                                                        {assignees.slice(0, 3).map((a: any) => (
                                                                            <span
                                                                                key={`${s.id}:${a.user_id}`}
                                                                                className={`inline-flex items-center text-[10px] px-2 py-1 rounded-md font-bold border ${
                                                                                    roleLabelLooksLikeAccountManager(a.role_name)
                                                                                        ? 'bg-violet-500/20 text-violet-200 border-violet-500/30'
                                                                                        : roleLabelLooksLikeAccountCoordinator(a.role_name)
                                                                                            ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/30'
                                                                                            : 'bg-gray-500/20 text-gray-200 border-gray-500/30'
                                                                                }`}
                                                                                title={a.email || a.user_id}
                                                                            >
                                                                                {roleLabelLooksLikeAccountManager(a.role_name)
                                                                                    ? 'AM'
                                                                                    : roleLabelLooksLikeAccountCoordinator(a.role_name)
                                                                                      ? 'AC'
                                                                                      : 'Staff'}
                                                                                :
                                                                                {' '}
                                                                                {(a.full_name || a.email || a.user_id).toString().slice(0, 18)}
                                                                                {canManageStaff && (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => handleUnassignSellerAccess(s.id, a.user_id)}
                                                                                        disabled={busy === `unassign-${s.id}-${a.user_id}`}
                                                                                        className="ml-1 inline-flex items-center text-[10px] font-black opacity-70 hover:opacity-100 disabled:opacity-40"
                                                                                        title="Unassign this seller from this staff user"
                                                                                    >
                                                                                        {busy === `unassign-${s.id}-${a.user_id}` ? '…' : 'x'}
                                                                                    </button>
                                                                                )}
                                                                            </span>
                                                                        ))}
                                                                        {assignees.length > 3 && (
                                                                            <span className="inline-flex items-center text-[10px] px-2 py-1 rounded-md font-bold border bg-white/10 text-gray-200 border-white/20">
                                                                                +{assignees.length - 3} more
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <div className="flex items-center justify-end gap-3">
                                                                {canLinkSellers && (
                                                                    <button
                                                                        type="button"
                                                                        disabled={busy === `unlink-${s.id}`}
                                                                        onClick={() => handleUnlinkSeller(s.id)}
                                                                        className="text-xs font-bold text-amber-300 hover:text-amber-200 disabled:opacity-50"
                                                                        title="Unlink seller"
                                                                    >
                                                                        Unlink
                                                                    </button>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => copyId(s.id)}
                                                                    className="text-gray-500 hover:text-white p-1.5 rounded-md hover:bg-white/10 transition-colors inline-block"
                                                                    title="Copy full UUID"
                                                                >
                                                                    {copied === s.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 backdrop-blur-sm relative overflow-hidden flex flex-col">
                            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent pointer-events-none" />
                            <div className="relative flex flex-col h-full">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3 text-white font-bold text-lg">
                                        <div className="p-2 bg-cyan-500/20 rounded-xl">
                                            <Users className="w-5 h-5 text-cyan-400" />
                                        </div>
                                        Agency Team
                                    </div>
                                    <div className="relative w-48 shrink-0">
                                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            value={staffFilterQuery}
                                            onChange={(e) => setStaffFilterQuery(e.target.value)}
                                            placeholder="Filter members..."
                                            className="w-full pl-9 pr-4 py-2 bg-gray-950/50 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:border-cyan-500/50 focus:outline-none"
                                        />
                                    </div>
                                </div>

                                <div className="h-[600px] overflow-y-auto mb-6 pr-2 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent border border-white/5 rounded-xl bg-gray-950/30">
                                    {loadingTeam ? (
                                        <div className="flex justify-center p-8">
                                            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
                                        </div>
                                    ) : filteredTeam.length === 0 ? (
                                        <div className="text-center p-8">
                                            <Users className="w-8 h-8 text-gray-600 mx-auto mb-3" />
                                            <p className="text-gray-400 text-sm">No team members found.</p>
                                        </div>
                                    ) : (
                                        <table className="w-full text-left text-sm text-gray-300">
                                            <thead className="text-xs text-gray-500 uppercase bg-gray-900/50 sticky top-0 z-10 backdrop-blur-md border-b border-white/5">
                                                <tr>
                                                    <th className="px-4 py-3 font-semibold">User</th>
                                                    <th className="px-4 py-3 font-semibold">Role</th>
                                                    <th className="px-4 py-3 font-semibold w-24 text-right">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {filteredTeam.map((row: any) => (
                                                    <tr key={row.id} className="hover:bg-white/[0.02] transition-colors group">
                                                        <td className="px-4 py-3">
                                                            <div className="font-semibold text-gray-100 flex items-center gap-2">
                                                                {row.full_name || row.email || "Unknown User"}
                                                                {row.user_id === user?.id && <span className="bg-cyan-500/20 text-cyan-300 text-[10px] px-2 py-0.5 rounded-md uppercase tracking-wide">You</span>}
                                                                {row.status === 'invited' && (
                                                                    <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wide">
                                                                        Pending Invite
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {row.email && <div className="text-xs text-gray-500 mt-0.5">{row.email}</div>}
                                                            <div className="text-[10px] text-gray-600 font-mono mt-0.5" title={row.user_id}>
                                                                ID: {row.user_id.substring(0, 8)}...
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {canAdmin && row.role_id ? (
                                                                row.user_id === user?.id ? (
                                                                    <span className="text-cyan-300 text-xs font-bold bg-cyan-500/10 px-2 py-1 rounded border border-cyan-500/20">
                                                                        {row.role_name}
                                                                    </span>
                                                                ) : (
                                                                    <select
                                                                        value={row.role_id}
                                                                        disabled={busy === `role-${row.user_id}`}
                                                                        onChange={(e) =>
                                                                            handleAgencyMemberRoleChange(row.user_id, e.target.value)
                                                                        }
                                                                        className="w-full max-w-[150px] px-2 py-1.5 bg-gray-950 border border-white/10 rounded-md text-xs text-white shrink-0 font-medium focus:border-cyan-500/50 focus:outline-none"
                                                                    >
                                                                        {agencyAssignableRoles.map((r: any) => (
                                                                            <option key={r.id} value={r.id}>
                                                                                {r.name}
                                                                                {r.type === 'custom' ? ' (custom)' : ''}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                )
                                                            ) : (
                                                                <span className="text-cyan-300 text-xs font-bold bg-cyan-500/10 px-2 py-1 rounded border border-cyan-500/20">{row.role_name}</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <button
                                                                type="button"
                                                                onClick={() => copyId(row.user_id)}
                                                                className="text-gray-500 hover:text-white p-1.5 rounded-md hover:bg-white/10 transition-colors inline-block"
                                                                title="Copy user ID"
                                                            >
                                                                {copied === row.user_id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>

                                {canManageStaff ? (
                                    <div className="bg-gray-900/40 rounded-2xl p-4 border border-white/5 mt-auto">
                                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1 flex items-center gap-2">
                                            <UserPlus className="w-4 h-4 text-gray-500" /> Add New Staff
                                        </p>
                                        {!canAdmin && (
                                            <p className="text-[11px] text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-4">
                                                As Account Manager, you can only invite <strong>Account Coordinators</strong>.
                                            </p>
                                        )}
                                        <div className="space-y-4">
                                            {canAdmin && (
                                            <div>
                                                <label className="text-[11px] text-gray-500 uppercase tracking-widest font-bold block mb-1.5">Assign Role</label>
                                                <select
                                                    value={staffRoleId}
                                                    onChange={(e) => setStaffRoleId(e.target.value)}
                                                    className="w-full px-4 py-2.5 bg-gray-950/80 border border-white/10 rounded-xl text-sm text-white font-medium focus:border-cyan-500/50 focus:outline-none"
                                                >
                                                    {agencyAssignableRoles.map((r: any) => (
                                                        <option key={r.id} value={r.id}>
                                                            {r.name}
                                                            {r.type === 'custom' ? ' (custom)' : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            )}

                                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 relative">
                                                {/* Left side: Search */}
                                                <div>
                                                    <label className="text-[11px] text-gray-500 uppercase tracking-widest font-bold block mb-1.5">Search Existing Users</label>
                                                    <input
                                                        value={staffSearchQuery}
                                                        onChange={(e) => {
                                                            setStaffSearchQuery(e.target.value);
                                                            setStaffPickedUser(null);
                                                        }}
                                                        placeholder="Name or email..."
                                                        className="w-full px-4 py-2.5 bg-gray-950/80 border border-white/10 rounded-xl text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none"
                                                    />
                                                    {staffSearchLoading && (
                                                        <div className="text-xs text-gray-500 mt-2 flex items-center gap-2 justify-center">
                                                            <Loader2 className="w-3 h-3 animate-spin" /> Searching…
                                                        </div>
                                                    )}
                                                    {staffSearchResults.length > 0 && (
                                                        <ul className="mt-2 max-h-32 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5 bg-gray-950 font-medium">
                                                            {staffSearchResults.map((u) => (
                                                                <li key={u.id}>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setStaffPickedUser(u)}
                                                                        className={`w-full text-left px-3 py-2.5 text-xs hover:bg-gray-900 transition-colors ${staffPickedUser?.id === u.id
                                                                                ? 'bg-cyan-500/10 text-cyan-200 border-l-2 border-cyan-500'
                                                                                : 'text-gray-300'
                                                                            }`}
                                                                    >
                                                                        <div className="font-bold">{u.full_name || u.email}</div>
                                                                        <div className="text-gray-500 mt-0.5 max-w-[full] truncate">{u.email}</div>
                                                                    </button>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                    <button
                                                        type="button"
                                                        disabled={busy === 'staff' || !staffPickedUser}
                                                        onClick={handleAddStaffMember}
                                                        className="w-full mt-3 py-2.5 rounded-xl font-bold bg-cyan-600 hover:bg-cyan-500 text-white text-sm disabled:opacity-50 hover:shadow-lg hover:shadow-cyan-500/20 transition-all hover:-translate-y-0.5 block"
                                                    >
                                                        {busy === 'staff' ? (
                                                            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                                                        ) : null}
                                                        Assign Selected
                                                    </button>
                                                </div>

                                                {/* OR divider for desktop */}
                                                <div className="hidden md:flex absolute inset-y-0 left-1/2 -translate-x-1/2 items-center justify-center pointer-events-none">
                                                    <div className="h-full w-px bg-white/5 block"></div>
                                                    <div className="bg-gray-900 text-gray-500 text-[10px] font-bold px-2 py-1 absolute uppercase tracking-widest rounded-md border border-white/5">OR</div>
                                                </div>

                                                {/* Right side: Invite */}
                                                <div>
                                                    <label className="text-[11px] text-gray-500 uppercase tracking-widest font-bold block mb-1.5 pl-0 md:pl-2">Invite New User</label>
                                                    <div className="pl-0 md:pl-2">
                                                        <input
                                                            type="email"
                                                            value={staffInviteEmail}
                                                            onChange={(e) => setStaffInviteEmail(e.target.value)}
                                                            placeholder="new.user@agency.com"
                                                            className="w-full px-4 py-2.5 bg-gray-950/80 border border-white/10 rounded-xl text-sm text-white placeholder-gray-600 focus:border-violet-500/50 focus:outline-none mb-3"
                                                        />
                                                        <button
                                                            type="button"
                                                            disabled={busy === 'invite-staff' || !staffInviteEmail.trim()}
                                                            onClick={handleInviteStaff}
                                                            className="w-full py-2.5 rounded-xl font-bold bg-white/5 border border-white/10 text-white hover:bg-white/10 text-sm disabled:opacity-50 transition-all block text-center"
                                                        >
                                                            {busy === 'invite-staff' ? (
                                                                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                                                            ) : null}
                                                            Send Invite
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </section>

                    {canManageStaff && (
                        <section className="bg-white/[0.02] border border-white/10 rounded-3xl p-8 backdrop-blur-sm relative overflow-hidden mt-6">
                            <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 to-orange-500/5 pointer-events-none" />
                            <div className="relative">
                                <div className="text-white font-bold text-xl mb-2 flex items-center gap-3">
                                    <div className="p-2 bg-amber-500/20 rounded-xl">
                                        <Shield className="w-5 h-5 text-amber-400" />
                                    </div>
                                    Assign Seller to Staff
                                </div>
                                {!canAdmin && (
                                    <p className="text-[11px] text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-4">
                                        As Account Manager, you can only assign sellers from <strong>your own scope</strong> to <strong>Account Coordinators</strong>.
                                    </p>
                                )}
                                <p className="text-sm text-gray-400/90 mb-6 bg-gray-900/40 p-4 rounded-xl border border-white/5 leading-relaxed">
                                    {canAdmin
                                        ? 'Staff user must already have AM or AC role on this agency. Seller must already be linked. Provides scoped access for client assignment.'
                                        : 'Enter the Account Coordinator\'s user ID and a Seller ID from your assigned scope.'}
                                </p>
                                <div className="grid md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[11px] text-gray-500 uppercase tracking-widest font-bold block mb-1.5">Staff Member (AM / AC)</label>
                                        <select
                                            value={assignStaffUserId}
                                            onChange={(e) => setAssignStaffUserId(e.target.value)}
                                            className="w-full px-4 py-3 bg-gray-950/50 border border-white/10 rounded-xl text-sm text-white focus:border-amber-500/50 focus:outline-none transition-all appearance-none"
                                        >
                                            <option value="" disabled>Select a staff member...</option>
                                            {assignableStaff.map((u: any) => (
                                                <option key={u.user_id} value={u.user_id}>
                                                    {u.full_name || u.email || u.user_id} ({u.role_name})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[11px] text-gray-500 uppercase tracking-widest font-bold block mb-1.5">Linked Seller</label>
                                        <select
                                            value={assignSellerTenantId}
                                            onChange={(e) => setAssignSellerTenantId(e.target.value)}
                                            className="w-full px-4 py-3 bg-gray-950/50 border border-white/10 rounded-xl text-sm text-white focus:border-amber-500/50 focus:outline-none transition-all appearance-none"
                                        >
                                            <option value="" disabled>Select a seller tenant...</option>
                                            {linkedSellers.map((s) => (
                                                <option key={s.id} value={s.id}>
                                                    {s.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    disabled={busy === 'assign'}
                                    onClick={handleAssignSeller}
                                    className="mt-6 px-8 py-3 rounded-xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-sm disabled:opacity-50 hover:shadow-lg hover:shadow-amber-500/20 transition-all hover:-translate-y-0.5"
                                >
                                    Grant Scoped Access
                                </button>
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}
