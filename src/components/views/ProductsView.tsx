import { useState } from 'react';
import { Search, Filter, RefreshCw } from 'lucide-react';
import { useShopStore, Product } from '../../store/useShopStore';
import { Account } from '../../lib/supabase';
import { ProductCard } from '../ProductCard';
import { ProductDetails } from '../ProductDetails';

interface ProductsViewProps {
    account: Account;
    shopId?: string;
}

export function ProductsView({ account, shopId }: ProductsViewProps) {
    const { products, isLoading, syncData, cacheMetadata } = useShopStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 50;

    const handleSync = async () => {
        if (!shopId) return;
        await syncData(account.id, shopId, 'products');
    };

    const filteredProducts = products.filter(product => {
        const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === 'all' || product.status.toLowerCase() === statusFilter.toLowerCase();
        return matchesSearch && matchesStatus;
    });

    // Reset page when filters change
    if (currentPage > 1 && filteredProducts.length < (currentPage - 1) * itemsPerPage) {
        setCurrentPage(1);
    }

    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    const paginatedProducts = filteredProducts.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-white">Products</h2>
                    <p className="text-gray-400">Manage your product inventory</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleSync}
                        disabled={cacheMetadata.isSyncing || isLoading}
                        className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={20} className={cacheMetadata.isSyncing ? "animate-spin" : ""} />
                        <span>{cacheMetadata.isSyncing ? 'Syncing...' : 'Sync Products'}</span>
                    </button>
                    {/* Placeholder for Add Product if needed */}
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search products..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 text-white pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:border-pink-500"
                    />
                </div>
                <div className="flex gap-4">
                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-gray-900 border border-gray-700 text-white pl-10 pr-8 py-2 rounded-lg focus:outline-none focus:border-pink-500 appearance-none cursor-pointer"
                        >
                            <option value="all">All Status</option>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                            <option value="frozen">Frozen</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Products Grid */}
            {isLoading && products.length === 0 ? (
                <div className="flex justify-center items-center h-64">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
                </div>
            ) : filteredProducts.length > 0 ? (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {paginatedProducts.map((product) => (
                            <ProductCard
                                key={product.product_id}
                                product={product}
                                onClick={() => setSelectedProduct(product)}
                            />
                        ))}
                    </div>

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div className="flex justify-center items-center space-x-4 mt-8">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className="px-4 py-2 bg-gray-800 text-white rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors"
                            >
                                Previous
                            </button>
                            <span className="text-gray-400">
                                Page {currentPage} of {totalPages}
                            </span>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage === totalPages}
                                className="px-4 py-2 bg-gray-800 text-white rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <div className="text-center py-12 bg-gray-800/30 rounded-xl border border-gray-700 border-dashed">
                    <p className="text-gray-400 text-lg">No products found matching your criteria</p>
                </div>
            )}

            {/* Product Details Modal */}
            {selectedProduct && (
                <ProductDetails
                    product={selectedProduct}
                    onClose={() => setSelectedProduct(null)}
                />
            )}
        </div>
    );
}
