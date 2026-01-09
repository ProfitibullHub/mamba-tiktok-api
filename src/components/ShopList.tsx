import { Plus, ShoppingBag, MapPin, ExternalLink, RefreshCw, Trash2, User } from 'lucide-react';

interface Shop {
    shop_id: string;
    shop_name: string;
    region: string;
    seller_type: string;
    created_at: string;
}

interface AdminAccount {
    id: string;
    account_name: string;
    owner_role?: string;
    original_name?: string;
    owner_id?: string;
    stores: Shop[];
}

interface ShopListProps {
    shops: Shop[];
    adminAccounts?: AdminAccount[];
    currentUserId?: string;
    deletingShopId?: string | null;
    onSelectShop: (shop: Shop, account?: AdminAccount) => void;
    onAddShop: () => void;
    onAddAgency?: () => void;
    onSyncShops: () => void;
    onDeleteShop: (shop: Shop) => void;
    isLoading?: boolean;
    isSyncing?: boolean;
}

function ShopCard({ shop, onSelect, onDelete, isDeleting }: { shop: Shop, onSelect: () => void, onDelete?: (e: React.MouseEvent) => void, isDeleting?: boolean }) {
    return (
        <div
            onClick={onSelect}
            className="bg-gray-800 rounded-xl p-6 border border-gray-700 hover:border-pink-500 transition-all cursor-pointer group relative overflow-hidden"
        >
            <div className={`absolute top-0 right-0 p-4 transition-opacity flex space-x-2 ${isDeleting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                {onDelete && (
                    <button
                        onClick={onDelete}
                        disabled={isDeleting}
                        className={`p-2 rounded-lg transition-colors ${isDeleting
                            ? 'bg-red-500/10 text-red-500 cursor-wait'
                            : 'bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white'
                            }`}
                        title="Delete Shop"
                    >
                        {isDeleting ? (
                            <RefreshCw size={16} className="animate-spin" />
                        ) : (
                            <Trash2 size={16} />
                        )}
                    </button>
                )}
                <ExternalLink size={20} className="text-gray-400 group-hover:text-pink-500" />
            </div>

            <div className="flex items-start space-x-4">
                <div className="p-3 bg-gray-700 rounded-lg group-hover:bg-pink-500/10 group-hover:text-pink-500 transition-colors">
                    <ShoppingBag size={24} />
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-white mb-1">{shop.shop_name}</h3>
                    <div className="flex items-center text-gray-400 text-sm mb-2">
                        <MapPin size={14} className="mr-1" />
                        {shop.region}
                    </div>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-900/50 text-green-400">
                        Active
                    </span>
                </div>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-700 flex justify-between items-center text-sm text-gray-400">
                <span>ID: {shop.shop_id}</span>
                <span>{shop.created_at ? new Date(shop.created_at).toLocaleDateString() : 'N/A'}</span>
            </div>
        </div>
    );
}

export function ShopList({ shops, adminAccounts, currentUserId, deletingShopId, onSelectShop, onAddShop, onAddAgency, onSyncShops, onDeleteShop, isLoading, isSyncing }: ShopListProps) {
    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-gray-800 rounded-xl p-6 h-48 animate-pulse">
                        <div className="h-6 bg-gray-700 rounded w-3/4 mb-4"></div>
                        <div className="h-4 bg-gray-700 rounded w-1/2 mb-2"></div>
                        <div className="h-4 bg-gray-700 rounded w-1/3"></div>
                    </div>
                ))}
            </div>
        );
    }

    const isAdmin = adminAccounts && adminAccounts.length > 0;

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white">
                    {isAdmin ? 'All Platform Shops' : 'Your Shops'}
                </h2>
                <div className="flex space-x-3">
                    <button
                        onClick={onSyncShops}
                        disabled={isSyncing}
                        className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <RefreshCw size={20} className={isSyncing ? "animate-spin" : ""} />
                        <span>{isSyncing ? 'Syncing...' : 'Sync Shops'}</span>
                    </button>
                    <button
                        onClick={onAddShop}
                        className="flex items-center space-x-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors"
                    >
                        <Plus size={20} />
                        <span>Add Shop</span>
                    </button>
                    {onAddAgency && (
                        <button
                            onClick={onAddAgency}
                            className="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                        >
                            <Plus size={20} />
                            <span>Add Agency</span>
                        </button>
                    )}
                </div>
            </div>

            {isAdmin ? (
                <div className="space-y-12">
                    {adminAccounts.map((account) => (
                        <div key={account.id} className="space-y-6">
                            <div className="flex items-center gap-3 border-b border-gray-700 pb-4">
                                <div className="p-2 bg-pink-500/10 rounded-lg">
                                    <User className="w-5 h-5 text-pink-500" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-xl font-bold text-white">{account.account_name}</h3>
                                        {(account as any).owner_role && (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-pink-500/20 text-pink-400 border border-pink-500/30">
                                                {(account as any).owner_role.toUpperCase()}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-500">{account.stores.length} connected shops</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {account.stores.map((shop) => (
                                    <ShopCard
                                        key={shop.shop_id}
                                        shop={shop}
                                        isDeleting={deletingShopId === shop.shop_id}
                                        onSelect={() => onSelectShop(shop, account)}
                                        onDelete={
                                            // Only show delete button if current user owns this account
                                            account.owner_id === currentUserId
                                                ? (e) => {
                                                    e.stopPropagation();
                                                    onDeleteShop(shop);
                                                }
                                                : undefined
                                        }
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {shops.map((shop) => (
                        <ShopCard
                            key={shop.shop_id}
                            shop={shop}
                            isDeleting={deletingShopId === shop.shop_id}
                            onSelect={() => onSelectShop(shop)}
                            onDelete={(e) => {
                                e.stopPropagation();
                                onDeleteShop(shop);
                            }}
                        />
                    ))}

                    {/* Add Shop Card (always visible at the end for regular users) */}
                    <button
                        onClick={onAddShop}
                        className="flex flex-col items-center justify-center h-full min-h-[200px] bg-gray-800/50 rounded-xl border-2 border-dashed border-gray-700 hover:border-pink-500 hover:bg-gray-800 transition-all group"
                    >
                        <div className="p-4 bg-gray-700 rounded-full mb-4 group-hover:bg-pink-600 group-hover:text-white transition-colors">
                            <Plus size={32} />
                        </div>
                        <span className="text-lg font-medium text-gray-300 group-hover:text-white">Connect New Shop</span>
                    </button>
                </div>
            )}
        </div>
    );
}
