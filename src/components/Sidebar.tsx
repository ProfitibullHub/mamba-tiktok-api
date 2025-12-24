import { BarChart3, ShoppingBag, Package, Calculator, Store, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { profile, signOut } = useAuth();

  const menuItems = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'orders', label: 'Orders', icon: ShoppingBag },
    { id: 'products', label: 'Products', icon: Package },
    { id: 'profit-loss', label: 'P&L Statement', icon: Calculator },
  ];

  return (
    <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-screen">
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
        <div className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all ${isActive
                  ? 'bg-gradient-to-r from-pink-500/20 to-red-500/20 text-pink-400 border border-pink-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="p-4 border-t border-gray-800">
        <div className="bg-gray-800 rounded-lg p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">Role</span>
            <span className={`text-xs font-semibold px-2 py-1 rounded ${profile?.role === 'admin'
              ? 'bg-pink-500/20 text-pink-400'
              : 'bg-blue-500/20 text-blue-400'
              }`}>
              {profile?.role?.toUpperCase()}
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
