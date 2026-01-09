import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Store, Package, ShoppingBag, Globe, User, ChevronRight, X, Calculator, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export function AdminStoreManagement() {
    const { profile } = useAuth();
    const [selectedAccount, setSelectedAccount] = useState<any>(null);
    const [selectedShopForPL, setSelectedShopForPL] = useState<any>(null);

    const { data: accounts, isLoading } = useQuery({
        queryKey: ['admin-stores'],
        queryFn: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const response = await fetch(`${API_BASE_URL}/api/admin/stores`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            if (data.success) return data.data;
            throw new Error(data.error);
        },
        enabled: profile?.role === 'admin'
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-bold text-white mb-2">Store Management</h2>
                <p className="text-gray-400">Monitor all integrated TikTok Shops and their performance.</p>
            </div>

            <div className="bg-gray-800/50 border border-gray-700 rounded-2xl overflow-hidden">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-gray-700 bg-gray-800/50">
                            <th className="px-6 py-4 text-sm font-semibold text-gray-300">Account Owner</th>
                            <th className="px-6 py-4 text-sm font-semibold text-gray-300">Connected Stores</th>
                            <th className="px-6 py-4 text-sm font-semibold text-gray-300 text-center">Products</th>
                            <th className="px-6 py-4 text-sm font-semibold text-gray-300 text-center">Orders</th>
                            <th className="px-6 py-4 text-sm font-semibold text-gray-300">Total Revenue</th>
                            <th className="px-6 py-4 text-sm font-semibold text-gray-300">Net Profit</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                        {accounts?.map((account: any) => (
                            <tr key={account.id} className="hover:bg-gray-700/30 transition-colors">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-blue-500/10 p-2 rounded-lg">
                                            <User className="w-4 h-4 text-blue-400" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-white">{account.account_name}</p>
                                            <p className="text-xs text-gray-500">{account.original_name}</p>
                                        </div>
                                    </div>
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
                                                onClick={() => setSelectedAccount(account)}
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
                                        <Package className="w-3.5 h-3.5 text-gray-400" />
                                        <span className="text-sm text-white font-medium">{account.totalProducts}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <div className="flex items-center justify-center gap-2">
                                        <ShoppingBag className="w-3.5 h-3.5 text-gray-400" />
                                        <span className="text-sm text-white font-medium">{account.totalOrders}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="text-sm font-semibold text-green-400">
                                        ${account.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`text-sm font-semibold ${account.totalNet >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                                        ${account.totalNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* All Stores Modal */}
            {selectedAccount && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl">
                        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between bg-gray-800/50">
                            <div>
                                <h3 className="text-lg font-bold text-white">{selectedAccount.account_name}'s Stores</h3>
                                <p className="text-xs text-gray-400">{selectedAccount.stores.length} stores connected</p>
                            </div>
                            <button
                                onClick={() => setSelectedAccount(null)}
                                className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>
                        <div className="p-6 max-h-[60vh] overflow-y-auto">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {selectedAccount.stores.map((store: any) => (
                                    <div key={store.id} className="bg-gray-800/50 border border-gray-700 p-4 rounded-xl flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="bg-pink-500/10 p-2 rounded-lg">
                                                    <Store className="w-4 h-4 text-pink-400" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium text-white">{store.shop_name}</p>
                                                    <div className="flex items-center gap-1 mt-0.5">
                                                        <Globe className="w-3 h-3 text-gray-500" />
                                                        <span className="text-[10px] text-gray-500 uppercase">{store.region}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs font-semibold text-green-400">${store.revenue.toLocaleString()}</p>
                                                <p className="text-[10px] text-gray-500">{store.ordersCount} orders</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                                            <div className="text-left">
                                                <p className="text-[10px] text-gray-500 uppercase font-bold">Net Profit</p>
                                                <p className={`text-sm font-bold ${store.net >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                                                    ${store.net.toLocaleString()}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => setSelectedShopForPL(store)}
                                                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-[10px] font-bold rounded-lg transition-colors flex items-center gap-1"
                                            >
                                                <Calculator className="w-3 h-3" />
                                                View P&L
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-gray-700 bg-gray-800/50 flex justify-end">
                            <button
                                onClick={() => setSelectedAccount(null)}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* P&L Breakdown Modal */}
            {selectedShopForPL && (
                <PLBreakdownModal
                    shop={selectedShopForPL}
                    onClose={() => setSelectedShopForPL(null)}
                />
            )}
        </div>
    );
}

function PLBreakdownModal({ shop, onClose }: { shop: any, onClose: () => void }) {
    const { data: plData, isLoading } = useQuery({
        queryKey: ['admin-shop-pl', shop.id],
        queryFn: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const response = await fetch(`${API_BASE_URL}/api/admin/stores/${shop.id}/pl`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            if (data.success) return data.data;
            throw new Error(data.error);
        }
    });

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
                <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between bg-gray-800/50">
                    <div>
                        <h3 className="text-lg font-bold text-white">P&L Breakdown</h3>
                        <p className="text-xs text-gray-400">{shop.shop_name} • {shop.region}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                <div className="p-6">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-2 border-pink-500 border-t-transparent"></div>
                        </div>
                    ) : plData ? (
                        <div className="space-y-6">
                            {/* Revenue Section */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-400">Sales Revenue (Orders)</span>
                                    <span className="text-white font-bold">${plData.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-gray-500">Unsettled Revenue (Est.)</span>
                                    <span className="text-cyan-400">+${plData.unsettledRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                                <div className="h-px bg-gray-800" />

                                {/* Costs Section */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-gray-500">Platform Fees</span>
                                        <span className="text-red-400">-${plData.platformFees.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-gray-500">Shipping Fees</span>
                                        <span className="text-red-400">-${plData.shippingFees.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-gray-500">Affiliate Commissions</span>
                                        <span className="text-red-400">-${plData.affiliateCommissions.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-gray-500">Refunds</span>
                                        <span className="text-red-400">-${plData.refunds.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-gray-500">Adjustments</span>
                                        <span className={plData.adjustments >= 0 ? 'text-green-400' : 'text-red-400'}>
                                            {plData.adjustments >= 0 ? '+' : ''}${plData.adjustments.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                    <div className="h-px bg-gray-800/50 my-2" />
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-gray-500">Product Costs (Est. 30%)</span>
                                        <span className="text-red-400">-${plData.productCosts.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-gray-500">Operational Costs (Est. 10%)</span>
                                        <span className="text-red-400">-${plData.operationalCosts.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Summary Section */}
                            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-1.5 rounded-lg ${plData.netProfit >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                                            <Wallet className={`w-4 h-4 ${plData.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`} />
                                        </div>
                                        <span className="text-sm font-bold text-white">Net Profit</span>
                                    </div>
                                    <span className={`text-xl font-black ${plData.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        ${plData.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </span>
                                </div>
                            </div>

                            <div className="text-center">
                                <p className="text-[10px] text-gray-500 italic">
                                    Based on {plData.settlementCount} settlement transactions
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            No P&L data found for this shop.
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-gray-700 bg-gray-800/50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
