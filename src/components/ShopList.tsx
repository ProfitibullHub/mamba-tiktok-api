import { Plus, ShoppingBag, MapPin, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';

interface Shop {
    shop_id: string;
    shop_name: string;
    region: string;
    seller_type: string;
    created_at: string;
}

interface ShopListProps {
    shops: Shop[];
    onSelectShop: (shop: Shop) => void;
    onAddShop: () => void;
    onAddAgency?: () => void;
    onSyncShops: () => void;
    onDeleteShop: (shop: Shop) => void;
    isLoading?: boolean;
    isSyncing?: boolean;
}

export function ShopList({ shops, onSelectShop, onAddShop, onAddAgency, onSyncShops, onDeleteShop, isLoading, isSyncing }: ShopListProps) {
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

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white">Your Shops</h2>
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {shops.map((shop) => (
                    <div
                        key={shop.shop_id}
                        onClick={() => onSelectShop(shop)}
                        className="bg-gray-800 rounded-xl p-6 border border-gray-700 hover:border-pink-500 transition-all cursor-pointer group relative overflow-hidden"
                    >
                        <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-2">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteShop(shop);
                                }}
                                className="p-2 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-lg transition-colors"
                                title="Delete Shop"
                            >
                                <Trash2 size={16} />
                            </button>
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
                            <span>{new Date(shop.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                ))}

                {}
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
        </div>
    );
}
