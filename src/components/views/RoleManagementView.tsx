import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import {
    Loader2,
    Plus,
    Shield,
    Search,
    Key,
    UserPlus,
    Trash2,
    X,
    Check,
    ChevronRight,
    AlertCircle,
    Users,
    Lock,
    MoreVertical,
    UserX,
    UserCheck,
    LogOut,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTenantContext, type ManageableTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import {
    createCustomRole,
    deleteCustomRole,
    formatTeamRpcFailure,
    getMyCustomRolePermissionCeiling,
    grantUserAccessToSellerAccount,
    isTeamRpcMissingFromDb,
    manageTenantMember,
    tenantDirectoryForAdmin,
    tenantSetMemberRole,
    updateCustomRole,
} from '../../lib/tenantRolesRpc';
import { inviteTeamMember, searchTeamProfiles, type TeamProfileRow } from '../../lib/teamApi';

type RoleRow = {
    id: string;
    name: string;
    description: string | null;
    type: string;
    scope: string;
    tenant_id: string | null;
};

type PermissionRow = { id: string; action: string; description: string | null };

type DirectoryRow = {
    membership_id: string;
    user_id: string;
    email: string | null;
    full_name: string | null;
    role_id: string;
    role_name: string;
    role_type: string;
    status: string;
};

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

export function RoleManagementView() {
    const { manageableAdminTenants, isPlatformSuperAdmin, loading: ctxLoading, memberships } = useTenantContext();
    const { user, profile } = useAuth();
    const isUnrestrictedAdmin = isPlatformSuperAdmin;
    const canFullyManageTeamMembers = isUnrestrictedAdmin || profile?.role === 'admin';
    const skipPermissionCeiling = isPlatformSuperAdmin || profile?.role === 'admin';
    const queryClient = useQueryClient();
    const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

    // Super Admins can manage ALL agency & seller tenants
    const { data: allPlatformTenants = [], isLoading: loadingAllTenants } = useQuery({
        queryKey: ['all-platform-tenants'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('tenants')
                .select('id, name, type')
                .in('type', ['agency', 'seller'])
                .eq('status', 'active')
                .order('type')
                .order('name');
            if (error) throw error;
            return (data || []).map((t: any) => ({ id: t.id, name: t.name, type: t.type })) as ManageableTenant[];
        },
        enabled: isUnrestrictedAdmin,
    });

    const effectiveTenants = isUnrestrictedAdmin ? allPlatformTenants : manageableAdminTenants;
    const [activeTab, setActiveTab] = useState<'members' | 'roles'>('members');
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
    const [memberSearch, setMemberSearch] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
    const [inviteToast, setInviteToast] = useState<{ displayName: string } | null>(null);
    const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null); // membership_id
    const [confirmAction, setConfirmAction] = useState<{ userId: string; memberName: string; action: 'suspend' | 'reactivate' | 'remove' } | null>(null);

    const [createOpen, setCreateOpen] = useState(false);
    const [newRoleName, setNewRoleName] = useState('');
    const [newRoleDesc, setNewRoleDesc] = useState('');
    const [newRolePerms, setNewRolePerms] = useState<Set<string>>(new Set());

    const [assignOpen, setAssignOpen] = useState(false);
    const [assignUserId, setAssignUserId] = useState('');
    const [assignRoleId, setAssignRoleId] = useState('');
    const [assignSearchQuery, setAssignSearchQuery] = useState('');
    const [assignSearchResults, setAssignSearchResults] = useState<TeamProfileRow[]>([]);
    const [assignSearchLoading, setAssignSearchLoading] = useState(false);
    const [assignSelectedUser, setAssignSelectedUser] = useState<TeamProfileRow | null>(null);
    const [assignInviteEmail, setAssignInviteEmail] = useState('');
    const [assignShowAdvancedUuid, setAssignShowAdvancedUuid] = useState(false);
    const [assignLinkShopDashboard, setAssignLinkShopDashboard] = useState(true);
    const [assignAccountId, setAssignAccountId] = useState('');

    const openAssignModal = () => {
        setAssignOpen(true);
        setAssignRoleId('');
        setAssignSearchQuery('');
        setAssignSearchResults([]);
        setAssignSelectedUser(null);
        setAssignUserId('');
        setAssignInviteEmail('');
        setAssignShowAdvancedUuid(false);
        setAssignLinkShopDashboard(true);
        setAssignAccountId('');
    };

    React.useEffect(() => {
        if (!assignOpen || !selectedTenantId) return;
        const q = assignSearchQuery.trim();
        if (q.length < 2) {
            setAssignSearchResults([]);
            return;
        }
        let cancelled = false;
        const t = setTimeout(async () => {
            setAssignSearchLoading(true);
            try {
                const rows = await searchTeamProfiles(selectedTenantId, q);
                if (!cancelled) setAssignSearchResults(rows);
            } catch {
                if (!cancelled) setAssignSearchResults([]);
            } finally {
                if (!cancelled) setAssignSearchLoading(false);
            }
        }, 350);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [assignSearchQuery, assignOpen, selectedTenantId]);

    React.useEffect(() => {
        if (!selectedTenantId && effectiveTenants[0]) {
            setSelectedTenantId(effectiveTenants[0].id);
        }
    }, [effectiveTenants, selectedTenantId]);

    const selectedTenant = useMemo(
        () => effectiveTenants.find((t) => t.id === selectedTenantId) ?? null,
        [effectiveTenants, selectedTenantId]
    );

    const { data: sellerParentAgencyId = null } = useQuery({
        queryKey: ['tenant-parent-for-team-ui', selectedTenantId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('tenants')
                .select('parent_tenant_id')
                .eq('id', selectedTenantId!)
                .single();
            if (error) throw error;
            return (data?.parent_tenant_id as string | null) ?? null;
        },
        enabled: !!selectedTenantId && selectedTenant?.type === 'seller',
    });

    /** Agency whose staff list AM/AC are viewing (agency tab = that tenant; seller tab = parent agency). */
    const relevantAgencyIdForTeamUi = useMemo(() => {
        if (!selectedTenantId) return null;
        if (selectedTenant?.type === 'agency') return selectedTenantId;
        return sellerParentAgencyId;
    }, [selectedTenantId, selectedTenant?.type, sellerParentAgencyId]);

    const isAccountCoordinatorViewer = useMemo(() => {
        if (!relevantAgencyIdForTeamUi || canFullyManageTeamMembers) return false;
        return memberships.some(
            (m) =>
                m.tenant_id === relevantAgencyIdForTeamUi &&
                m.status === 'active' &&
                m.roles?.name === 'Account Coordinator'
        );
    }, [relevantAgencyIdForTeamUi, canFullyManageTeamMembers, memberships]);

    const isAccountManagerViewer = useMemo(() => {
        if (!relevantAgencyIdForTeamUi || canFullyManageTeamMembers || isAccountCoordinatorViewer) return false;
        return memberships.some(
            (m) =>
                m.tenant_id === relevantAgencyIdForTeamUi &&
                m.status === 'active' &&
                m.roles?.name === 'Account Manager'
        );
    }, [relevantAgencyIdForTeamUi, canFullyManageTeamMembers, isAccountCoordinatorViewer, memberships]);

    const canEditMemberRole = (row: DirectoryRow) => {
        if (row.user_id === user?.id) return false;
        if (canFullyManageTeamMembers) return true;
        if (isAccountCoordinatorViewer) return false;
        if (isAccountManagerViewer) return row.role_name === 'Account Coordinator';
        return true;
    };

    const canActOnMemberRow = (row: DirectoryRow) => {
        if (row.user_id === user?.id) return false;
        if (canFullyManageTeamMembers) return true;
        if (isAccountCoordinatorViewer) return false;
        if (isAccountManagerViewer) return row.role_name === 'Account Coordinator';
        return true;
    };

    const scope = selectedTenant?.type === 'agency' ? 'agency' : 'seller';

    const { data: permissionsCatalog = [] } = useQuery({
        queryKey: ['permissions-catalog'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('permissions')
                .select('id, action, description')
                .order('action');
            if (error) throw error;
            return (data || []) as PermissionRow[];
        },
    });

    const {
        data: ceilingActions,
        isLoading: ceilingLoading,
        isError: ceilingError,
        error: ceilingQueryError,
    } = useQuery({
        queryKey: ['custom-role-permission-ceiling', selectedTenantId],
        queryFn: async () => {
            const { data, error } = await getMyCustomRolePermissionCeiling(selectedTenantId!);
            // 'Not allowed' is a valid state (user has no delegatable permissions),
            // not a genuine load failure. Treat it as an empty array so the UI shows
            // the friendly "no permissions available" message instead of a red error.
            if (error) {
                const msg = (error as any)?.message ?? '';
                if (/not allowed/i.test(msg)) return [] as string[];
                throw error;
            }
            return data;
        },
        retry: 0,
        // Fetch whenever a tenant is selected so the list is ready on the Roles tab / create modal
        // (not only when activeTab === 'roles', which left data undefined and showed an empty picker).
        enabled: !!selectedTenantId && !skipPermissionCeiling,
    });

    const catalogForNewRole = useMemo(() => {
        if (skipPermissionCeiling) return permissionsCatalog;
        if (ceilingLoading || ceilingActions === undefined) return [];
        // RPC returns NULL for platform operators (unbounded) — same as full catalog, not "no permissions".
        if (ceilingActions === null) return permissionsCatalog;
        const allowed = new Set(ceilingActions);
        return permissionsCatalog.filter((p) => allowed.has(p.action));
    }, [skipPermissionCeiling, ceilingLoading, ceilingActions, permissionsCatalog]);

    const { data: roleRows = [], isLoading: loadingRoles } = useQuery({
        queryKey: ['tenant-roles-combined', selectedTenantId, scope, selectedTenant?.type],
        queryFn: async () => {
            if (!selectedTenantId) return [];
            // Seller context: team directory may be parent-agency memberships; include agency system roles
            // (e.g. Account Coordinator) as well as seller-scoped roles for assign/create flows.
            const systemScopes =
                selectedTenant?.type === 'seller' ? (['seller', 'agency'] as const) : ([scope] as const);
            const [{ data: system, error: e1 }, { data: custom, error: e2 }] = await Promise.all([
                supabase
                    .from('roles')
                    .select('id,name,description,type,scope,tenant_id')
                    .is('tenant_id', null)
                    .in('scope', [...systemScopes])
                    .order('name'),
                supabase
                    .from('roles')
                    .select('id,name,description,type,scope,tenant_id')
                    .eq('tenant_id', selectedTenantId)
                    .eq('type', 'custom')
                    .order('name'),
            ]);
            if (e1) throw e1;
            if (e2) throw e2;
            const sys = (system || []) as RoleRow[];
            const cust = (custom || []) as RoleRow[];
            const byId = new Map<string, RoleRow>();
            for (const r of sys) {
                if (r.name !== 'Super Admin') byId.set(r.id, r);
            }
            const filtered = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
            return [...filtered, ...cust];
        },
        enabled: !!selectedTenantId,
    });

    React.useEffect(() => {
        if (assignOpen && roleRows.length > 0 && !assignRoleId) {
            setAssignRoleId(roleRows[0].id);
        }
    }, [assignOpen, roleRows, assignRoleId]);

    const { data: sellerShopAccounts = [] } = useQuery({
        queryKey: ['seller-accounts-tenant', selectedTenantId],
        queryFn: async () => {
            if (!selectedTenantId) return [];
            const { data, error } = await supabase
                .from('accounts')
                .select('id, name')
                .eq('tenant_id', selectedTenantId)
                .eq('status', 'active')
                .order('name');
            if (error) throw error;
            return (data || []) as { id: string; name: string }[];
        },
        enabled: !!selectedTenantId && selectedTenant?.type === 'seller',
    });

    React.useEffect(() => {
        if (
            assignOpen &&
            selectedTenant?.type === 'seller' &&
            sellerShopAccounts.length > 0 &&
            !assignAccountId
        ) {
            setAssignAccountId(sellerShopAccounts[0].id);
        }
    }, [assignOpen, selectedTenant?.type, sellerShopAccounts, assignAccountId]);

    const { data: rolePermActions = [] } = useQuery({
        queryKey: ['role-permissions', selectedRoleId],
        queryFn: async () => {
            if (!selectedRoleId) return [];
            const { data, error } = await supabase
                .from('role_permissions')
                .select('permissions(action)')
                .eq('role_id', selectedRoleId);
            if (error) throw error;
            return (data || [])
                .map((r: any) => r.permissions?.action as string)
                .filter(Boolean);
        },
        enabled: !!selectedRoleId,
    });

    const {
        data: directory = [],
        isLoading: loadingDir,
        isError: directoryError,
        error: directoryQueryError,
    } = useQuery({
        queryKey: ['tenant-directory', selectedTenantId],
        queryFn: async () => {
            if (!selectedTenantId) return [];
            const { data, error } = await tenantDirectoryForAdmin(selectedTenantId);
            if (error) throw error;
            return (data || []) as DirectoryRow[];
        },
        retry: 0,
        enabled: !!selectedTenantId && activeTab === 'members',
    });

    const selectedRole = useMemo(
        () => roleRows.find((r) => r.id === selectedRoleId) ?? null,
        [roleRows, selectedRoleId]
    );

    const catalogForEditingCustomRole = useMemo(() => {
        if (skipPermissionCeiling) return permissionsCatalog;
        if (ceilingLoading || ceilingActions === undefined) return [];
        if (ceilingActions === null) return permissionsCatalog;
        const allowed = new Set(ceilingActions);
        return permissionsCatalog.filter(
            (p) => allowed.has(p.action) || rolePermActions.includes(p.action)
        );
    }, [skipPermissionCeiling, ceilingLoading, ceilingActions, permissionsCatalog, rolePermActions]);

    const permGroupsForEditingCustom = useMemo(() => {
        const m = new Map<string, PermissionRow[]>();
        for (const p of catalogForEditingCustomRole) {
            const g = permissionGroupLabel(p.action);
            if (!m.has(g)) m.set(g, []);
            m.get(g)!.push(p);
        }
        return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [catalogForEditingCustomRole]);

    const permGroups = useMemo(() => {
        const m = new Map<string, PermissionRow[]>();
        for (const p of permissionsCatalog) {
            const g = permissionGroupLabel(p.action);
            if (!m.has(g)) m.set(g, []);
            m.get(g)!.push(p);
        }
        return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [permissionsCatalog]);

    const filteredMembers = useMemo(() => {
        const q = memberSearch.trim().toLowerCase();
        if (!q) return directory;
        return directory.filter(
            (d) =>
                (d.email && d.email.toLowerCase().includes(q)) ||
                (d.full_name && d.full_name.toLowerCase().includes(q)) ||
                d.user_id.toLowerCase().includes(q)
        );
    }, [directory, memberSearch]);

    const flash = (type: 'ok' | 'err', text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 5000);
    };

    React.useEffect(() => {
        if (!inviteToast) return;
        const t = window.setTimeout(() => setInviteToast(null), 6500);
        return () => window.clearTimeout(t);
    }, [inviteToast]);

    const invitedPersonLabel = (): string => {
        const email = assignInviteEmail.trim();
        if (email) return email;
        if (assignSelectedUser) {
            const n = assignSelectedUser.full_name?.trim();
            if (n) return n;
            if (assignSelectedUser.email) return assignSelectedUser.email;
        }
        const uid = assignUserId.trim();
        if (uid.length > 12) return `${uid.slice(0, 8)}…`;
        return uid || 'this person';
    };

    const invalidateTenant = () => {
        queryClient.invalidateQueries({ queryKey: ['tenant-roles-combined', selectedTenantId] });
        queryClient.invalidateQueries({ queryKey: ['tenant-directory', selectedTenantId] });
        queryClient.invalidateQueries({ queryKey: ['tenant-memberships'] });
    };

    const handleSaveCustomPermissions = async (actions: string[]) => {
        if (!selectedRoleId || !selectedRole || selectedRole.type !== 'custom') return;
        setBusy('save-perms');
        const { error } = await updateCustomRole(selectedRoleId, null, null, actions);
        setBusy(null);
        if (error) {
            flash('err', error.message);
            return;
        }
        flash('ok', 'Permissions updated');
        queryClient.invalidateQueries({ queryKey: ['role-permissions', selectedRoleId] });
    };

    const handleCreateRole = async () => {
        if (!selectedTenantId || !newRoleName.trim()) return;
        setBusy('create');
        const { error } = await createCustomRole(
            selectedTenantId,
            newRoleName.trim(),
            newRoleDesc.trim() || null,
            Array.from(newRolePerms)
        );
        setBusy(null);
        if (error) {
            flash('err', error.message);
            return;
        }
        flash('ok', 'Custom role created');
        setCreateOpen(false);
        setNewRoleName('');
        setNewRoleDesc('');
        setNewRolePerms(new Set());
        invalidateTenant();
    };

    const handleDeleteRole = async () => {
        if (!selectedRoleId || !selectedRole || selectedRole.type !== 'custom') return;
        if (!confirm(`Delete role "${selectedRole.name}"?`)) return;
        setBusy('delete');
        const { error } = await deleteCustomRole(selectedRoleId);
        setBusy(null);
        if (error) {
            flash('err', error.message);
            return;
        }
        setSelectedRoleId(null);
        flash('ok', 'Role deleted');
        invalidateTenant();
    };

    const maybeGrantShopDashboard = async (targetUserId: string) => {
        if (selectedTenant?.type !== 'seller' || !assignLinkShopDashboard || !assignAccountId) {
            return null;
        }
        const { error } = await grantUserAccessToSellerAccount(targetUserId, assignAccountId);
        return error;
    };

    const handleAssignMember = async () => {
        const uid = assignSelectedUser?.id || assignUserId.trim();
        if (!selectedTenantId || !uid || !assignRoleId) return;
        setBusy('assign');
        try {
            const r = await inviteTeamMember(selectedTenantId, '', assignRoleId, uid);
            const dashErr = await maybeGrantShopDashboard(uid);
            if (r.invited) {
                setInviteToast({ displayName: invitedPersonLabel() });
            }
            if (dashErr) {
                flash('err', `Role assigned, but shop dashboard link failed: ${dashErr.message}`);
            } else if (!r.invited) {
                flash('ok', 'Existing member role updated successfully.');
            }
            setAssignOpen(false);
            setAssignUserId('');
            setAssignSelectedUser(null);
            invalidateTenant();
        } catch (e: any) {
            flash('err', e.message || 'Assign failed');
        } finally {
            setBusy(null);
        }
    };

    const handleInviteAssign = async () => {
        if (!selectedTenantId || !assignInviteEmail.trim() || !assignRoleId) return;
        setBusy('invite');
        try {
            const r = await inviteTeamMember(selectedTenantId, assignInviteEmail.trim(), assignRoleId);
            const dashErr = await maybeGrantShopDashboard(r.userId);
            if (r.invited) {
                setInviteToast({ displayName: invitedPersonLabel() });
            }
            if (dashErr) {
                flash('err', `Role assigned, but shop dashboard link failed: ${dashErr.message}`);
            } else if (!r.invited) {
                flash('ok', 'Existing user found — role updated successfully.');
            }
            setAssignOpen(false);
            setAssignInviteEmail('');
            invalidateTenant();
        } catch (e: any) {
            flash('err', e.message || 'Invite failed');
        } finally {
            setBusy(null);
        }
    };

    const handleMemberRoleChange = async (userId: string, roleId: string) => {
        if (!selectedTenantId) return;
        setBusy(`m-${userId}`);
        const { error } = await tenantSetMemberRole(selectedTenantId, userId, roleId);
        setBusy(null);
        if (error) {
            flash('err', error.message);
            return;
        }
        flash('ok', 'Role updated');
        invalidateTenant();
    };

    const handleMemberAction = async (action: 'suspend' | 'reactivate' | 'remove') => {
        if (!confirmAction || !selectedTenantId) return;
        setBusy(`action-${confirmAction.userId}`);
        setConfirmAction(null);
        const { error } = await manageTenantMember(selectedTenantId, confirmAction.userId, action);
        setBusy(null);
        if (error) {
            flash('err', error.message);
            return;
        }
        const labels = { suspend: 'suspended', reactivate: 'reactivated', remove: 'removed' };
        flash('ok', `Member ${labels[action]} successfully.`);
        invalidateTenant();
    };

    const toggleNewPerm = (action: string) => {
        setNewRolePerms((prev) => {
            const n = new Set(prev);
            if (n.has(action)) n.delete(action);
            else n.add(action);
            return n;
        });
    };

    if (ctxLoading || (isUnrestrictedAdmin && loadingAllTenants)) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-400">
                <Loader2 className="w-8 h-8 animate-spin" />
            </div>
        );
    }

    if (effectiveTenants.length === 0) {
        return (
            <div className="w-full max-w-none mt-16 text-center text-gray-400 space-y-3 px-4">
                <Shield className="w-12 h-12 mx-auto text-gray-600" />
                <h2 className="text-xl font-semibold text-white">No tenant admin access</h2>
                <p className="text-sm">
                    You need <span className="text-pink-300">Agency Admin</span> on an agency or{' '}
                    <span className="text-pink-300">Seller Admin</span> on a seller tenant to manage team roles.
                </p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col text-white animate-in fade-in duration-500 relative">
            <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-fuchsia-500/10 via-pink-500/5 to-transparent -z-10 rounded-full blur-[100px] opacity-50 pointer-events-none" />

            <div className="flex-shrink-0 p-8 pb-0 relative z-10">
                <div className="flex flex-wrap items-center justify-between gap-6 mb-8">
                    <div>
                        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-pink-100 to-white flex items-center gap-4">
                            <div className="p-2.5 bg-pink-500/10 rounded-2xl border border-pink-500/20 backdrop-blur-xl">
                                <Users className="w-8 h-8 text-pink-400 drop-shadow-lg" />
                            </div>
                            Team & roles
                        </h1>
                        <p className="text-gray-400/90 mt-4 text-base max-w-2xl leading-relaxed">
                            Assign roles to existing users (by user id), create custom roles from the permission catalog,
                            and review members for this tenant.
                        </p>
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-xs text-gray-500 font-bold uppercase tracking-wider">Tenant Context</label>
                        <select
                            value={selectedTenantId ?? ''}
                            onChange={(e) => {
                                setSelectedTenantId(e.target.value);
                                setSelectedRoleId(null);
                            }}
                            className="bg-white/[0.02] backdrop-blur-sm border border-white/10 rounded-2xl px-5 py-3 text-sm text-white min-w-[240px] focus:outline-none focus:border-pink-500/50 transition-all font-medium appearance-none shadow-xl cursor-pointer hover:bg-white/[0.04]"
                            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                        >
                            {effectiveTenants.map((t) => (
                                <option key={t.id} value={t.id} className="bg-gray-900">
                                    {t.type === 'agency' ? '🏢 ' : '🛍️ '}
                                    {t.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {msg && (
                    <div
                        className={`mb-4 text-sm px-4 py-2 rounded-xl border ${msg.type === 'ok'
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                : 'bg-red-500/10 border-red-500/30 text-red-300'
                            }`}
                    >
                        {msg.text}
                    </div>
                )}

                <div className="flex space-x-2 border-b border-white/10 pb-4 relative z-10 w-full">
                    <button
                        type="button"
                        onClick={() => setActiveTab('members')}
                        className={`px-5 py-2.5 rounded-2xl font-bold text-sm transition-all duration-300 ${activeTab === 'members'
                                ? 'bg-pink-600/90 text-white shadow-xl shadow-pink-900/40 border border-pink-500/50 -translate-y-0.5'
                                : 'bg-white/[0.02] text-gray-400 border border-white/10 hover:text-white hover:border-white/20 hover:bg-white/5'
                            }`}
                    >
                        <div className="flex items-center gap-2.5">
                            <Users size={16} />
                            Team members
                        </div>
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('roles')}
                        className={`px-5 py-2.5 rounded-2xl font-bold text-sm transition-all duration-300 ${activeTab === 'roles'
                                ? 'bg-pink-600/90 text-white shadow-xl shadow-pink-900/40 border border-pink-500/50 -translate-y-0.5'
                                : 'bg-white/[0.02] text-gray-400 border border-white/10 hover:text-white hover:border-white/20 hover:bg-white/5'
                            }`}
                    >
                        <div className="flex items-center gap-2.5">
                            <Shield size={16} />
                            Roles & permissions
                        </div>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-8 relative">
                {activeTab === 'members' && (
                    <div className="space-y-6 flex flex-col min-h-[500px] h-full">
                        <div className="flex flex-wrap items-center justify-between gap-4 bg-white/[0.02] border border-white/10 p-4 rounded-3xl backdrop-blur-sm shrink-0">
                            <div className="relative w-full md:max-w-md min-w-0 flex-1">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                                <input
                                    type="text"
                                    value={memberSearch}
                                    onChange={(e) => setMemberSearch(e.target.value)}
                                    placeholder="Search by email, name, or user id…"
                                    className="w-full bg-gray-950/80 border border-white/10 rounded-2xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:border-pink-500/50 text-white placeholder-gray-600 transition-all font-medium shadow-inner"
                                />
                            </div>
                            {!isAccountCoordinatorViewer && (
                                <button
                                    type="button"
                                    onClick={openAssignModal}
                                    className="flex items-center justify-center gap-2 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white px-6 py-3 rounded-2xl font-bold text-sm transition-all hover:shadow-lg hover:shadow-pink-500/20 hover:-translate-y-0.5 w-full md:w-auto"
                                >
                                    <UserPlus size={18} />
                                    Assign role to user
                                </button>
                            )}
                        </div>
                        {(isAccountCoordinatorViewer || isAccountManagerViewer) && (
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-gray-300">
                                {isAccountCoordinatorViewer ? (
                                    <p>
                                        <span className="font-bold text-cyan-200">View only.</span> Account Coordinators can
                                        see the agency team but cannot change roles, assign members, or use member actions.
                                    </p>
                                ) : (
                                    <p>
                                        <span className="font-bold text-violet-200">Limited management.</span> As an Account
                                        Manager you can change roles and use actions only for{' '}
                                        <span className="text-white font-semibold">Account Coordinators</span>. Everyone
                                        else is shown read-only.
                                    </p>
                                )}
                            </div>
                        )}

                        {loadingDir ? (
                            <div className="flex items-center justify-center py-20">
                                <Loader2 className="w-10 h-10 animate-spin text-pink-500" />
                            </div>
                        ) : directoryError ? (
                            <div className="flex gap-4 p-6 rounded-3xl border border-red-500/25 bg-red-500/10 text-red-100">
                                <AlertCircle className="w-6 h-6 shrink-0 mt-0.5 text-red-400" />
                                <div className="space-y-2 min-w-0">
                                    <p className="font-bold text-white">Could not load team members</p>
                                    <p className="text-sm text-red-100/90 break-words">
                                        {formatTeamRpcFailure(directoryQueryError)}
                                    </p>
                                    {/not allowed/i.test(formatTeamRpcFailure(directoryQueryError)) && (
                                        <p className="text-xs text-red-200/90 leading-relaxed">
                                            Account Managers and Account Coordinators need a row in{' '}
                                            <code className="font-mono text-red-100">user_seller_assignments</code> linking their
                                            agency membership to this seller. Seller Admins and Agency Admins on the parent
                                            agency do not need that assignment.
                                        </p>
                                    )}
                                    {(isTeamRpcMissingFromDb(directoryQueryError) ||
                                        /missing|migration|function|does not exist/i.test(
                                            formatTeamRpcFailure(directoryQueryError)
                                        )) && (
                                        <p className="text-xs text-red-200/80 leading-relaxed">
                                            This usually means the database is missing RPCs such as{' '}
                                            <code className="text-red-100 font-mono">tenant_directory_for_admin</code>. Apply
                                            pending Supabase migrations (for example{' '}
                                            <code className="text-red-100 font-mono">supabase db push</code>) and reload. Details
                                            are logged in the browser console as{' '}
                                            <code className="text-red-100 font-mono">[Mamba team RPC]</code>.
                                        </p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white/[0.02] border border-white/10 rounded-3xl backdrop-blur-md shadow-2xl relative z-10 flex-1 flex flex-col">
                                <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent pointer-events-none rounded-3xl" />
                                <div className="relative z-10 flex-1 w-full pb-32">
                                    <table className="w-full text-left text-sm relative z-10">
                                        <thead>
                                        <tr className="border-b border-white/10 text-gray-400 text-xs font-bold uppercase tracking-wider bg-black/20">
                                            <th className="px-6 py-4">User</th>
                                            <th className="px-6 py-4">Role</th>
                                            <th className="px-6 py-4">Status</th>
                                            <th className="px-6 py-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {filteredMembers.map((row) => (
                                            <tr key={row.membership_id} className="hover:bg-white/[0.04] transition-colors group">
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-800 to-gray-900 border border-white/10 flex items-center justify-center shrink-0 shadow-inner group-hover:border-pink-500/30 transition-colors">
                                                            <span className="text-white font-bold text-sm">
                                                                {(row.full_name || row.email || '?')[0].toUpperCase()}
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <div className="font-bold text-white text-base">
                                                                {row.full_name || row.email || '—'}
                                                            </div>
                                                            <div className="text-xs text-gray-400 mt-0.5">{row.email}</div>
                                                            <div className="text-[10px] text-gray-500 font-mono mt-1.5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <span className="bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700">ID</span> {row.user_id}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5 align-top pt-7">
                                                    {row.user_id === user?.id && !isUnrestrictedAdmin ? (
                                                        <span className="text-pink-300 font-bold text-xs bg-pink-500/10 px-3 py-1.5 rounded-xl border border-pink-500/20 shadow-sm" title="You cannot change your own role">
                                                            {roleRows.find((r) => r.id === row.role_id)?.name ?? row.role_name}{' '}
                                                            <span className="text-pink-400 text-[10px] ml-1 uppercase">(you)</span>
                                                        </span>
                                                    ) : !canEditMemberRole(row) ? (
                                                        <span
                                                            className="inline-flex text-gray-200 font-bold text-xs bg-white/5 px-3 py-1.5 rounded-xl border border-white/10"
                                                            title="Read-only for your role"
                                                        >
                                                            {row.role_name || roleRows.find((r) => r.id === row.role_id)?.name || '—'}
                                                        </span>
                                                    ) : (
                                                        <div className="relative inline-block w-full max-w-[240px]">
                                                            <select
                                                                value={row.role_id}
                                                                disabled={busy === `m-${row.user_id}`}
                                                                onChange={(e) =>
                                                                    handleMemberRoleChange(row.user_id, e.target.value)
                                                                }
                                                                className="w-full bg-gray-950/80 border border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-white appearance-none cursor-pointer focus:outline-none focus:border-pink-500/50 hover:bg-white/5 transition-all shadow-sm"
                                                                style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                                                            >
                                                                {(isAccountManagerViewer && !canFullyManageTeamMembers
                                                                    ? roleRows.filter((r) => r.name === 'Account Coordinator')
                                                                    : roleRows
                                                                ).map((r) => (
                                                                    <option key={r.id} value={r.id} className="bg-gray-900">
                                                                        {r.name}
                                                                        {r.type === 'custom' ? ' (custom)' : ''}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-6 py-5 align-top pt-7">
                                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                                                        row.status === 'active'
                                                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                            : row.status === 'invited'
                                                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                                            : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                                                     }`}>
                                                         {row.status === 'invited' ? 'Pending' : row.status}
                                                     </span>
                                                </td>
                                                <td className="px-6 py-5 align-top pt-6 text-right">
                                                    {row.user_id !== user?.id && canActOnMemberRow(row) && (
                                                        <div className="relative inline-block">
                                                            <button
                                                                type="button"
                                                                disabled={busy === `action-${row.user_id}`}
                                                                onClick={() => setActionMenuOpen(prev => prev === row.membership_id ? null : row.membership_id)}
                                                                className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
                                                                title="Manage member"
                                                            >
                                                                {busy === `action-${row.user_id}`
                                                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                                                    : <MoreVertical className="w-4 h-4" />}
                                                            </button>
                                                            {actionMenuOpen === row.membership_id && (
                                                                <div className="absolute right-0 top-9 z-50 w-44 bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                                                                    {row.status !== 'deactivated' && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => { setActionMenuOpen(null); setConfirmAction({ userId: row.user_id, memberName: row.full_name || row.email || row.user_id, action: 'suspend' }); }}
                                                                            className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm text-amber-300 hover:bg-amber-500/10 transition-colors"
                                                                        >
                                                                            <UserX className="w-4 h-4" /> Suspend
                                                                        </button>
                                                                    )}
                                                                    {row.status === 'deactivated' && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => { setActionMenuOpen(null); setConfirmAction({ userId: row.user_id, memberName: row.full_name || row.email || row.user_id, action: 'reactivate' }); }}
                                                                            className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                                                                        >
                                                                            <UserCheck className="w-4 h-4" /> Reactivate
                                                                        </button>
                                                                    )}
                                                                    <div className="border-t border-white/5 my-1" />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => { setActionMenuOpen(null); setConfirmAction({ userId: row.user_id, memberName: row.full_name || row.email || row.user_id, action: 'remove' }); }}
                                                                        className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                                                                    >
                                                                        <LogOut className="w-4 h-4" /> Remove from team
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                    {filteredMembers.length === 0 && (
                                        <div className="p-16 text-center flex flex-col items-center justify-center text-gray-500 relative z-10">
                                            <Users className="w-12 h-12 mb-4 opacity-20" />
                                            <p className="text-base font-medium">No members match this search.</p>
                                            <p className="text-sm mt-1">Try a different email or name.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'roles' && (
                    <div className="flex gap-6 h-full flex-col lg:flex-row max-h-[calc(100vh-320px)]">
                        <div className="w-full lg:w-1/3 min-w-[320px] flex flex-col gap-4">
                            <div className="flex items-center justify-between bg-white/[0.02] border border-white/10 p-4 rounded-3xl backdrop-blur-sm shadow-sm">
                                <h3 className="font-bold text-lg text-white ml-2">Roles</h3>
                                {!isAccountCoordinatorViewer && (
                                    <button
                                        type="button"
                                        onClick={() => setCreateOpen(true)}
                                        className="p-2.5 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 rounded-xl text-white shadow-lg shadow-pink-500/20 transition-all hover:-translate-y-0.5"
                                        title="New custom role"
                                    >
                                        <Plus size={18} strokeWidth={3} />
                                    </button>
                                )}
                            </div>
                            {loadingRoles ? (
                                <div className="flex items-center justify-center p-12">
                                    <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
                                </div>
                            ) : (
                                <div className="space-y-3 overflow-y-auto pr-2 pb-10">
                                    {roleRows.map((role) => (
                                        <button
                                            type="button"
                                            key={role.id}
                                            onClick={() => setSelectedRoleId(role.id)}
                                            className={`w-full text-left p-5 rounded-3xl border transition-all duration-300 group ${selectedRoleId === role.id
                                                    ? 'bg-pink-500/10 border-pink-500/40 shadow-[0_0_30px_rgba(236,72,153,0.15)] ring-1 ring-pink-500/20'
                                                    : 'bg-white/[0.02] border-white/10 hover:border-pink-500/30 hover:bg-white/[0.04] backdrop-blur-sm'
                                                }`}
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-3 font-bold text-white text-base">
                                                    <div className={`p-2 rounded-xl border ${selectedRoleId === role.id ? 'bg-pink-500/20 border-pink-500/30 text-pink-400' : 'bg-white/5 border-white/10 text-gray-400 group-hover:bg-white/10 group-hover:text-pink-300'}`}>
                                                        {role.type === 'system' ? <Shield size={16} /> : <Lock size={16} />}
                                                    </div>
                                                    <span className="flex items-center gap-2">
                                                        {role.name}
                                                    </span>
                                                </div>
                                                <span className={`text-[10px] uppercase font-bold tracking-widest px-2 py-1 rounded-lg border ${role.type === 'system' ? 'bg-pink-500/10 text-pink-400 border-pink-500/20' : 'bg-violet-500/10 text-violet-400 border-violet-500/20'}`}>
                                                    {role.type}
                                                </span>
                                            </div>
                                            {role.description && (
                                                <p className={`text-sm mt-2 line-clamp-2 leading-relaxed ${selectedRoleId === role.id ? 'text-pink-100/70' : 'text-gray-400/80 group-hover:text-gray-300/90'}`}>{role.description}</p>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex-1 bg-white/[0.02] border border-white/10 rounded-[32px] p-6 lg:p-10 min-h-[500px] backdrop-blur-md shadow-2xl relative overflow-hidden flex flex-col">
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-pink-500/5 pointer-events-none" />

                            {!selectedRole ? (
                                <div className="h-full flex flex-col items-center justify-center text-gray-500 relative z-10 opacity-60">
                                    <div className="p-6 bg-white/5 rounded-full border border-white/10 mb-6">
                                        <Shield size={64} className="text-gray-400 drop-shadow-lg" />
                                    </div>
                                    <p className="text-lg font-bold">Select a role to view permissions</p>
                                    <p className="text-sm mt-2 max-w-xs text-center">Choose a role from the list to see its capabilities and edit custom permissions.</p>
                                </div>
                            ) : selectedRole.type === 'system' ? (
                                <div className="relative z-10 flex flex-col h-full">
                                    <div className="flex justify-between items-start mb-8 border-b border-white/10 pb-6 shrink-0">
                                        <div>
                                            <h2 className="text-3xl font-extrabold text-white flex items-center gap-4">
                                                {selectedRole.name}
                                                <span className="text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl bg-pink-500/10 text-pink-400 border border-pink-500/20 shadow-sm">
                                                    System Role
                                                </span>
                                            </h2>
                                            <p className="text-base text-gray-400/90 mt-3 max-w-2xl leading-relaxed">{selectedRole.description}</p>
                                        </div>
                                    </div>
                                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5 flex gap-4 text-blue-200 text-sm mb-8 shadow-inner shrink-0">
                                        <AlertCircle size={24} className="flex-shrink-0 mt-0.5 text-blue-400" />
                                        <p className="leading-relaxed">
                                            System roles are fixed in the database and immutable. To create customized access levels, click the <strong className="text-white bg-white/10 px-1.5 py-0.5 rounded ml-1 mr-1">+</strong> button to create a <strong>custom role</strong>.
                                        </p>
                                    </div>
                                    <div className="space-y-8 overflow-y-auto pr-4 pb-10 flex-1 custom-scrollbar">
                                        {permGroups.map(([group, perms]) => (
                                            <div key={group} className="bg-black/20 p-6 rounded-3xl border border-white/5">
                                                <h4 className="text-xs font-extrabold text-pink-400 uppercase tracking-widest flex items-center gap-3 mb-5">
                                                    <div className="p-1.5 bg-pink-500/20 rounded-md">
                                                        <Key size={14} className="text-pink-400" />
                                                    </div>
                                                    {group}
                                                </h4>
                                                <ul className="space-y-3">
                                                    {perms.map((p) => (
                                                        <li
                                                            key={p.id}
                                                            className="flex justify-between items-center py-3.5 px-5 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors"
                                                        >
                                                            <div>
                                                                <div className="text-sm font-bold text-gray-200">{p.description}</div>
                                                                <div className="text-[11px] text-gray-500 font-mono mt-1 opacity-70">
                                                                    {p.action}
                                                                </div>
                                                            </div>
                                                            <div
                                                                className={`flex items-center justify-center w-12 h-6 rounded-full transition-colors border ${rolePermActions.includes(p.action)
                                                                        ? 'bg-emerald-500/20 border-emerald-500/30'
                                                                        : 'bg-black/40 border-white/10'
                                                                    }`}
                                                            >
                                                                <div className={`w-4 h-4 rounded-full transition-transform ${rolePermActions.includes(p.action) ? 'bg-emerald-400 translate-x-2' : 'bg-gray-600 -translate-x-2'
                                                                    }`} />
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="relative z-10 flex flex-col h-full">
                                    <div className="flex justify-between items-start mb-8 border-b border-white/10 pb-6 shrink-0">
                                        <div>
                                            <h2 className="text-3xl font-extrabold text-white flex items-center gap-4">
                                                {selectedRole.name}
                                                <span className="text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl bg-violet-500/10 text-violet-300 border border-violet-500/20 shadow-sm">
                                                    Custom Role
                                                </span>
                                            </h2>
                                            <p className="text-base text-gray-400/90 mt-3 max-w-2xl leading-relaxed">{selectedRole.description}</p>
                                        </div>
                                        {!isAccountCoordinatorViewer && (
                                            <div className="flex gap-3">
                                                <button
                                                    type="button"
                                                    onClick={handleDeleteRole}
                                                    disabled={!!busy}
                                                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-500/30 text-red-400 font-bold hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-300 transition-all text-sm disabled:opacity-50"
                                                >
                                                    <Trash2 size={16} />
                                                    Delete Role
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-6 shrink-0 bg-white/5 w-fit px-3 py-1.5 rounded-lg border border-white/5">
                                        {isAccountCoordinatorViewer
                                            ? 'View only — Account Coordinators cannot edit custom roles.'
                                            : 'Toggle permissions and save. Changes apply to all users with this role.'}
                                    </p>
                                    <div className="flex-1 overflow-y-auto min-h-0 pb-6">
                                        {!skipPermissionCeiling && ceilingLoading ? (
                                            <div className="flex flex-col items-center justify-center py-16 text-gray-500 gap-3">
                                                <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
                                                <p className="text-sm">Loading permission scope…</p>
                                            </div>
                                        ) : (
                                            <CustomPermissionEditor
                                                permGroups={permGroupsForEditingCustom}
                                                selected={new Set(rolePermActions)}
                                                onSave={(actions) => handleSaveCustomPermissions(actions)}
                                                busy={busy === 'save-perms'}
                                                readOnly={isAccountCoordinatorViewer}
                                            />
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {createOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-md" onClick={() => setCreateOpen(false)} />
                    <div className="bg-gray-900/90 border border-white/10 rounded-3xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col shadow-2xl relative z-10 backdrop-blur-xl animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-6 border-b border-white/10 shrink-0 bg-white/[0.02]">
                            <h2 className="text-xl font-bold text-white flex items-center gap-3">
                                <div className="p-2 bg-pink-500/10 rounded-xl">
                                    <Shield size={20} className="text-pink-400" />
                                </div>
                                New Custom Role
                            </h2>
                            <button type="button" onClick={() => setCreateOpen(false)} className="text-gray-400 hover:text-white hover:bg-white/10 p-2 rounded-xl transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-5 overflow-y-auto flex-1 custom-scrollbar">
                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Role Name</label>
                                <input
                                    value={newRoleName}
                                    onChange={(e) => setNewRoleName(e.target.value)}
                                    placeholder="e.g. Content Manager"
                                    className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-4 text-sm text-white focus:outline-none focus:border-pink-500/50 transition-colors shadow-inner"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Description (optional)</label>
                                <input
                                    value={newRoleDesc}
                                    onChange={(e) => setNewRoleDesc(e.target.value)}
                                    placeholder="Brief explanation of this role's purpose"
                                    className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-4 text-sm text-white focus:outline-none focus:border-pink-500/50 transition-colors shadow-inner"
                                />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Permissions</label>
                                    <span className="text-xs text-pink-400 bg-pink-500/10 px-2 py-0.5 rounded border border-pink-500/20">{newRolePerms.size} selected</span>
                                </div>
                                <div className="max-h-56 overflow-y-auto space-y-2 border border-white/10 rounded-2xl p-3 bg-black/20 custom-scrollbar shadow-inner min-h-[120px]">
                                    {!skipPermissionCeiling && ceilingLoading ? (
                                        <div className="flex flex-col items-center justify-center py-10 text-gray-500 gap-2">
                                            <Loader2 className="w-7 h-7 animate-spin text-pink-500" />
                                            <p className="text-xs">Loading permissions…</p>
                                        </div>
                                    ) : !skipPermissionCeiling && ceilingError ? (
                                        <div className="flex gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm">
                                            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                            <div className="space-y-2 min-w-0">
                                                <p>
                                                    Unable to load available permissions for your role.{' '}
                                                    {formatTeamRpcFailure(ceilingQueryError)}
                                                </p>
                                                {(isTeamRpcMissingFromDb(ceilingQueryError) ||
                                                    /missing|migration|function|does not exist/i.test(
                                                        formatTeamRpcFailure(ceilingQueryError)
                                                    )) && (
                                                    <p className="text-xs text-amber-100/80 leading-relaxed">
                                                        Super Admins skip this call; other roles need{' '}
                                                        <code className="font-mono text-amber-100">get_my_custom_role_permission_ceiling</code>{' '}
                                                        on the database. Apply migrations (e.g.{' '}
                                                        <code className="font-mono text-amber-100">20260330270000_team_rpc_repair_and_directory_alias.sql</code>
                                                        ) via <code className="font-mono text-amber-100">supabase db push</code>. Check the
                                                        console for <code className="font-mono text-amber-100">[Mamba team RPC]</code> logs.
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ) : catalogForNewRole.length === 0 ? (
                                        <p className="text-sm text-gray-500 text-center py-8 px-2">
                                            No permissions are available to assign for this tenant with your current access.
                                        </p>
                                    ) : (
                                        catalogForNewRole.map((p) => (
                                            <label key={p.id} className="flex items-start gap-3 text-sm cursor-pointer p-2.5 hover:bg-white/[0.04] rounded-xl transition-colors group">
                                                <div className={`mt-0.5 flex items-center justify-center w-5 h-5 rounded flex-shrink-0 transition-colors border ${newRolePerms.has(p.action) ? 'bg-pink-500 border-pink-400' : 'bg-black/40 border-white/20 group-hover:border-white/40'}`}>
                                                    {newRolePerms.has(p.action) && <Check size={14} className="text-white" strokeWidth={3} />}
                                                </div>
                                                <div>
                                                    <div className={`font-bold ${newRolePerms.has(p.action) ? 'text-white' : 'text-gray-300 group-hover:text-white transition-colors'}`}>{p.description || p.action}</div>
                                                    <div className="text-[10px] text-gray-500 font-mono mt-0.5">{p.action}</div>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={newRolePerms.has(p.action)}
                                                    onChange={() => toggleNewPerm(p.action)}
                                                    className="hidden"
                                                />
                                            </label>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-white/10 flex justify-end gap-3 shrink-0 bg-white/[0.02]">
                            <button
                                type="button"
                                onClick={() => setCreateOpen(false)}
                                className="px-5 py-2.5 rounded-2xl text-gray-300 hover:text-white hover:bg-white/10 font-bold transition-all text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!newRoleName.trim() || busy === 'create'}
                                onClick={handleCreateRole}
                                className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white text-sm font-bold shadow-lg shadow-pink-500/20 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none disabled:transform-none"
                            >
                                {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus size={16} strokeWidth={3} />}
                                Create Role
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {assignOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-md" onClick={() => setAssignOpen(false)} />
                    <div className="bg-gray-900/90 border border-white/10 rounded-3xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto relative z-10 backdrop-blur-xl animate-in zoom-in-95 duration-200 custom-scrollbar">
                        <div className="flex justify-between items-center p-6 border-b border-white/10 sticky top-0 bg-gray-900/90 backdrop-blur-xl z-20">
                            <h2 className="text-xl font-bold text-white flex items-center gap-3">
                                <div className="p-2 bg-pink-500/10 rounded-xl">
                                    <UserPlus size={20} className="text-pink-400" />
                                </div>
                                Add or Assign Member
                            </h2>
                            <button type="button" onClick={() => setAssignOpen(false)} className="text-gray-400 hover:text-white hover:bg-white/10 p-2 rounded-xl transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-6">
                            <div className="bg-white/[0.02] border border-white/10 p-5 rounded-2xl shadow-inner">
                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <Shield className="w-4 h-4 text-pink-400" />
                                    Select Role
                                </label>
                                <div className="relative">
                                    <select
                                        value={assignRoleId}
                                        onChange={(e) => setAssignRoleId(e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl py-3 px-4 text-sm font-bold text-white appearance-none cursor-pointer focus:outline-none focus:border-pink-500/50 shadow-inner hover:bg-black/60 transition-colors"
                                        style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 1rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                                    >
                                        {roleRows.map((r) => (
                                            <option key={r.id} value={r.id} className="bg-gray-900">
                                                {r.name}
                                                {r.type === 'custom' ? ' (custom)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {selectedTenant?.type === 'seller' && sellerShopAccounts.length > 0 && (
                                <div className="rounded-2xl border border-pink-500/20 bg-pink-500/5 p-4 space-y-4">
                                    <label className="flex items-center gap-3 text-sm text-gray-200 cursor-pointer group">
                                        <div className={`flex items-center justify-center w-5 h-5 rounded flex-shrink-0 transition-colors border ${assignLinkShopDashboard ? 'bg-pink-500 border-pink-400' : 'bg-black/40 border-white/20 group-hover:border-white/40'}`}>
                                            {assignLinkShopDashboard && <Check size={14} className="text-white" strokeWidth={3} />}
                                        </div>
                                        <span>
                                            Also grant <strong className="text-pink-300">shop dashboard</strong> access
                                            <span className="text-[10px] text-gray-500 ml-2 font-mono bg-black/20 px-1 py-0.5 rounded border border-white/5">user_accounts</span>
                                        </span>
                                    </label>

                                    {assignLinkShopDashboard && (
                                        <div className="pl-8 slide-down">
                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">TikTok Shop account</label>
                                            <div className="relative">
                                                <select
                                                    value={assignAccountId}
                                                    onChange={(e) => setAssignAccountId(e.target.value)}
                                                    className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 text-sm font-bold text-white appearance-none cursor-pointer focus:outline-none focus:border-pink-500/50 hover:bg-black/60 transition-colors"
                                                    style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 1rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                                                >
                                                    {sellerShopAccounts.map((a) => (
                                                        <option key={a.id} value={a.id} className="bg-gray-900">
                                                            {a.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                                        <Search className="w-4 h-4" />
                                        Search Existing Users
                                    </label>
                                    <input
                                        value={assignSearchQuery}
                                        onChange={(e) => {
                                            setAssignSearchQuery(e.target.value);
                                            setAssignSelectedUser(null);
                                        }}
                                        placeholder="Type at least 2 chars (email/name)..."
                                        className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-4 text-sm text-white focus:outline-none focus:border-pink-500/50 shadow-inner placeholder-gray-600"
                                    />
                                    {assignSearchLoading && (
                                        <div className="mt-3 flex items-center gap-2 text-pink-400 text-xs font-bold uppercase tracking-wider pl-2">
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
                                        </div>
                                    )}
                                    {!assignSearchLoading && assignSearchResults.length > 0 && (
                                        <ul className="mt-3 max-h-48 overflow-y-auto rounded-2xl border border-white/10 divide-y divide-white/5 bg-black/20 custom-scrollbar shadow-inner">
                                            {assignSearchResults.map((u) => (
                                                <li key={u.id}>
                                                    <button
                                                        type="button"
                                                        onClick={() => setAssignSelectedUser(u)}
                                                        className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 ${assignSelectedUser?.id === u.id ? 'bg-pink-500/10 hover:bg-pink-500/20' : 'hover:bg-white/[0.04]'
                                                            }`}
                                                    >
                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${assignSelectedUser?.id === u.id ? 'bg-pink-500/30 border-pink-400 text-pink-200' : 'bg-gray-800 border-white/10 text-gray-400'}`}>
                                                            <span className="font-bold text-xs">{(u.full_name || u.email || '?')[0].toUpperCase()}</span>
                                                        </div>
                                                        <div>
                                                            <div className={`font-bold ${assignSelectedUser?.id === u.id ? 'text-pink-100' : 'text-gray-200'}`}>
                                                                {u.full_name || u.email}
                                                            </div>
                                                            <div className={`text-xs font-mono mt-0.5 ${assignSelectedUser?.id === u.id ? 'text-pink-300' : 'text-gray-500'}`}>
                                                                {u.email}
                                                            </div>
                                                        </div>
                                                        {assignSelectedUser?.id === u.id && (
                                                            <Check size={16} className="text-pink-400 ml-auto" strokeWidth={3} />
                                                        )}
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                <div className="border-t border-white/10 pt-5">
                                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
                                        Invite by Email
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="email"
                                            value={assignInviteEmail}
                                            onChange={(e) => setAssignInviteEmail(e.target.value)}
                                            placeholder="new.person@company.com"
                                            className="flex-1 bg-black/40 border border-white/10 rounded-2xl py-3 px-4 text-sm text-white focus:outline-none focus:border-pink-500/50 shadow-inner placeholder-gray-600"
                                        />
                                        <button
                                            type="button"
                                            disabled={!assignInviteEmail.trim() || !assignRoleId || busy === 'invite'}
                                            onClick={handleInviteAssign}
                                            className="flex items-center gap-2 px-6 py-3 rounded-2xl border border-violet-500/40 text-violet-300 font-bold hover:bg-violet-500/10 hover:border-violet-500/60 hover:text-violet-200 hover:shadow-[0_0_15px_rgba(139,92,246,0.2)] transition-all text-sm disabled:opacity-50 disabled:pointer-events-none"
                                        >
                                            {busy === 'invite' ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <UserPlus size={16} strokeWidth={3} className="shrink-0" />}
                                            Invite
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-gray-500 mt-2 uppercase tracking-wide">
                                        Sends an invite via email containing role assignment functionality.
                                    </p>
                                </div>

                                <div className="pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setAssignShowAdvancedUuid((v) => !v)}
                                        className="text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-pink-400 transition-colors flex items-center gap-2"
                                    >
                                        <ChevronRight size={14} className={`transition-transform duration-300 ${assignShowAdvancedUuid ? 'rotate-90 text-pink-400' : ''}`} />
                                        Advanced (Paste User ID)
                                    </button>
                                    {assignShowAdvancedUuid && (
                                        <div className="mt-3 slide-down">
                                            <input
                                                value={assignUserId}
                                                onChange={(e) => setAssignUserId(e.target.value)}
                                                placeholder="b9c8d7... (User UUID)"
                                                className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-4 text-sm font-mono text-white focus:outline-none focus:border-pink-500/50 shadow-inner placeholder-gray-600"
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-white/10 bg-white/[0.02] flex flex-wrap justify-end gap-3 sticky bottom-0 z-20 backdrop-blur-xl">
                            <button
                                type="button"
                                onClick={() => setAssignOpen(false)}
                                className="px-5 py-2.5 rounded-2xl text-gray-300 hover:text-white hover:bg-white/10 font-bold transition-all text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!(assignSelectedUser || assignUserId.trim()) || !assignRoleId || busy === 'assign'}
                                onClick={handleAssignMember}
                                className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white text-sm font-bold shadow-lg shadow-pink-500/20 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none disabled:transform-none"
                            >
                                {busy === 'assign' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check size={16} strokeWidth={3} />}
                                Assign Existing User
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Confirmation Modal for Suspend/Reactivate/Remove */}
            {inviteToast && (
                <div
                    role="status"
                    aria-live="polite"
                    className="fixed bottom-6 right-6 left-6 sm:left-auto z-[220] max-w-md mx-auto sm:mx-0 animate-in slide-in-from-bottom-4 fade-in duration-300 pointer-events-auto"
                >
                    <div className="rounded-2xl border border-pink-500/30 bg-gray-950/95 backdrop-blur-xl shadow-2xl shadow-black/60 p-5">
                        <div className="flex gap-3">
                            <div className="shrink-0 p-2.5 rounded-xl bg-pink-500/15 border border-pink-500/30">
                                <UserPlus className="w-5 h-5 text-pink-400" strokeWidth={2.5} />
                            </div>
                            <div className="min-w-0 pt-0.5">
                                <p className="text-sm font-bold text-white tracking-tight">Invitation sent</p>
                                <p className="text-sm text-gray-300 mt-2 leading-relaxed">
                                    <span className="text-pink-200 font-semibold">{inviteToast.displayName}</span>
                                    {' '}
                                    will be assigned to this team as soon as they accept. You can continue; their access
                                    stays pending until then.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {confirmAction && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-gray-900 border border-white/10 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative overflow-hidden slide-up">
                        <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent pointer-events-none" />
                        
                        <div className="relative z-10 flex flex-col items-center text-center">
                            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-6">
                                <AlertCircle className="w-8 h-8 text-red-400" />
                            </div>
                            
                            <h3 className="text-xl font-bold text-white mb-2">
                                Confirm Action
                            </h3>
                            
                            <p className="text-gray-400 text-sm mb-8 leading-relaxed">
                                Are you sure you want to <strong className="text-white">{confirmAction.action}</strong>{' '}
                                <strong className="text-white">{confirmAction.memberName}</strong>?
                                {confirmAction.action === 'remove' && ' This will permanently remove their access to this tenant.'}
                                {confirmAction.action === 'suspend' && ' They will lose access to this tenant until reactivated.'}
                            </p>
                            
                            <div className="flex items-center gap-4 w-full">
                                <button
                                    type="button"
                                    disabled={busy === `action-${confirmAction.userId}`}
                                    onClick={() => setConfirmAction(null)}
                                    className="flex-1 px-5 py-3 rounded-2xl text-gray-300 hover:text-white hover:bg-white/5 font-bold transition-all text-sm border border-transparent hover:border-white/10"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    disabled={busy === `action-${confirmAction.userId}`}
                                    onClick={() => handleMemberAction(confirmAction.action)}
                                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-sm font-bold shadow-lg shadow-red-500/20 transition-all hover:-translate-y-0.5 disabled:opacity-50"
                                >
                                    {busy === `action-${confirmAction.userId}` ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function CustomPermissionEditor({
    permGroups,
    selected,
    onSave,
    busy,
    readOnly = false,
}: {
    permGroups: [string, PermissionRow[]][];
    selected: Set<string>;
    onSave: (actions: string[]) => void;
    busy: boolean;
    readOnly?: boolean;
}) {
    const [local, setLocal] = useState<Set<string>>(selected);

    React.useEffect(() => {
        setLocal(new Set(selected));
    }, [selected]);

    const toggle = (action: string) => {
        setLocal((prev) => {
            const n = new Set(prev);
            if (n.has(action)) n.delete(action);
            else n.add(action);
            return n;
        });
    };

    const effective = readOnly ? selected : local;

    return (
        <div className="space-y-8 overflow-y-auto pr-4 pb-4 custom-scrollbar">
            {permGroups.map(([group, perms]) => (
                <div key={group} className="bg-black/20 p-6 rounded-3xl border border-white/5">
                    <h4 className="text-xs font-extrabold text-pink-400 uppercase tracking-widest mb-5 flex items-center gap-3">
                        <div className="p-1.5 bg-pink-500/20 rounded-md">
                            <Key size={14} className="text-pink-400" />
                        </div>
                        {group}
                    </h4>
                    <div className="space-y-3">
                        {perms.map((p) =>
                            readOnly ? (
                                <div
                                    key={p.id}
                                    className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/5"
                                >
                                    <div>
                                        <div className={`text-sm font-bold ${effective.has(p.action) ? 'text-white' : 'text-gray-400'}`}>
                                            {p.description}
                                        </div>
                                        <div className="text-[11px] text-gray-500 font-mono mt-1 opacity-70">{p.action}</div>
                                    </div>
                                    <div
                                        className={`flex items-center justify-center w-12 h-6 rounded-full transition-colors border shrink-0 ${effective.has(p.action) ? 'bg-emerald-500/20 border-emerald-500/30' : 'bg-black/40 border-white/10'}`}
                                    >
                                        <div
                                            className={`w-4 h-4 rounded-full transition-transform ${effective.has(p.action) ? 'bg-emerald-400 translate-x-2' : 'bg-gray-600 -translate-x-2'}`}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <label
                                    key={p.id}
                                    className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/5 cursor-pointer hover:bg-white/[0.06] transition-colors group"
                                >
                                    <div>
                                        <div className={`text-sm font-bold ${local.has(p.action) ? 'text-white' : 'text-gray-300 group-hover:text-white'} transition-colors`}>{p.description}</div>
                                        <div className="text-[11px] text-gray-500 font-mono mt-1 opacity-70">{p.action}</div>
                                    </div>
                                    <div className={`flex items-center justify-center w-12 h-6 rounded-full transition-colors border shrink-0 ${local.has(p.action) ? 'bg-emerald-500/20 border-emerald-500/30' : 'bg-black/40 border-white/10 group-hover:border-white/20'}`}>
                                        <div className={`w-4 h-4 rounded-full transition-transform ${local.has(p.action) ? 'bg-emerald-400 translate-x-2' : 'bg-gray-600 -translate-x-2'}`} />
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={local.has(p.action)}
                                        onChange={() => toggle(p.action)}
                                        className="hidden"
                                    />
                                </label>
                            )
                        )}
                    </div>
                </div>
            ))}
            {!readOnly && (
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSave(Array.from(local))}
                    className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white text-base font-bold shadow-lg shadow-pink-500/20 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none mt-6"
                >
                    {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield size={18} strokeWidth={3} />}
                    Save Custom Permissions
                </button>
            )}
        </div>
    );
}
