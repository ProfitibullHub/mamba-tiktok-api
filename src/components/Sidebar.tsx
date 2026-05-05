import {
    ArrowLeft,
    BarChart3,
    Bell,
    Building2,
    Calculator,
    Database,
    Globe,
    LayoutDashboard,
    LogOut,
    Package,
    Search,
    Shield,
    ShoppingBag,
    Store,
    TrendingUp,
    Users,
    Activity,
    Palette,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTenantContext, primaryRoleBadgeClassName } from '../contexts/TenantContext';
import { useSellerBranding } from '../contexts/SellerBrandingContext';

function legacyRoleBadgeClass(legacy: string | undefined): string {
    if (legacy === 'admin') return 'bg-amber-500/20 text-amber-400';
    return 'bg-blue-500/20 text-blue-400';
}
import { useNotificationStore } from '../store/useNotificationStore';
import { useConsoleNotificationStore } from '../store/useConsoleNotificationStore';

interface SidebarProps {
    mode: 'console' | 'shop';
    activeTab: string;
    onTabChange: (tab: string) => void;
    shopName?: string;
    canConfigureFinancialRestrictions?: boolean;
}

export function Sidebar({
    mode,
    activeTab,
    onTabChange,
    shopName,
    canConfigureFinancialRestrictions = false,
}: SidebarProps) {
    const { profile, signOut } = useAuth();
    const { hasAgencyAccess, manageableAdminTenants, isPlatformSuperAdmin, primaryRoleBadge, loading: tenantLoading } = useTenantContext();
    const sellerBrand = useSellerBranding();
    const unreadCountShop = useNotificationStore((state) => state.unreadCount);
    const isAdminUser = isPlatformSuperAdmin;

    const consoleUsesAgencyBrand =
        mode === 'console' &&
        (sellerBrand.agencyConsoleBranding ||
            sellerBrand.data.source === 'configured' ||
            Boolean(sellerBrand.data.logoSignedUrl));

    /** Full header skeleton only on shop; console uses prefetched brand + CSS vars (no layout flash). */
    const shellBrandingPending = sellerBrand.shellPending && mode === 'shop';

    const legacy = profile?.role?.toLowerCase();
    const roleLabelResolved =
        primaryRoleBadge?.label ??
        (legacy === 'admin' ? 'ADMIN' : profile?.role?.toUpperCase() || 'USER');
    const roleBadgeClass = primaryRoleBadge
        ? primaryRoleBadgeClassName(primaryRoleBadge.variant)
        : legacyRoleBadgeClass(legacy);

    return (
        <div 
            className="w-64 border-r flex flex-col h-screen shrink-0"
            style={{ backgroundColor: 'var(--brand-sidebar-bg)', borderColor: 'var(--brand-sidebar-border)' }}
        >
            {/* Logo */}
            <div className="p-6 border-b" style={{ borderColor: 'var(--brand-sidebar-border)' }}>
                <div className="flex items-center gap-3">
                    {shellBrandingPending ? (
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="w-10 h-10 rounded-xl bg-gray-800/80 border border-white/5 shrink-0 animate-pulse" />
                            <div className="space-y-2 min-w-0 flex-1">
                                <div className="h-6 w-28 max-w-full bg-gray-800/80 rounded-lg animate-pulse" />
                                <div className="h-3 w-36 bg-gray-800/60 rounded animate-pulse" />
                            </div>
                        </div>
                    ) : (
                        <>
                            {mode === 'shop' || consoleUsesAgencyBrand ? (
                                sellerBrand.data.logoSignedUrl ? (
                                    <div className="w-10 h-10 rounded-xl border border-white/10 bg-gray-950 shrink-0 overflow-hidden flex items-center justify-center">
                                        <img
                                            src={sellerBrand.data.logoSignedUrl}
                                            alt=""
                                            className="max-w-full max-h-full object-contain p-1"
                                        />
                                    </div>
                                ) : (
                                    <div
                                        className="p-2 rounded-xl shadow-inner"
                                        style={{
                                            background: `linear-gradient(135deg, var(--brand-primary), var(--brand-secondary))`,
                                        }}
                                    >
                                        <Store className="w-6 h-6 brand-on-primary" />
                                    </div>
                                )
                            ) : (
                                <div className="bg-gradient-to-r from-pink-500 to-red-500 p-2 rounded-xl">
                                    <Store className="w-6 h-6 text-white" />
                                </div>
                            )}
                            <div>
                                <h1 className="text-xl font-bold brand-text">
                                    {mode === 'shop' || consoleUsesAgencyBrand ? sellerBrand.data.displayName : 'Mamba'}
                                </h1>
                                <p className="text-xs brand-muted">TikTok Shop Dashboard</p>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <nav className="flex-1 p-4 overflow-y-auto">
                {mode === 'shop' && (
                    <ShopNav
                        activeTab={activeTab}
                        onTabChange={onTabChange}
                        shopName={shopName}
                        unreadCount={unreadCountShop}
                        canConfigureFinancialRestrictions={canConfigureFinancialRestrictions}
                    />
                )}
                {mode === 'console' && (
                    <ConsoleNav
                        activeTab={activeTab}
                        onTabChange={onTabChange}
                        hasAgencyAccess={hasAgencyAccess}
                        canManageTeamRoles={manageableAdminTenants.length > 0 || isAdminUser}
                        isAdmin={isAdminUser}
                        useBrandAccent={
                            consoleUsesAgencyBrand &&
                            (mode === 'console' ? true : !sellerBrand.shellPending)
                        }
                    />
                )}
            </nav>

            {/* User footer */}
            <div className="p-4 border-t" style={{ borderColor: 'var(--brand-sidebar-border)' }}>
                <div className="rounded-lg p-4 mb-3" style={{ backgroundColor: 'var(--brand-sidebar-border)' }}>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs brand-muted">Role</span>
                        <span className={`text-xs font-semibold px-2 py-1 rounded border ${tenantLoading ? 'border-transparent' : roleBadgeClass}`}>
                            {tenantLoading ? (
                                <span className="inline-block h-3.5 w-[4.25rem] rounded bg-gray-600/50 animate-pulse" aria-label="Loading role" />
                            ) : (
                                roleLabelResolved
                            )}
                        </span>
                    </div>
                    <p className="text-sm font-medium brand-text truncate">{profile?.full_name}</p>
                    <p className="text-xs brand-muted truncate">{profile?.email}</p>
                </div>
                <button
                    onClick={signOut}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg brand-nav-idle hover:bg-white/5 transition-all"
                >
                    <LogOut className="w-4 h-4" />
                    <span className="font-medium">Sign Out</span>
                </button>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Console sidebar                                                    */
/* ------------------------------------------------------------------ */

function ConsoleNav({
    activeTab,
    onTabChange,
    hasAgencyAccess,
    canManageTeamRoles,
    isAdmin,
    useBrandAccent,
}: {
    activeTab: string;
    onTabChange: (tab: string) => void;
    hasAgencyAccess: boolean;
    canManageTeamRoles: boolean;
    isAdmin: boolean;
    useBrandAccent: boolean;
}) {
    const unreadCount = useConsoleNotificationStore((state) => state.unreadCount);

    const consoleItems = [
        { id: 'home', label: 'Home', icon: LayoutDashboard },
        { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadCount },
        { id: 'profile', label: 'Profile', icon: Users },
    ];

    const orgItems = [
        ...(hasAgencyAccess ? [{ id: 'agency-console', label: 'Agency console', icon: Building2 }] : []),
        ...(hasAgencyAccess ? [{ id: 'agency-branding', label: 'Seller branding', icon: Palette }] : []),
        ...(canManageTeamRoles ? [{ id: 'team-roles', label: 'Team & roles', icon: Users }] : []),
        { id: 'my-access', label: 'My access & roles', icon: Shield },
    ];

    const adminItems = [
        { id: 'admin-dashboard', label: 'Admin Dashboard', icon: BarChart3 },
        { id: 'platform-tenants', label: 'Platform tenants', icon: Globe },
        { id: 'ingestion-monitoring', label: 'Ingestion Monitoring', icon: Activity },
    ];

    return (
        <>
            <div className="space-y-1">
                {consoleItems.map((item) => (
                    <NavButton
                        key={item.id}
                        item={item}
                        isActive={activeTab === item.id}
                        onClick={() => onTabChange(item.id)}
                        badge={item.badge}
                        useBrandAccent={useBrandAccent}
                    />
                ))}
            </div>

            <div className="mt-8">
                <p className="px-4 text-xs font-semibold uppercase tracking-wider mb-2 brand-muted">Organization &amp; access</p>
                <div className="space-y-1">
                    {orgItems.map((item) => (
                        <NavButton
                            key={item.id}
                            item={item}
                            isActive={activeTab === item.id}
                            onClick={() => onTabChange(item.id)}
                            variant="violet"
                            useBrandAccent={useBrandAccent}
                        />
                    ))}
                </div>
            </div>

            {isAdmin && (
                <div className="mt-8">
                    <p className="px-4 text-xs font-semibold uppercase tracking-wider mb-2 brand-muted">Admin Panel</p>
                    <div className="space-y-1">
                        {adminItems.map((item) => (
                            <NavButton
                                key={item.id}
                                item={item}
                                isActive={activeTab === item.id}
                                onClick={() => onTabChange(item.id)}
                                useBrandAccent={useBrandAccent}
                            />
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}

/* ------------------------------------------------------------------ */
/*  Shop sidebar                                                       */
/* ------------------------------------------------------------------ */

function ShopNav({
    activeTab,
    onTabChange,
    shopName,
    unreadCount,
    canConfigureFinancialRestrictions,
}: {
    activeTab: string;
    onTabChange: (tab: string) => void;
    shopName?: string;
    unreadCount: number;
    canConfigureFinancialRestrictions: boolean;
}) {
    const shopItems = [
        { id: 'overview', label: 'Overview', icon: BarChart3 },
        { id: 'orders', label: 'Orders', icon: ShoppingBag },
        { id: 'products', label: 'Products', icon: Package },
        { id: 'profit-loss', label: 'P&L Statement', icon: Calculator },
        ...(canConfigureFinancialRestrictions
            ? [{ id: 'financial-restrictions', label: 'Financial Restrictions', icon: Shield }]
            : []),
        { id: 'marketing', label: 'Marketing', icon: TrendingUp },
        { id: 'notifications', label: 'Notifications', icon: Bell },
        { id: 'data-audit', label: 'Data Audit', icon: Database },
        { id: 'finance-debug', label: 'Finance Debug', icon: Search },
        { id: 'profile', label: 'Profile', icon: Users },
    ];

    return (
        <>
            <Link
                to="/"
                className="flex items-center gap-2 px-4 py-2.5 mb-4 rounded-lg brand-nav-idle hover:bg-white/5 transition-all text-sm font-medium"
            >
                <ArrowLeft className="w-4 h-4" />
                Back to Console
            </Link>

            {shopName && (
                <div className="px-4 mb-4">
                    <p className="text-[10px] uppercase tracking-wider mb-1 brand-muted">Shop</p>
                    <p className="text-sm font-semibold brand-text truncate">{shopName}</p>
                </div>
            )}

            <div className="space-y-1">
                {shopItems.map((item) => {
                    const isActive = activeTab === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => onTabChange(item.id)}
                            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-all border border-transparent ${
                                isActive ? '' : 'brand-nav-idle hover:bg-white/5'
                            }`}
                            style={
                                isActive
                                    ? {
                                          borderColor: 'var(--brand-primary)',
                                          color: 'var(--brand-primary)',
                                          backgroundColor: 'color-mix(in srgb, var(--brand-primary) 16%, transparent)',
                                      }
                                    : undefined
                            }
                        >
                            <div className="flex items-center gap-3">
                                <item.icon className="w-5 h-5" />
                                <span>{item.label}</span>
                            </div>
                            {item.id === 'notifications' && unreadCount > 0 && (
                                <span
                                    className="brand-on-primary text-xs font-bold px-2 py-0.5 rounded-full"
                                    style={{ backgroundColor: 'var(--brand-primary)' }}
                                >
                                    {unreadCount}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </>
    );
}

/* ------------------------------------------------------------------ */
/*  Shared nav button                                                  */
/* ------------------------------------------------------------------ */

function NavButton({
    item,
    isActive,
    onClick,
    variant = 'pink',
    badge,
    useBrandAccent = false,
    disabled = false,
}: {
    item: { id: string; label: string; icon: any; badge?: number };
    isActive: boolean;
    onClick: () => void;
    variant?: 'pink' | 'violet';
    badge?: number;
    useBrandAccent?: boolean;
    disabled?: boolean;
}) {
    const Icon = item.icon;
    const activeClass =
        variant === 'violet'
            ? 'bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 text-violet-300 border border-violet-500/30'
            : 'bg-gradient-to-r from-pink-500/20 to-red-500/20 text-pink-400 border border-pink-500/30';

    const brandActiveStyle =
        useBrandAccent && isActive
            ? {
                  borderColor: 'var(--brand-primary)',
                  color: 'var(--brand-primary)',
                  backgroundColor: 'color-mix(in srgb, var(--brand-primary) 16%, transparent)',
              }
            : undefined;

    const borderClass = isActive && useBrandAccent ? 'border' : !isActive ? 'border border-transparent' : '';
    const inactiveNavClass = useBrandAccent
        ? 'brand-nav-idle hover:bg-white/5'
        : 'text-gray-400 hover:text-white hover:bg-white/5';
    const rowClass = isActive && !useBrandAccent ? activeClass : !isActive ? inactiveNavClass : '';

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-all disabled:opacity-45 disabled:cursor-not-allowed ${borderClass} ${rowClass}`.trim()}
            style={brandActiveStyle}
        >
            <div className="flex items-center gap-3">
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
            </div>
            {!!badge && badge > 0 && (
                <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        useBrandAccent
                            ? 'brand-on-primary border border-white/10'
                            : variant === 'violet'
                              ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                              : 'bg-pink-500 text-white'
                    }`}
                    style={useBrandAccent ? { backgroundColor: 'var(--brand-primary)' } : undefined}
                >
                    {badge}
                </span>
            )}
        </button>
    );
}
