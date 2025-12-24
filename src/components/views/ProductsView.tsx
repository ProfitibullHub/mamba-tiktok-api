import { Package, AlertCircle, TrendingUp, DollarSign } from 'lucide-react';
import { Account } from '../../lib/supabase';
import { useShopStore } from '../../store/useShopStore';

interface ProductsViewProps {
    account: Account;
    shopId?: string;
}

export function ProductsView({ account }: ProductsViewProps) {
    const products = useShopStore(state => state.products);
    const isLoading = useShopStore(state => state.isLoading);
    const error = useShopStore(state => state.error);
    const fetchShopData = useShopStore(state => state.fetchShopData);

    console.log('[ProductsView] Rendering with:', { productsCount: products.length, isLoading, error });



    const handleRefresh = () => {
        if (account.id) {
            fetchShopData(account.id, undefined, true);
        }
    };

    const getLowStockProducts = () => {
        return products.filter(p => p.stock_quantity < 10 && p.status === 'active');
    };

    const getTotalValue = () => {
        return products.reduce((sum, p) => sum + (p.price * p.stock_quantity), 0);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-center">
                <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                <p className="text-red-400 text-lg font-medium">{error}</p>
                <button
                    onClick={handleRefresh}
                    className="mt-4 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                >
                    Retry
                </button>
            </div>
        );
    }

    const lowStockProducts = getLowStockProducts();

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white">Products</h2>
                <button
                    onClick={handleRefresh}
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                >
                    Refresh
                </button>
            </div>

            {}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/30 rounded-xl p-6 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-500/20 rounded-lg">
                            <Package className="w-6 h-6 text-blue-400" />
                        </div>
                        <div>
                            <p className="text-gray-400 text-sm">Total Products</p>
                            <p className="text-2xl font-bold text-white">{products.length}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 rounded-xl p-6 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-yellow-500/20 rounded-lg">
                            <AlertCircle className="w-6 h-6 text-yellow-400" />
                        </div>
                        <div>
                            <p className="text-gray-400 text-sm">Low Stock</p>
                            <p className="text-2xl font-bold text-white">{lowStockProducts.length}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl p-6 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-green-500/20 rounded-lg">
                            <DollarSign className="w-6 h-6 text-green-400" />
                        </div>
                        <div>
                            <p className="text-gray-400 text-sm">Inventory Value</p>
                            <p className="text-2xl font-bold text-white">${getTotalValue().toFixed(2)}</p>
                        </div>
                    </div>
                </div>
            </div>

            {}
            {lowStockProducts.length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-yellow-400" />
                        <p className="text-yellow-400 font-medium">
                            {lowStockProducts.length} product{lowStockProducts.length > 1 ? 's' : ''} running low on stock
                        </p>
                    </div>
                </div>
            )}

            {}
            {products.length === 0 ? (
                <div className="text-center py-12 bg-gray-800/50 rounded-xl border border-gray-700 border-dashed">
                    <Package className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                    <p className="text-gray-400 text-lg">No products found</p>
                    <p className="text-gray-500 text-sm mt-2">Products will appear here once you connect your TikTok Shop</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {products.map((product) => (
                        <div key={product.product_id} className="group bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden hover:ring-2 hover:ring-pink-500/50 hover:bg-gray-800 transition-all duration-300">
                            <div className="aspect-square bg-gray-900 flex items-center justify-center relative overflow-hidden">
                                {product.main_image_url ? (
                                    <img
                                        src={product.main_image_url}
                                        alt={product.name}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                ) : (
                                    <Package className="w-16 h-16 text-gray-700" />
                                )}
                                <div className="absolute top-2 right-2">
                                    <span className={`px-2 py-1 rounded-md text-xs font-medium backdrop-blur-md ${product.status === 'active'
                                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                        : 'bg-gray-700/80 text-gray-400 border border-gray-600'
                                        }`}>
                                        {product.status}
                                    </span>
                                </div>
                            </div>
                            <div className="p-4">
                                <h3 className="text-white font-medium mb-1 line-clamp-2 h-12" title={product.name}>
                                    {product.name}
                                </h3>
                                <div className="flex items-end justify-between mb-4">
                                    <span className="text-xl font-bold text-pink-400">
                                        {product.currency === 'USD' ? '$' : product.currency}
                                        {product.price?.toFixed(2)}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-sm pt-3 border-t border-gray-700/50">
                                    <div className="flex items-center gap-2 text-gray-400">
                                        <Package className="w-4 h-4 text-gray-500" />
                                        <span>{product.stock_quantity} in stock</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-gray-400 justify-end">
                                        <TrendingUp className="w-4 h-4 text-gray-500" />
                                        <span>{product.sales_count || 0} sold</span>
                                    </div>
                                </div>
                                {product.stock_quantity < 10 && product.status === 'active' && (
                                    <div className="mt-3 flex items-center gap-1.5 text-yellow-400 text-xs bg-yellow-500/10 px-2 py-1 rounded border border-yellow-500/20">
                                        <AlertCircle className="w-3 h-3" />
                                        <span>Low stock warning</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
