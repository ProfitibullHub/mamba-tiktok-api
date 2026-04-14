import { useState, useMemo, useEffect } from 'react';
import {
    Search, RefreshCw, Download, Save, X, Check, ChevronDown,
    ChevronUp, Package, DollarSign, TrendingUp, Video, MoreVertical, Trash2,
    BarChart3, AlertTriangle, CheckCircle, Box, Settings, Layers, Edit2, ChevronRight, Calendar
} from 'lucide-react';
import { ProductCostsModal } from '../ProductCostsModal';
import { useShopStore, Product, Order } from '../../store/useShopStore';
import { Account } from '../../lib/supabase';
import { calculateOrderGMV } from '../../utils/gmvCalculations';
import { isCancelledOrRefunded } from '../../utils/orderFinancials';
import { ProductEditModal } from '../ProductEditModal';
import { ProductPerformanceCharts } from '../ProductPerformanceCharts';
import { CalculationTooltip } from '../CalculationTooltip';
import { MAX_HISTORICAL_DAYS, getHistoricalWindowLabel, getHistoricalWindowDescription } from '../../config/dataRetention';

interface ProductManagementViewProps {
    account: Account;
    shopId?: string;
    onBack?: () => void;
    /** When true, no sync, bulk actions, cost edits, or TikTok product mutations. */
    readOnly?: boolean;
}

interface EditingProduct {
    product_id: string;
    cogs: number | null;
    shipping_cost: number | null;
}

