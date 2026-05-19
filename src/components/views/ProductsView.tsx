import { useState, useMemo } from 'react';
import { Search, Filter, RefreshCw, Settings, AlertTriangle, CheckCircle } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useShopStore, Product } from '../../store/useShopStore';
import { Account } from '../../lib/supabase';
import { ProductCard } from '../ProductCard';
import { ProductDetails } from '../ProductDetails';
import { ProductManagementView } from './ProductManagementView';
import { useShopAccessFlags } from '../../hooks/useShopMutationAccess';

interface ProductsViewProps {
    account: Account;
    shopId?: string;
}

export function ProductsView({ account, shopId }: ProductsViewProps) {
    const { canMutateShop, canSyncShop } = useShopAccessFlags(account);
    const { products, orders, isLoading, syncData, cacheMetadata, dataVersion } = useShopStore(
        useShallow((s) => ({
            products: s.products,
            orders: s.orders,
            isLoading: s.isLoading,
            syncData: s.syncData,
            cacheMetadata: s.cacheMetadata,
            dataVersion: s.dataVersion,
        })),
    );
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [showManagement, setShowManagement] = useState(false);

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 50;

    // Calculate sales counts from actual orders
    const productSalesMap = useMemo(() => {
        const salesMap = new Map<string, number>();

        orders.forEach(order => {
            // Skip cancelled/returned/sample orders
            if (order.order_status === 'CANCELLED' ||
                order.order_status === 'RETURNED' ||
                order.is_sample_order === true) {
                return;
            }

            order.line_items.forEach(item => {
                const quantity = item.quantity || 0;

                // Find product by SKU or name
                const product = products.find(p =>
                    (item.seller_sku && p.skus?.some(s => s.seller_sku === item.seller_sku)) ||
                    p.name === item.product_name
                );

                if (product) {
                    const currentSales = salesMap.get(product.product_id) || 0;
                    salesMap.set(product.product_id, currentSales + quantity);
                }
            });
        });

        return salesMap;
    }, [products, orders, dataVersion]);

    // Calculate COGS stats - must be before early returns to maintain hook order
    const cogsStats = useMemo(() => {
        const total = products.length;
        const withCogs = products.filter(p => p.cogs !== null && p.cogs !== undefined).length;
        return { total, withCogs };
    }, [products, dataVersion]);

    // Calculate filtered products - must be before early returns to maintain hook order
    const filteredProducts = useMemo(() => {
        return products.filter(product => {
            const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = statusFilter === 'all' || product.status.toLowerCase() === statusFilter.toLowerCase();
            return matchesSearch && matchesStatus;
        });
    }, [products, searchTerm, statusFilter, dataVersion]);

    const handleSync = async () => {
        if (!shopId || !canSyncShop) return;
        await syncData(account.id, shopId, 'products');
    };

    // Show Product Management View
    if (showManagement) {
        return (
            <ProductManagementView
                account={account}
                shopId={shopId}
                onBack={() => setShowManagement(false)}
                readOnly={!canMutateShop}
            />
        );
    }

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
                    <h2 className="text-2xl font-bold brand-text">Products</h2>
                    <p className="brand-muted">Manage your product inventory</p>
                </div>
                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={() => canMutateShop && setShowManagement(true)}
                        disabled={!canMutateShop}
                        title={!canMutateShop ? 'Read-only for your role' : undefined}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg transition-opacity font-medium disabled:opacity-40 disabled:pointer-events-none"
                        style={{ backgroundColor: 'var(--brand-secondary)', color: 'var(--brand-btn-text)' }}
                    >
                        <Settings size={18} />
                        Product Management
                    </button>
                    <button
                        type="button"
                        onClick={handleSync}
                        disabled={!canSyncShop || cacheMetadata.isSyncing || isLoading}
                        title={!canSyncShop ? 'You do not have access to sync this shop' : undefined}
                        className="flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 brand-card brand-text brand-card-hover"
                    >
                        <RefreshCw size={20} className={cacheMetadata.isSyncing ? "animate-spin" : ""} />
                        <span>{cacheMetadata.isSyncing ? 'Syncing...' : 'Sync Products'}</span>
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 brand-toolbar p-4 rounded-xl">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 brand-muted" size={20} />
                    <input
                        type="text"
                        placeholder="Search products..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full brand-card brand-text brand-input pl-10 pr-4 py-2 rounded-lg focus:outline-none brand-focus-ring"
                    />
                </div>
                <div className="flex gap-4">
                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 brand-muted" size={20} />
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="brand-card brand-text pl-10 pr-8 py-2 rounded-lg focus:outline-none appearance-none cursor-pointer brand-focus-ring"
                        >
                            <option value="all">All Status</option>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                            <option value="frozen">Frozen</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* COGS Progress Alert */}
            {cogsStats.total > 0 && cogsStats.withCogs < cogsStats.total && (
                <div className="brand-state-warning rounded-xl p-4">
                    <div className="flex items-start gap-4">
                        <div className="p-2 rounded-lg brand-card">
                            <AlertTriangle className="w-6 h-6" style={{ color: 'var(--brand-warning-text)' }} />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-semibold mb-1">
                                Products Missing COGS Data
                            </h3>
                            <p className="text-sm mb-3">
                                {cogsStats.total - cogsStats.withCogs} of {cogsStats.total} products are missing Cost of Goods Sold (COGS).
                                Go to <strong className="brand-text">Product Management</strong> to set COGS for accurate profit calculations.
                            </p>
                            <div className="flex items-center gap-4">
                                <div className="flex-1 rounded-full h-2.5 overflow-hidden brand-card">
                                    <div
                                        className="h-full transition-all duration-500"
                                        style={{
                                            width: `${(cogsStats.withCogs / cogsStats.total) * 100}%`,
                                            backgroundColor: 'var(--brand-warning-text)',
                                        }}
                                    />
                                </div>
                                <span className="text-sm font-medium whitespace-nowrap" style={{ color: 'var(--brand-warning-text)' }}>
                                    {cogsStats.withCogs}/{cogsStats.total} Complete
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Success message when all products have COGS */}
            {cogsStats.total > 0 && cogsStats.withCogs === cogsStats.total && (
                <div className="brand-state-success rounded-xl p-3">
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-lg brand-card">
                            <CheckCircle className="w-5 h-5 brand-profit" />
                        </div>
                        <p className="text-sm font-medium brand-profit">
                            ✓ All {cogsStats.total} products have COGS data — Profit calculations are accurate
                        </p>
                    </div>
                </div>
            )}

            {/* Products Grid */}
            {isLoading && products.length === 0 ? (
                <div className="flex justify-center items-center h-64">
                    <div
                        className="animate-spin rounded-full h-12 w-12 border-4 border-t-transparent"
                        style={{ borderColor: 'var(--brand-primary)', borderTopColor: 'transparent' }}
                    ></div>
                </div>
            ) : filteredProducts.length > 0 ? (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {paginatedProducts.map((product) => (
                            <ProductCard
                                key={product.product_id}
                                product={product}
                                salesCount={productSalesMap.get(product.product_id) || 0}
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
                                className="px-4 py-2 brand-card brand-text brand-card-hover rounded-lg disabled:opacity-50 transition-colors"
                            >
                                Previous
                            </button>
                            <span className="brand-muted">
                                Page {currentPage} of {totalPages}
                            </span>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage === totalPages}
                                className="px-4 py-2 brand-card brand-text brand-card-hover rounded-lg disabled:opacity-50 transition-colors"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <div className="text-center py-12 rounded-xl border border-dashed brand-card">
                    <p className="brand-muted text-lg">No products found matching your criteria</p>
                </div>
            )}

            {/* Product Details Modal */}
            {selectedProduct && (
                <ProductDetails
                    product={selectedProduct}
                    accountId={account.id}
                    readOnly={!canMutateShop}
                    onClose={() => setSelectedProduct(null)}
                    onCostsUpdate={(productId, costs) => {
                        // Update the product in local state
                        const updatedProducts = products.map(p => {
                            if (p.product_id === productId) {
                                // If updating a specific SKU
                                if (costs.skuId) {
                                    return {
                                        ...p,
                                        skus: p.skus?.map(sku =>
                                            sku.id === costs.skuId
                                                ? { ...sku, cogs: costs.cogs !== undefined ? costs.cogs : sku.cogs }
                                                : sku
                                        )
                                    };
                                }
                                // If updating the main product
                                return {
                                    ...p,
                                    ...(costs.cogs !== undefined && { cogs: costs.cogs }),
                                    ...(costs.shippingCost !== undefined && { shipping_cost: costs.shippingCost }),
                                    ...(costs.isFbt !== undefined && { is_fbt: costs.isFbt })
                                };
                            }
                            return p;
                        });
                        // Update the store
                        useShopStore.getState().setProducts(updatedProducts);
                        // Update the selected product
                        setSelectedProduct(prev => {
                            if (!prev) return null;

                            // If updating a specific SKU
                            if (costs.skuId) {
                                return {
                                    ...prev,
                                    skus: prev.skus?.map(sku =>
                                        sku.id === costs.skuId
                                            ? { ...sku, cogs: costs.cogs !== undefined ? costs.cogs : sku.cogs }
                                            : sku
                                    )
                                };
                            }

                            // If updating the main product
                            return {
                                ...prev,
                                ...(costs.cogs !== undefined && { cogs: costs.cogs }),
                                ...(costs.shippingCost !== undefined && { shipping_cost: costs.shippingCost }),
                                ...(costs.isFbt !== undefined && { is_fbt: costs.isFbt })
                            };
                        });
                    }}
                />
            )}
        </div>
    );
}
