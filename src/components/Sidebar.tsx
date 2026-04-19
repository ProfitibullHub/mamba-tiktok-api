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
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTenantContext, primaryRoleBadgeClassName } from '../contexts/TenantContext';

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
}

export function Sidebar({ mode, activeTab, onTabChange, shopName }: SidebarProps) {
    const { profile, signOut } = useAuth();
    const { hasAgencyAccess, manageableAdminTenants, isPlatformSuperAdmin, primaryRoleBadge } = useTenantContext();
    const unreadCountShop = useNotificationStore((state) => state.unreadCount);
    const isAdminUser = isPlatformSuperAdmin;

    const legacy = profile?.role?.toLowerCase();
    const roleLabel =
        primaryRoleBadge?.label ??
        (legacy === 'admin' ? 'ADMIN' : profile?.role?.toUpperCase() || 'USER');
    const roleBadgeClass = primaryRoleBadge
        ? primaryRoleBadgeClassName(primaryRoleBadge.variant)
        : legacyRoleBadgeClass(legacy);

    return (
        <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-screen shrink-0">
            {/* Logo */}
            <div className="p-6 border-b border-gray-800">
                <div className="flex items-center gap-3">
                    <div className="bg-gradient-to-r from-pink-500 to-red-500 p-2 rounded-xl">
                        <Store className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-white">Mamba</h1>
                        <p className="text-xs text-gray-400">TikTok Shop Dashboard</p>
                    </div>
                </div>
            </div>

            <nav className="flex-1 p-4 overflow-y-auto">
                {mode === 'shop' && <ShopNav activeTab={activeTab} onTabChange={onTabChange} shopName={shopName} unreadCount={unreadCountShop} />}
                {mode === 'console' && (
                    <ConsoleNav
                        activeTab={activeTab}
                        onTabChange={onTabChange}
                        hasAgencyAccess={hasAgencyAccess}
                        canManageTeamRoles={manageableAdminTenants.length > 0 || isAdminUser}
                        isAdmin={isAdminUser}
                    />
                )}
            </nav>

            {/* User footer */}
            <div className="p-4 border-t border-gray-800">
                <div className="bg-gray-800 rounded-lg p-4 mb-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-400">Role</span>
                        <span className={`text-xs font-semibold px-2 py-1 rounded border ${roleBadgeClass}`}>
                            {roleLabel}
                        </span>
                    </div>
                    <p className="text-sm font-medium text-white truncate">{profile?.full_name}</p>
                    <p className="text-xs text-gray-400 truncate">{profile?.email}</p>
                </div>
                <button
                    onClick={signOut}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
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
}: {
    activeTab: string;
    onTabChange: (tab: string) => void;
    hasAgencyAccess: boolean;
    canManageTeamRoles: boolean;
    isAdmin: boolean;
}) {
    const unreadCount = useConsoleNotificationStore((state) => state.unreadCount);

    const consoleItems = [
        { id: 'home', label: 'Home', icon: LayoutDashboard },
        { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadCount },
        { id: 'profile', label: 'Profile', icon: Users },
    ];

    const orgItems = [
        ...(hasAgencyAccess ? [{ id: 'agency-console', label: 'Agency console', icon: Building2 }] : []),
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
                    <NavButton key={item.id} item={item} isActive={activeTab === item.id} onClick={() => onTabChange(item.id)} badge={item.badge} />
                ))}
            </div>

            <div className="mt-8">
                <p className="px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Organization &amp; access</p>
                <div className="space-y-1">
                    {orgItems.map((item) => (
                        <NavButton key={item.id} item={item} isActive={activeTab === item.id} onClick={() => onTabChange(item.id)} variant="violet" />
                    ))}
                </div>
            </div>

            {isAdmin && (
                <div className="mt-8">
                    <p className="px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Admin Panel</p>
                    <div className="space-y-1">
                        {adminItems.map((item) => (
                            <NavButton key={item.id} item={item} isActive={activeTab === item.id} onClick={() => onTabChange(item.id)} />
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
}: {
    activeTab: string;
    onTabChange: (tab: string) => void;
    shopName?: string;
    unreadCount: number;
}) {
    const shopItems = [
        { id: 'overview', label: 'Overview', icon: BarChart3 },
        { id: 'orders', label: 'Orders', icon: ShoppingBag },
        { id: 'products', label: 'Products', icon: Package },
        { id: 'profit-loss', label: 'P&L Statement', icon: Calculator },
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
                className="flex items-center gap-2 px-4 py-2.5 mb-4 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-all text-sm font-medium"
            >
                <ArrowLeft className="w-4 h-4" />
                Back to Console
            </Link>

            {shopName && (
                <div className="px-4 mb-4">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Shop</p>
                    <p className="text-sm font-semibold text-white truncate">{shopName}</p>
                </div>
            )}

            <div className="space-y-1">
                {shopItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => onTabChange(item.id)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-all ${
                            activeTab === item.id
                                ? 'bg-gradient-to-r from-pink-500/20 to-red-500/20 text-pink-400 border border-pink-500/30'
                                : 'text-gray-400 hover:text-white hover:bg-gray-800'
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            <item.icon className="w-5 h-5" />
                            <span>{item.label}</span>
                        </div>
                        {item.id === 'notifications' && unreadCount > 0 && (
                            <span className="bg-pink-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unreadCount}</span>
                        )}
                    </button>
                ))}
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
}: {
    item: { id: string; label: string; icon: any; badge?: number };
    isActive: boolean;
    onClick: () => void;
    variant?: 'pink' | 'violet';
    badge?: number;
}) {
    const Icon = item.icon;
    const activeClass =
        variant === 'violet'
            ? 'bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 text-violet-300 border border-violet-500/30'
            : 'bg-gradient-to-r from-pink-500/20 to-red-500/20 text-pink-400 border border-pink-500/30';

    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-all ${
                isActive ? activeClass : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
        >
            <div className="flex items-center gap-3">
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
            </div>
            {!!badge && badge > 0 && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    variant === 'violet' ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'bg-pink-500 text-white'
                }`}>
                    {badge}
                </span>
            )}
        </button>
    );
}