export function ProductManagementView({ account, shopId, onBack, readOnly = false }: ProductManagementViewProps) {
    const { products, orders, isLoading, syncData, cacheMetadata, updateProductCosts, activateProducts, deactivateProducts, deleteProducts, dataVersion } = useShopStore();

    useEffect(() => {
        if (!readOnly) return;
        setBulkEditMode(false);
        setSelectedProducts(new Set());
        setEditingProducts(new Map());
        setActiveMenu(null);
        setEditingProduct(null);
        setEditingCostsProduct(null);
    }, [readOnly]);

    // State
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortField, setSortField] = useState<'title' | 'price' | 'sales_count' | 'cogs' | 'inventory'>('sales_count');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
    const [editingProducts, setEditingProducts] = useState<Map<string, EditingProduct>>(new Map());
    const [bulkEditMode, setBulkEditMode] = useState(false);
    const [bulkCogs, setBulkCogs] = useState<string>('');
    const [bulkShipping, setBulkShipping] = useState<string>('');
    const [playingVideo, setPlayingVideo] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [editingCostsProduct, setEditingCostsProduct] = useState<Product | null>(null);
    const [showCharts, setShowCharts] = useState(true);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 25;

    const handleSync = async () => {
        if (!shopId || readOnly) return;
        await syncData(account.id, shopId, 'products');
    };

    // Filter and sort products
    const filteredProducts = useMemo(() => {
        let filtered = products.filter(product => {
            const productTitle = (product as any).title || product.name || '';
            const matchesSearch =
                productTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (product.skus?.[0]?.seller_sku?.toLowerCase()?.includes(searchTerm.toLowerCase()) || false);

            const matchesStatus = statusFilter === 'all' ||
                (product.status || '').toLowerCase() === statusFilter.toLowerCase();

            return matchesSearch && matchesStatus;
        });

        // Sort
        filtered.sort((a, b) => {
            let aVal: any, bVal: any;
            switch (sortField) {
                case 'title':
                    aVal = ((a as any).title || a.name || '').toLowerCase();
                    bVal = ((b as any).title || b.name || '').toLowerCase();
                    break;
                case 'price':
                    aVal = a.price || 0;
                    bVal = b.price || 0;
                    break;
                case 'sales_count':
                    aVal = a.sales_count || 0;
                    bVal = b.sales_count || 0;
                    break;
                case 'cogs':
                    aVal = a.cogs ?? 999999;
                    bVal = b.cogs ?? 999999;
                    break;
                case 'inventory':
                    const aInv = a.skus?.[0]?.inventory?.[0]?.quantity ?? 0;
                    const bInv = b.skus?.[0]?.inventory?.[0]?.quantity ?? 0;
                    aVal = aInv;
                    bVal = bInv;
                    break;
                default:
                    aVal = 0;
                    bVal = 0;
            }
            if (sortOrder === 'asc') return aVal > bVal ? 1 : -1;
            return aVal < bVal ? 1 : -1;
        });

        return filtered;
    }, [products, searchTerm, statusFilter, sortField, sortOrder, dataVersion]);

    // Pagination
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    const paginatedProducts = filteredProducts.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    // Calculate stats - Using Orders as single source of truth (limited to configured historical window)
    const stats = useMemo(() => {
        const totalProducts = products.length;
        const activeProducts = products.filter(p => p.status === 'ACTIVATE' || p.status === 'LIVE').length;
        const productsWithCogs = products.filter(p => p.cogs !== null && p.cogs !== undefined).length;
        const lowStock = products.filter(p => {
            const qty = p.skus?.[0]?.inventory?.[0]?.quantity ?? 0;
            return qty > 0 && qty < 10;
        }).length;
        const outOfStock = products.filter(p => {
            const qty = p.skus?.[0]?.inventory?.[0]?.quantity ?? 0;
            return qty === 0;
        }).length;

        // Calculate historical window start time (from config)
        const historicalStartTime = Date.now() / 1000 - (MAX_HISTORICAL_DAYS * 24 * 60 * 60);

        // Calculate sales and GMV from synced orders (within historical window)
        let totalSales = 0;
        let totalGMV = 0;
        // Per-product GMV lookup from orders
        const productGMV: Record<string, number> = {};
        const productSales: Record<string, number> = {};

        orders.forEach(order => {
            // Only include orders within the configured historical window AND exclude sample orders AND cancelled/refunded orders
            if (order.created_time >= historicalStartTime && order.is_sample_order !== true && !isCancelledOrRefunded(order)) {
                totalGMV += calculateOrderGMV(order);

                order.line_items.forEach(item => {
                    const qty = item.quantity;
                    const gmv = parseFloat(item.sale_price || '0') * qty;
                    totalSales += qty;

                    // Match line item to product for per-product GMV
                    let matchedProductId: string | null = null;

                    // Strategy 1: Match by SKU ID
                    const matchBySku = products.find(p => p.skus?.some(s => s.id === item.id));
                    if (matchBySku) matchedProductId = matchBySku.product_id;

                    // Strategy 2: Match by seller_sku
                    if (!matchedProductId && item.seller_sku) {
                        const matchBySellerSku = products.find(p =>
                            p.skus?.some(s => s.seller_sku === item.seller_sku)
                        );
                        if (matchBySellerSku) matchedProductId = matchBySellerSku.product_id;
                    }

                    // Strategy 3: Match by product name
                    if (!matchedProductId && item.product_name) {
                        const matchByName = products.find(p =>
                            p.name.toLowerCase() === item.product_name.toLowerCase()
                        );
                        if (matchByName) matchedProductId = matchByName.product_id;
                    }

                    if (matchedProductId) {
                        productGMV[matchedProductId] = (productGMV[matchedProductId] || 0) + gmv;
                        productSales[matchedProductId] = (productSales[matchedProductId] || 0) + qty;
                    }
                });
            }
        });

        return { totalProducts, activeProducts, productsWithCogs, lowStock, outOfStock, totalGMV, totalSales, productGMV, productSales };
    }, [products, orders, dataVersion]);

    // Toggle select all
    const toggleSelectAll = () => {
        if (selectedProducts.size === paginatedProducts.length) {
            setSelectedProducts(new Set());
        } else {
            setSelectedProducts(new Set(paginatedProducts.map(p => p.product_id)));
        }
    };

    // Toggle single product selection
    const toggleProductSelection = (productId: string) => {
        const newSelected = new Set(selectedProducts);
        if (newSelected.has(productId)) {
            newSelected.delete(productId);
        } else {
            newSelected.add(productId);
        }
        setSelectedProducts(newSelected);
    };

    // Start editing a product
    const startEditing = (product: Product) => {
        setEditingProducts(new Map(editingProducts).set(product.product_id, {
            product_id: product.product_id,
            cogs: product.cogs ?? null,
            shipping_cost: product.shipping_cost ?? null
        }));
    };

    // Cancel editing
    const cancelEditing = (productId: string) => {
        const newEditing = new Map(editingProducts);
        newEditing.delete(productId);
        setEditingProducts(newEditing);
    };

    // Save single product
    const saveProduct = async (productId: string) => {
        const editing = editingProducts.get(productId);
        if (!editing) return;

        setIsSaving(true);
        try {
            await updateProductCosts(productId, {
                cogs: editing.cogs,
                shipping_cost: editing.shipping_cost,
                accountId: account.id
            });
            cancelEditing(productId);
        } catch (error) {
            console.error('Failed to save product:', error);
        }
        setIsSaving(false);
    };

    // Bulk save
    const saveBulkEdits = async () => {
        if (selectedProducts.size === 0) return;

        setIsSaving(true);
        try {
            const updates: { cogs?: number | null; shipping_cost?: number | null } = {};
            if (bulkCogs !== '') updates.cogs = parseFloat(bulkCogs);
            if (bulkShipping !== '') updates.shipping_cost = parseFloat(bulkShipping);

            if (Object.keys(updates).length > 0) {
                for (const productId of selectedProducts) {
                    await updateProductCosts(productId, { ...updates, accountId: account.id });
                }
            }

            setBulkEditMode(false);
            setBulkCogs('');
            setBulkShipping('');
            setSelectedProducts(new Set());
        } catch (error) {
            console.error('Failed to save bulk edits:', error);
        }
        setIsSaving(false);
    };

    // Export to CSV
    const exportToCSV = () => {
        const headers = ['Product ID', 'Title', 'SKU', 'Price', 'COGS', 'Ship to Customer', 'Sales', 'GMV', 'Inventory', 'Status'];
        const rows = filteredProducts.map(p => [
            p.product_id,
            `"${p.name.replace(/"/g, '""')}"`,
            p.skus?.[0]?.seller_sku || '',
            p.price?.toFixed(2) || '0',
            p.cogs?.toFixed(2) || '',
            p.shipping_cost?.toFixed(2) || '',
            stats.productSales[p.product_id] || 0,
            (stats.productGMV[p.product_id] || 0).toFixed(2),
            p.skus?.[0]?.inventory?.[0]?.quantity ?? 0,
            p.status || 'Unknown'
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `products_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Sort header component
    const SortHeader = ({ field, label }: { field: typeof sortField; label: string }) => (
        <th
            className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase cursor-pointer hover:text-white transition-colors"
            onClick={() => {
                if (sortField === field) {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                } else {
                    setSortField(field);
                    setSortOrder('desc');
                }
            }}
        >
            <div className="flex items-center gap-1">
                {label}
                {sortField === field && (
                    sortOrder === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />
                )}
            </div>
        </th>
    );

    // Format currency
    const formatCurrency = (value: number | null | undefined) => {
        if (value === null || value === undefined) return '—';
        return `$${value.toFixed(2)}`;
    };

    // Format compact number (e.g. 1.2k, 1.5M)
    const formatCompactNumber = (num: number): string => {
        if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
        if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
        return num.toLocaleString();
    };

    // Get profit margin
    const getProfitMargin = (product: Product) => {
        if (!product.price || !product.cogs) return null;
        const profit = product.price - product.cogs - (product.shipping_cost || 0);
        return ((profit / product.price) * 100).toFixed(1);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
                        >
                            <X size={24} />
                        </button>
                    )}
                    <div>
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <Settings className="text-pink-500" />
                            Product Management
                        </h2>
                        <p className="text-gray-400">Manage inventory, costs, and performance</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={exportToCSV}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                    >
                        <Download size={18} />
                        Export CSV
                    </button>
                    <button
                        type="button"
                        onClick={handleSync}
                        disabled={readOnly || cacheMetadata.isSyncing || isLoading}
                        title={readOnly ? 'Read-only for your role' : undefined}
                        className="flex items-center gap-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={18} className={cacheMetadata.isSyncing ? "animate-spin" : ""} />
                        Sync Products
                    </button>
                </div>
            </div>

            {/* COGS Progress Alert */}
            {stats.totalProducts > 0 && stats.productsWithCogs < stats.totalProducts && (
                <div className="bg-gradient-to-r from-orange-500/10 to-amber-500/10 border border-orange-500/30 rounded-xl p-4">
                    <div className="flex items-start gap-4">
                        <div className="p-2 bg-orange-500/20 rounded-lg">
                            <AlertTriangle className="w-6 h-6 text-orange-400" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-orange-300 font-semibold mb-1">
                                Products Missing COGS Data
                            </h3>
                            <p className="text-gray-400 text-sm mb-3">
                                {stats.totalProducts - stats.productsWithCogs} of {stats.totalProducts} products are missing Cost of Goods Sold (COGS).
                                Set COGS for accurate profit calculations.
                            </p>
                            <div className="flex items-center gap-4">
                                <div className="flex-1 bg-gray-800 rounded-full h-2.5 overflow-hidden">
                                    <div
                                        className="bg-gradient-to-r from-orange-500 to-amber-500 h-full transition-all duration-500"
                                        style={{ width: `${(stats.productsWithCogs / stats.totalProducts) * 100}%` }}
                                    />
                                </div>
                                <span className="text-orange-400 text-sm font-medium whitespace-nowrap">
                                    {stats.productsWithCogs}/{stats.totalProducts} Complete
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Success message when all products have COGS */}
            {stats.totalProducts > 0 && stats.productsWithCogs === stats.totalProducts && (
                <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl p-3">
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-green-500/20 rounded-lg">
                            <CheckCircle className="w-5 h-5 text-green-400" />
                        </div>
                        <p className="text-green-400 text-sm font-medium">
                            ✓ All {stats.totalProducts} products have COGS data — Profit calculations are accurate
                        </p>
                    </div>
                </div>
            )}

            {/* Performance Charts Section */}
            <div className="bg-gray-800/30 rounded-xl border border-gray-700 overflow-hidden">
                <button
                    onClick={() => setShowCharts(!showCharts)}
                    className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-pink-500/20 rounded-lg">
                            <BarChart3 className="w-5 h-5 text-pink-400" />
                        </div>
                        <div className="text-left">
                            <h3 className="text-white font-semibold">Product Performance Analytics</h3>
                            <p className="text-gray-400 text-sm">View sales, revenue, and inventory charts</p>
                        </div>
                    </div>
                    <ChevronRight
                        className={`text-gray-400 transition-transform ${showCharts ? 'rotate-90' : ''}`}
                        size={20}
                    />
                </button>

                {showCharts && (
                    <div className="p-4 pt-0">
                        <ProductPerformanceCharts products={products} />
                    </div>
                )}
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                        <Package size={14} />
                        Total Products
                        <CalculationTooltip
                            source="TikTok Shop"
                            calculation="Count(products)"
                            api="GET /products"
                        />
                    </div>
                    <p className="text-2xl font-bold text-white">{stats.totalProducts}</p>
                </div>
                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                        <CheckCircle size={14} className="text-green-400" />
                        Active
                        <CalculationTooltip
                            source="TikTok Shop"
                            calculation="Status = LIVE or ACTIVATE"
                            api="GET /products"
                        />
                    </div>
                    <p className="text-2xl font-bold text-green-400">{stats.activeProducts}</p>
                </div>
                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                        <DollarSign size={14} className="text-blue-400" />
                        COGS Set
                        <CalculationTooltip
                            source="Internal"
                            calculation="Count(cogs != null)"
                            api="GET /products"
                        />
                    </div>
                    <p className="text-2xl font-bold text-blue-400">{stats.productsWithCogs}/{stats.totalProducts}</p>
                </div>
                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                        <AlertTriangle size={14} className="text-yellow-400" />
                        Low Stock
                        <CalculationTooltip
                            source="Product SKUs"
                            calculation="Inventory > 0 and < 10"
                            api="GET /products"
                        />
                    </div>
                    <p className="text-2xl font-bold text-yellow-400">{stats.lowStock}</p>
                </div>
                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                        <Box size={14} className="text-red-400" />
                        Out of Stock
                        <CalculationTooltip
                            source="Product SKUs"
                            calculation="Inventory == 0"
                            api="GET /products"
                        />
                    </div>
                    <p className="text-2xl font-bold text-red-400">{stats.outOfStock}</p>
                </div>
                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                        <TrendingUp size={14} className="text-purple-400" />
                        Sales ({getHistoricalWindowLabel()})
                        <CalculationTooltip
                            source="Synced Orders"
                            calculation={`Sum(order.quantity) within last ${MAX_HISTORICAL_DAYS} days`}
                            api="GET /orders"
                        />
                    </div>
                    <p className="text-2xl font-bold text-purple-400">{stats.totalSales.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Units sold ({getHistoricalWindowDescription()})</p>
                </div>
                <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                        <BarChart3 size={14} className="text-pink-400" />
                        GMV ({getHistoricalWindowLabel()})
                        <CalculationTooltip
                            source="Synced Orders"
                            calculation={`Sum(line_item.sale_price × line_item.quantity) within last ${MAX_HISTORICAL_DAYS} days`}
                            api="GET /orders"
                        />
                    </div>
                    <p className="text-2xl font-bold text-pink-400">${formatCompactNumber(stats.totalGMV)}</p>
                    <p className="text-xs text-gray-500 mt-1">Gross merchandise value ({getHistoricalWindowDescription()})</p>
                </div>
            </div>

            {/* Filters & Bulk Actions */}
            <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                <div className="flex flex-wrap gap-4 items-center">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search products or SKU..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 text-white pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:border-pink-500"
                        />
                    </div>

                    {/* Status Filter */}
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="bg-gray-900 border border-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-pink-500"
                    >
                        <option value="all">All Status</option>
                        <option value="ACTIVATE">Active</option>
                        <option value="LIVE">Live</option>
                        <option value="SELLER_DEACTIVATED">Deactivated</option>
                        <option value="DRAFT">Draft</option>
                    </select>

                    {/* Bulk Edit Toggle */}
                    <button
                        type="button"
                        onClick={() => !readOnly && setBulkEditMode(!bulkEditMode)}
                        disabled={readOnly}
                        title={readOnly ? 'Read-only for your role' : undefined}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${bulkEditMode
                            ? 'bg-pink-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            } disabled:opacity-40 disabled:pointer-events-none`}
                    >
                        <Layers size={18} />
                        Bulk Edit {selectedProducts.size > 0 && `(${selectedProducts.size})`}
                    </button>
                </div>

                {/* Bulk Edit Panel */}
                {bulkEditMode && selectedProducts.size > 0 && (
                    <>
                        <div className="mt-4 pt-4 border-t border-gray-700 flex flex-wrap gap-4 items-end">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Bulk COGS ($)</label>
                                <input
                                    type="number"
                                    value={bulkCogs}
                                    onChange={(e) => setBulkCogs(e.target.value)}
                                    placeholder="Set COGS"
                                    className="bg-gray-900 border border-gray-700 text-white px-3 py-2 rounded-lg w-32 focus:outline-none focus:border-pink-500"
                                    step="0.01"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Ship to Customer ($)</label>
                                <input
                                    type="number"
                                    value={bulkShipping}
                                    onChange={(e) => setBulkShipping(e.target.value)}
                                    placeholder="Set Shipping"
                                    className="bg-gray-900 border border-gray-700 text-white px-3 py-2 rounded-lg w-32 focus:outline-none focus:border-pink-500"
                                    step="0.01"
                                />
                            </div>
                            <button
                                onClick={saveBulkEdits}
                                disabled={isSaving || (bulkCogs === '' && bulkShipping === '')}
                                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                            >
                                <Save size={18} />
                                Apply to {selectedProducts.size} Products
                            </button>
                            <button
                                onClick={() => {
                                    setBulkEditMode(false);
                                    setSelectedProducts(new Set());
                                    setBulkCogs('');
                                    setBulkShipping('');
                                }}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                        </div>

                        <div className="pt-4 border-t border-gray-700 flex flex-wrap gap-4 items-center w-full">
                            <div className="mr-auto">
                                <span className="text-gray-400 text-sm">Valid for {selectedProducts.size} selected products:</span>
                            </div>

                            <button
                                onClick={async () => {
                                    if (!window.confirm(`Activate ${selectedProducts.size} products?`)) return;
                                    setIsSaving(true);
                                    try {
                                        await activateProducts(account.id, Array.from(selectedProducts));
                                        setSelectedProducts(new Set());
                                    } catch (e) {
                                        console.error(e);
                                        alert('Failed to activate products');
                                    }
                                    setIsSaving(false);
                                }}
                                disabled={isSaving}
                                className="flex items-center gap-2 px-3 py-2 bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-600/50 rounded-lg transition-colors"
                            >
                                <CheckCircle size={16} />
                                Activate
                            </button>

                            <button
                                onClick={async () => {
                                    if (!window.confirm(`Deactivate ${selectedProducts.size} products?`)) return;
                                    setIsSaving(true);
                                    try {
                                        await deactivateProducts(account.id, Array.from(selectedProducts));
                                        setSelectedProducts(new Set());
                                    } catch (e) {
                                        console.error(e);
                                        alert('Failed to deactivate products');
                                    }
                                    setIsSaving(false);
                                }}
                                disabled={isSaving}
                                className="flex items-center gap-2 px-3 py-2 bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 border border-yellow-600/50 rounded-lg transition-colors"
                            >
                                <X size={16} />
                                Deactivate
                            </button>

                            <button
                                onClick={async () => {
                                    if (!window.confirm(`DELETE ${selectedProducts.size} products? This cannot be undone.`)) return;
                                    setIsSaving(true);
                                    try {
                                        await deleteProducts(account.id, Array.from(selectedProducts));
                                        setSelectedProducts(new Set());
                                    } catch (e) {
                                        console.error(e);
                                        alert('Failed to delete products');
                                    }
                                    setIsSaving(false);
                                }}
                                disabled={isSaving}
                                className="flex items-center gap-2 px-3 py-2 bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-600/50 rounded-lg transition-colors"
                            >
                                <AlertTriangle size={16} />
                                Delete
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Products Table */}
            <div className="bg-gray-800/30 rounded-xl border border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-900/50">
                            <tr>
                                {bulkEditMode && (
                                    <th className="px-3 py-3 text-left">
                                        <input
                                            type="checkbox"
                                            checked={selectedProducts.size === paginatedProducts.length && paginatedProducts.length > 0}
                                            onChange={toggleSelectAll}
                                            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-pink-500 focus:ring-pink-500"
                                        />
                                    </th>
                                )}
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase">Product</th>
                                <SortHeader field="price" label="Price" />
                                <SortHeader field="cogs" label="COGS" />
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase">Ship to Customer</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase">Margin</th>
                                <SortHeader field="inventory" label="Inventory" />
                                <SortHeader field="sales_count" label="Sales" />
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase">GMV</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {paginatedProducts.map((product) => {
                                const isEditing = editingProducts.has(product.product_id);
                                const editData = editingProducts.get(product.product_id);
                                const inventory = product.skus?.[0]?.inventory?.[0]?.quantity ?? 0;
                                const margin = getProfitMargin(product);
                                const hasVideo = product.details?.video?.url;

                                return (
                                    <tr
                                        key={product.product_id}
                                        className={`hover:bg-gray-700/30 ${selectedProducts.has(product.product_id) ? 'bg-pink-500/10' : ''
                                            }`}
                                    >
                                        {bulkEditMode && (
                                            <td className="px-3 py-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedProducts.has(product.product_id)}
                                                    onChange={() => toggleProductSelection(product.product_id)}
                                                    className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-pink-500 focus:ring-pink-500"
                                                />
                                            </td>
                                        )}
                                        <td className="px-3 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="relative">
                                                    <img
                                                        src={product.main_image_url || product.images?.[0] || '/placeholder.png'}
                                                        alt={product.name}
                                                        className="w-12 h-12 rounded-lg object-cover border border-gray-600"
                                                    />
                                                    {hasVideo && (
                                                        <button
                                                            onClick={() => setPlayingVideo(playingVideo === product.product_id ? null : product.product_id)}
                                                            className="absolute -bottom-1 -right-1 w-5 h-5 bg-pink-500 rounded-full flex items-center justify-center"
                                                        >
                                                            <Video size={10} className="text-white" />
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-white truncate max-w-[200px]">
                                                        {product.name || 'Untitled Product'}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        SKU: {product.skus?.[0]?.seller_sku || 'N/A'}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-3 text-sm text-white">
                                            {formatCurrency(product.price)}
                                        </td>
                                        <td className="px-3 py-3">
                                            {isEditing ? (
                                                <div className="flex items-center gap-1">
                                                    <input
                                                        type="number"
                                                        value={editData?.cogs ?? ''}
                                                        onChange={(e) => {
                                                            const val = e.target.value === '' ? null : parseFloat(e.target.value);
                                                            setEditingProducts(new Map(editingProducts).set(product.product_id, {
                                                                ...editData!,
                                                                cogs: val
                                                            }));
                                                        }}
                                                        className="w-20 bg-gray-900 border border-pink-500 text-white px-2 py-1 rounded text-sm"
                                                        step="0.01"
                                                        placeholder="0.00"
                                                    />
                                                    <button
                                                        onClick={() => setEditingCostsProduct(product)}
                                                        className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
                                                        title="Advanced options (Backdate)"
                                                    >
                                                        <Calendar size={14} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <span className={`text-sm ${product.cogs ? 'text-white' : 'text-gray-500'}`}>
                                                    {formatCurrency(product.cogs)}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-3">
                                            <div className="flex flex-col gap-1">
                                                {/* Fulfillment Type Badge */}
                                                {product.is_fbt ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-pink-500/20 text-pink-400 border border-pink-500/30 w-fit">
                                                        FBT
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 w-fit">
                                                        Self
                                                    </span>
                                                )}
                                                {/* Shipping Cost - Editable */}
                                                {isEditing ? (
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="number"
                                                            value={editData?.shipping_cost ?? ''}
                                                            onChange={(e) => {
                                                                const val = e.target.value === '' ? null : parseFloat(e.target.value);
                                                                setEditingProducts(new Map(editingProducts).set(product.product_id, {
                                                                    ...editData!,
                                                                    shipping_cost: val
                                                                }));
                                                            }}
                                                            className="w-20 bg-gray-900 border border-pink-500 text-white px-2 py-1 rounded text-sm"
                                                            step="0.01"
                                                            placeholder="0.00"
                                                            title="Cost to ship to customer"
                                                        />
                                                        <button
                                                            onClick={() => setEditingCostsProduct(product)}
                                                            className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
                                                            title="Advanced options (Backdate)"
                                                        >
                                                            <Calendar size={14} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className={`text-sm ${product.shipping_cost ? 'text-white' : 'text-gray-500'}`}>
                                                        {formatCurrency(product.shipping_cost)}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-3">
                                            {margin ? (
                                                <span className={`text-sm font-medium ${parseFloat(margin) > 30 ? 'text-green-400' :
                                                    parseFloat(margin) > 15 ? 'text-yellow-400' : 'text-red-400'
                                                    }`}>
                                                    {margin}%
                                                </span>
                                            ) : (
                                                <span className="text-sm text-gray-500">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className={`text-sm font-medium ${inventory === 0 ? 'text-red-400' :
                                                inventory < 10 ? 'text-yellow-400' : 'text-green-400'
                                                }`}>
                                                {inventory}
                                            </span>
                                        </td>
                                        <td className="px-3 py-3 text-sm text-white">
                                            {(stats.productSales[product.product_id] || 0).toLocaleString()}
                                        </td>
                                        <td className="px-3 py-3 text-sm text-white">
                                            ${(stats.productGMV[product.product_id] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${product.status === 'ACTIVATE' || product.status === 'LIVE'
                                                ? 'bg-green-500/20 text-green-400'
                                                : product.status === 'SELLER_DEACTIVATED'
                                                    ? 'bg-gray-500/20 text-gray-400'
                                                    : 'bg-yellow-500/20 text-yellow-400'
                                                }`}>
                                                {product.status?.replace(/_/g, ' ') || 'Unknown'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-3">
                                            {readOnly ? (
                                                <span className="text-xs text-gray-600">—</span>
                                            ) : isEditing ? (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => saveProduct(product.product_id)}
                                                        disabled={isSaving}
                                                        className="p-1 bg-green-600 hover:bg-green-700 rounded text-white"
                                                    >
                                                        <Check size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => cancelEditing(product.product_id)}
                                                        className="p-1 bg-gray-600 hover:bg-gray-500 rounded text-white"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="relative">
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveMenu(activeMenu === product.product_id ? null : product.product_id)}
                                                        className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                                                    >
                                                        <MoreVertical size={16} />
                                                    </button>

                                                    {activeMenu === product.product_id && (
                                                        <div className="absolute right-0 mt-2 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-10 overflow-hidden">
                                                            <button
                                                                onClick={() => {
                                                                    setEditingProduct(product);
                                                                    setActiveMenu(null);
                                                                }}
                                                                className="w-full text-left px-4 py-2 hover:bg-gray-800 text-sm text-gray-300 hover:text-white flex items-center gap-2"
                                                            >
                                                                <Edit2 size={14} className="text-pink-500" />
                                                                Edit Product
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    startEditing(product);
                                                                    setActiveMenu(null);
                                                                }}
                                                                className="w-full text-left px-4 py-2 hover:bg-gray-800 text-sm text-gray-300 hover:text-white flex items-center gap-2"
                                                            >
                                                                <DollarSign size={14} className="text-green-500" />
                                                                Edit Costs
                                                            </button>

                                                            {product.status !== 'ACTIVATE' && product.status !== 'LIVE' && (
                                                                <button
                                                                    onClick={async () => {
                                                                        if (!window.confirm('Activate this product?')) return;
                                                                        setIsSaving(true);
                                                                        try {
                                                                            await activateProducts(account.id, [product.product_id]);
                                                                            setActiveMenu(null);
                                                                        } catch (e) {
                                                                            console.error(e);
                                                                        }
                                                                        setIsSaving(false);
                                                                    }}
                                                                    className="w-full text-left px-4 py-2 hover:bg-gray-800 text-sm text-gray-300 hover:text-white flex items-center gap-2"
                                                                >
                                                                    <CheckCircle size={14} className="text-green-500" />
                                                                    Activate
                                                                </button>
                                                            )}

                                                            {(product.status === 'ACTIVATE' || product.status === 'LIVE') && (
                                                                <button
                                                                    onClick={async () => {
                                                                        if (!window.confirm('Deactivate this product?')) return;
                                                                        setIsSaving(true);
                                                                        try {
                                                                            await deactivateProducts(account.id, [product.product_id]);
                                                                            setActiveMenu(null);
                                                                        } catch (e) {
                                                                            console.error(e);
                                                                        }
                                                                        setIsSaving(false);
                                                                    }}
                                                                    className="w-full text-left px-4 py-2 hover:bg-gray-800 text-sm text-gray-300 hover:text-white flex items-center gap-2"
                                                                >
                                                                    <X size={14} className="text-yellow-500" />
                                                                    Deactivate
                                                                </button>
                                                            )}

                                                            <div className="border-t border-gray-700 my-1"></div>

                                                            <button
                                                                onClick={async () => {
                                                                    if (!window.confirm('Delete this product?')) return;
                                                                    setIsSaving(true);
                                                                    try {
                                                                        await deleteProducts(account.id, [product.product_id]);
                                                                        setActiveMenu(null);
                                                                    } catch (e) {
                                                                        console.error(e);
                                                                    }
                                                                    setIsSaving(false);
                                                                }}
                                                                className="w-full text-left px-4 py-2 hover:bg-red-900/20 text-sm text-red-400 hover:text-red-300 flex items-center gap-2"
                                                            >
                                                                <Trash2 size={14} />
                                                                Delete
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex justify-between items-center px-4 py-3 border-t border-gray-700">
                        <p className="text-sm text-gray-400">
                            Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredProducts.length)} of {filteredProducts.length} products
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1 bg-gray-800 text-white rounded disabled:opacity-50 hover:bg-gray-700 transition-colors"
                            >
                                Previous
                            </button>
                            <span className="px-3 py-1 text-gray-400">
                                {currentPage} / {totalPages}
                            </span>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage === totalPages}
                                className="px-3 py-1 bg-gray-800 text-white rounded disabled:opacity-50 hover:bg-gray-700 transition-colors"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Video Modal */}
            {playingVideo && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 rounded-2xl max-w-3xl w-full border border-gray-800">
                        <div className="flex justify-between items-center p-4 border-b border-gray-800">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Video className="text-pink-500" />
                                Product Video
                            </h3>
                            <button
                                onClick={() => setPlayingVideo(null)}
                                className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-4">
                            {(() => {
                                const product = products.find(p => p.product_id === playingVideo);
                                const videoUrl = product?.details?.video?.url;
                                if (!videoUrl) {
                                    return <p className="text-gray-400 text-center py-8">No video available</p>;
                                }
                                return (
                                    <video
                                        src={videoUrl}
                                        controls
                                        autoPlay
                                        className="w-full rounded-lg"
                                        style={{ maxHeight: '60vh' }}
                                    >
                                        Your browser does not support the video tag.
                                    </video>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {/* Empty State */}
            {filteredProducts.length === 0 && !isLoading && (
                <div className="text-center py-12 bg-gray-800/30 rounded-xl border border-gray-700 border-dashed">
                    <Package size={48} className="mx-auto text-gray-500 mb-4" />
                    <p className="text-gray-400 text-lg">No products found</p>
                    <p className="text-gray-500 text-sm">Try adjusting your search or filters</p>
                </div>
            )}

            {/* Product Edit Modal */}
            {!readOnly && editingProduct && (
                <ProductEditModal
                    product={editingProduct}
                    accountId={account.id}
                    onClose={() => setEditingProduct(null)}
                    onSave={() => {
                        setEditingProduct(null);
                        // Optionally trigger a refresh here
                    }}
                />
            )}

            {/* Product Costs Modal (Backdating) */}
            {!readOnly && editingCostsProduct && (
                <ProductCostsModal
                    product={editingCostsProduct}
                    accountId={account.id}
                    onClose={() => setEditingCostsProduct(null)}
                />
            )}
        </div>
    );
}
