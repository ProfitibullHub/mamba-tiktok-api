import { useState, useMemo, useCallback, useEffect } from 'react';
import { X, Package, BarChart2, Layers, Calendar, DollarSign, Check, Edit2, Loader2, Truck, Settings } from 'lucide-react';
import { Product } from '../store/useShopStore';
import { ProductEditModal } from './ProductEditModal';
import { CalculationTooltip } from './CalculationTooltip';
import { apiFetch } from '../lib/apiClient';

interface ProductDetailsProps {
    product: Product;
    accountId: string;
    onClose: () => void;
    onCostsUpdate?: (productId: string, costs: { cogs?: number | null; shippingCost?: number | null; isFbt?: boolean; skuId?: string }) => void;
    readOnly?: boolean;
}

type ApplyFromOption = 'today' | 'specific_date';

export function ProductDetails({ product, accountId, onClose, onCostsUpdate, readOnly = false }: ProductDetailsProps) {
    const [showFullDescription, setShowFullDescription] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);

    // COGS state
    const [isEditingCogs, setIsEditingCogs] = useState(false);
    const [cogsValue, setCogsValue] = useState<string>(product.cogs?.toString() || '');
    const [isSavingCogs, setIsSavingCogs] = useState(false);
    const [cogsError, setCogsError] = useState<string | null>(null);
    const [cogsApplyFrom, setCogsApplyFrom] = useState<ApplyFromOption>('today');
    const [cogsEffectiveDate, setCogsEffectiveDate] = useState<string>(new Date().toISOString().split('T')[0]);

    // Shipping cost state
    const [isEditingShipping, setIsEditingShipping] = useState(false);
    const [shippingValue, setShippingValue] = useState<string>(product.shipping_cost?.toString() || '');
    const [isSavingShipping, setIsSavingShipping] = useState(false);
    const [shippingError, setShippingError] = useState<string | null>(null);
    const [shippingApplyFrom, setShippingApplyFrom] = useState<ApplyFromOption>('today');
    const [shippingEffectiveDate, setShippingEffectiveDate] = useState<string>(new Date().toISOString().split('T')[0]);

    // Fulfillment type state
    const [fulfillmentType, setFulfillmentType] = useState<'fbt' | 'self'>(product.is_fbt ? 'fbt' : 'self');
    const [isSavingFulfillment, setIsSavingFulfillment] = useState(false);

    // SKU-level COGS state
    const [editingSkuId, setEditingSkuId] = useState<string | null>(null);
    const [skuCogsValues, setSkuCogsValues] = useState<Record<string, string>>(() => {
        const initial: Record<string, string> = {};
        product.skus?.forEach(sku => {
            initial[sku.id] = sku.cogs?.toString() || '';
        });
        return initial;
    });
    const [isSavingSkuCogs, setIsSavingSkuCogs] = useState(false);
    const [skuCogsError, setSkuCogsError] = useState<string | null>(null);

    // SKU-level Shipping state
    const [editingSkuShippingId, setEditingSkuShippingId] = useState<string | null>(null);

    useEffect(() => {
        if (!readOnly) return;
        setShowEditModal(false);
        setIsEditingCogs(false);
        setIsEditingShipping(false);
        setEditingSkuId(null);
        setEditingSkuShippingId(null);
    }, [readOnly]);
    const [skuShippingValues, setSkuShippingValues] = useState<Record<string, string>>(() => {
        const initial: Record<string, string> = {};
        product.skus?.forEach(sku => {
            initial[sku.id] = sku.shipping_cost?.toString() || '';
        });
        return initial;
    });
    const [isSavingSkuShipping, setIsSavingSkuShipping] = useState(false);
    const [skuShippingError, setSkuShippingError] = useState<string | null>(null);

    // Memoize expensive calculations
    const { description, shortDescription, needsReadMore } = useMemo(() => {
        const desc = product.details?.description || '';
        const stripped = desc.replace(/<[^>]*>/g, '');
        return {
            description: desc,
            shortDescription: stripped.slice(0, 150),
            needsReadMore: stripped.length > 150
        };
    }, [product.details?.description]);

    // Memoize created date formatting
    const createdDate = useMemo(() => {
        return product.details?.create_time
            ? new Date(product.details.create_time * 1000).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })
            : null;
    }, [product.details?.create_time]);

    // Memoize stock calculation
    const displayStock = useMemo(() => {
        const skus = product.skus || [];
        const totalStock = skus.reduce((sum, sku) => {
            const skuStock = sku.inventory?.reduce((s, inv) => s + inv.quantity, 0) || 0;
            return sum + skuStock;
        }, 0);
        return totalStock > 0 ? totalStock : product.stock_quantity;
    }, [product.skus, product.stock_quantity]);

    // Memoized COGS save handler
    const handleSaveCogs = useCallback(async () => {
        setCogsError(null);
        const numValue = cogsValue.trim() === '' ? null : parseFloat(cogsValue);

        if (numValue !== null && (isNaN(numValue) || numValue < 0)) {
            setCogsError('Please enter a valid non-negative number');
            return;
        }

        setIsSavingCogs(true);
        try {
            const response = await apiFetch(`/api/tiktok-shop/products/${product.product_id}/costs`, {
                method: 'PATCH',
                body: JSON.stringify({
                    accountId,
                    cogs: numValue,
                    applyFrom: cogsApplyFrom,
                    effectiveDate: cogsApplyFrom === 'specific_date' ? cogsEffectiveDate : undefined
                })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to update COGS');
            }

            setIsEditingCogs(false);
            onCostsUpdate?.(product.product_id, { cogs: numValue });
        } catch (error: any) {
            setCogsError(error.message);
        } finally {
            setIsSavingCogs(false);
        }
    }, [cogsValue, cogsApplyFrom, cogsEffectiveDate, product.product_id, accountId, onCostsUpdate]);

    // Memoized Shipping cost save handler
    const handleSaveShipping = useCallback(async () => {
        setShippingError(null);
        const numValue = shippingValue.trim() === '' ? null : parseFloat(shippingValue);

        if (numValue !== null && (isNaN(numValue) || numValue < 0)) {
            setShippingError('Please enter a valid non-negative number');
            return;
        }

        setIsSavingShipping(true);
        try {
            const response = await apiFetch(`/api/tiktok-shop/products/${product.product_id}/costs`, {
                method: 'PATCH',
                body: JSON.stringify({
                    accountId,
                    shipping_cost: numValue,
                    applyFrom: shippingApplyFrom,
                    effectiveDate: shippingApplyFrom === 'specific_date' ? shippingEffectiveDate : undefined
                })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to update shipping cost');
            }

            setIsEditingShipping(false);
            onCostsUpdate?.(product.product_id, { shippingCost: numValue });
        } catch (error: any) {
            setShippingError(error.message);
        } finally {
            setIsSavingShipping(false);
        }
    }, [shippingValue, shippingApplyFrom, shippingEffectiveDate, product.product_id, accountId, onCostsUpdate]);

    // Handle SKU COGS save
    const handleSaveSkuCogs = useCallback(async (skuId: string) => {
        setSkuCogsError(null);
        const value = skuCogsValues[skuId];
        const numValue = value.trim() === '' ? null : parseFloat(value);

        if (numValue !== null && (isNaN(numValue) || numValue < 0)) {
            setSkuCogsError('Please enter a valid non-negative number');
            return;
        }

        setIsSavingSkuCogs(true);
        try {
            const response = await apiFetch(`/api/tiktok-shop/products/${product.product_id}/sku-costs`, {
                method: 'PATCH',
                body: JSON.stringify({
                    accountId,
                    skuId,
                    cogs: numValue
                })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to update SKU COGS');
            }

            setEditingSkuId(null);
            onCostsUpdate?.(product.product_id, { cogs: numValue, skuId });
        } catch (error: any) {
            setSkuCogsError(error.message);
        } finally {
            setIsSavingSkuCogs(false);
        }
    }, [skuCogsValues, product.product_id, accountId]);

    // Handle SKU Shipping save
    const handleSaveSkuShipping = useCallback(async (skuId: string) => {
        setSkuShippingError(null);
        const value = skuShippingValues[skuId];
        const numValue = value.trim() === '' ? null : parseFloat(value);

        if (numValue !== null && (isNaN(numValue) || numValue < 0)) {
            setSkuShippingError('Please enter a valid non-negative number');
            return;
        }

        setIsSavingSkuShipping(true);
        try {
            const response = await apiFetch(`/api/tiktok-shop/products/${product.product_id}/sku-costs`, {
                method: 'PATCH',
                body: JSON.stringify({
                    accountId,
                    skuId,
                    shipping_cost: numValue
                })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to update SKU shipping cost');
            }

            setEditingSkuShippingId(null);
            onCostsUpdate?.(product.product_id, { shippingCost: numValue, skuId });
        } catch (error: any) {
            setSkuShippingError(error.message);
        } finally {
            setIsSavingSkuShipping(false);
        }
    }, [skuShippingValues, product.product_id, accountId]);

    // Handle fulfillment type change
    const handleFulfillmentChange = useCallback(async (type: 'fbt' | 'self') => {
        if (readOnly) return;
        setFulfillmentType(type);
        setIsSavingFulfillment(true);

        try {
            const response = await apiFetch(`/api/tiktok-shop/products/${product.product_id}/costs`, {
                method: 'PATCH',
                body: JSON.stringify({
                    accountId,
                    is_fbt: type === 'fbt',
                    ...(type === 'fbt' ? { shipping_cost: null } : {}),
                })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to update fulfillment type');
            }

            onCostsUpdate?.(product.product_id, {
                isFbt: type === 'fbt',
                ...(type === 'fbt' ? { shippingCost: null } : {})
            });

            // Reset shipping value if switching to FBT
            if (type === 'fbt') {
                setShippingValue('');
            }
        } catch (error: any) {
            console.error('Failed to update fulfillment type:', error);
            // Revert on error
            setFulfillmentType(type === 'fbt' ? 'self' : 'fbt');
        } finally {
            setIsSavingFulfillment(false);
        }
    }, [product.product_id, accountId, onCostsUpdate, readOnly]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-gray-800 shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-800 p-6 flex justify-between items-center z-10">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Product Details</h2>
                        <p className="text-gray-400 text-sm">ID: {product.product_id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {!readOnly && (
                        <button
                            type="button"
                            onClick={() => setShowEditModal(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors"
                        >
                            <Settings size={18} />
                            Edit Product
                        </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>

                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Left Column: Image */}
                    <div>
                        <div className="aspect-square rounded-xl overflow-hidden bg-gray-800 border border-gray-700 mb-4">
                            {product.main_image_url ? (
                                <img
                                    src={product.main_image_url}
                                    alt={product.name}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <Package size={64} className="text-gray-600" />
                                </div>
                            )}
                        </div>
                        {/* Additional images could go here in a carousel/grid */}
                    </div>

                    {/* Right Column: Details */}
                    <div className="space-y-6">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium 
                                    ${product.status === 'active' ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                                    {product.status.toUpperCase()}
                                </span>
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-4">{product.name}</h1>
                            <div className="flex items-baseline gap-2">
                                <span className="text-3xl font-bold text-pink-500">{product.currency} {product.price}</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                                <div className="flex items-center gap-2 text-gray-400 mb-1">
                                    <Package size={16} />
                                    <span>Stock</span>
                                    <CalculationTooltip
                                        source="Product SKUs"
                                        calculation="Sum(sku.inventory.quantity)"
                                        api="GET /products"
                                    />
                                </div>
                                <p className="text-2xl font-bold text-white">{displayStock}</p>
                            </div>
                            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                                <div className="flex items-center gap-2 text-gray-400 mb-1">
                                    <BarChart2 size={16} />
                                    <span>Sales</span>
                                    <CalculationTooltip
                                        source="TikTok Shop"
                                        calculation="sales_count field"
                                        api="GET /products"
                                    />
                                </div>
                                <p className="text-2xl font-bold text-white">{product.sales_count}</p>
                            </div>
                        </div>

                        {/* Performance Metrics */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <BarChart2 className="text-pink-500" size={20} />
                                Performance (Last 30 Days)
                            </h3>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-gray-800 p-3 rounded-xl border border-gray-700">
                                    <div className="flex items-center gap-1 mb-1">
                                        <p className="text-gray-400 text-xs">GMV</p>
                                        <CalculationTooltip
                                            source="TikTok Shop"
                                            calculation="Gross Merchandise Value"
                                            api="GET /products"
                                        />
                                    </div>
                                    <p className="text-lg font-bold text-white">
                                        {product.currency} {product.gmv?.toFixed(2) || '0.00'}
                                    </p>
                                </div>
                                <div className="bg-gray-800 p-3 rounded-xl border border-gray-700">
                                    <div className="flex items-center gap-1 mb-1">
                                        <p className="text-gray-400 text-xs">Orders</p>
                                        <CalculationTooltip
                                            source="TikTok Shop"
                                            calculation="orders_count field"
                                            api="GET /products"
                                        />
                                    </div>
                                    <p className="text-lg font-bold text-white">{product.orders_count || 0}</p>
                                </div>
                                <div className="bg-gray-800 p-3 rounded-xl border border-gray-700">
                                    <div className="flex items-center gap-1 mb-1">
                                        <p className="text-gray-400 text-xs">CTR</p>
                                        <CalculationTooltip
                                            source="TikTok Shop"
                                            calculation="Click Through Rate"
                                            api="GET /products"
                                        />
                                    </div>
                                    <p className="text-lg font-bold text-white">
                                        {((product.click_through_rate || 0) * 100).toFixed(2)}%
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* COGS (Cost of Goods Sold) - Editable with Backdating */}
                        <div className="space-y-3">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <DollarSign className="text-orange-500" size={20} />
                                Cost of Goods Sold (COGS)
                            </h3>
                            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                                {readOnly ? (
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-2xl font-bold text-white">
                                                {product.cogs !== null && product.cogs !== undefined
                                                    ? `${product.currency} ${product.cogs.toFixed(2)}`
                                                    : <span className="text-gray-500 text-lg">Not set</span>
                                                }
                                            </p>
                                            {product.cogs !== null && product.cogs !== undefined && product.price > 0 && (
                                                <p className="text-sm text-gray-400 mt-1 flex items-center gap-1">
                                                    Margin: {((1 - product.cogs / product.price) * 100).toFixed(1)}%
                                                    <CalculationTooltip
                                                        source="Calculated"
                                                        calculation="(1 - COGS / Price) * 100"
                                                        api="Calculated"
                                                    />
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ) : isEditingCogs ? (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-400">{product.currency}</span>
                                            <input
                                                type="number"
                                                value={cogsValue}
                                                onChange={(e) => setCogsValue(e.target.value)}
                                                placeholder="Enter cost per unit"
                                                min="0"
                                                step="0.01"
                                                className="flex-1 bg-gray-900 border border-gray-600 text-white px-3 py-2 rounded-lg focus:outline-none focus:border-orange-500"
                                                autoFocus
                                            />
                                        </div>

                                        {/* Backdating Options */}
                                        <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
                                            <p className="text-sm text-gray-400 mb-2">Apply this cost from:</p>
                                            <div className="flex flex-col gap-2">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="cogsApplyFrom"
                                                        checked={cogsApplyFrom === 'today'}
                                                        onChange={() => setCogsApplyFrom('today')}
                                                        className="text-orange-500"
                                                    />
                                                    <span className="text-white text-sm">Today (apply going forward)</span>
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="cogsApplyFrom"
                                                        checked={cogsApplyFrom === 'specific_date'}
                                                        onChange={() => setCogsApplyFrom('specific_date')}
                                                        className="text-orange-500"
                                                    />
                                                    <span className="text-white text-sm">Specific date (backdate)</span>
                                                </label>
                                                {cogsApplyFrom === 'specific_date' && (
                                                    <input
                                                        type="date"
                                                        value={cogsEffectiveDate}
                                                        onChange={(e) => setCogsEffectiveDate(e.target.value)}
                                                        className="mt-2 bg-gray-800 border border-gray-600 text-white px-3 py-2 rounded-lg focus:outline-none focus:border-orange-500"
                                                    />
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div>
                                                {cogsError && (
                                                    <p className="text-red-400 text-sm">{cogsError}</p>
                                                )}
                                                <p className="text-xs text-gray-500">
                                                    Cost per unit (manufacturing, sourcing, etc.)
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={handleSaveCogs}
                                                    disabled={isSavingCogs}
                                                    className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                                                >
                                                    {isSavingCogs ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                                    Save
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setIsEditingCogs(false);
                                                        setCogsValue(product.cogs?.toString() || '');
                                                        setCogsError(null);
                                                        setCogsApplyFrom('today');
                                                    }}
                                                    disabled={isSavingCogs}
                                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-2xl font-bold text-white">
                                                {product.cogs !== null && product.cogs !== undefined
                                                    ? `${product.currency} ${product.cogs.toFixed(2)}`
                                                    : <span className="text-gray-500 text-lg">Not set</span>
                                                }
                                            </p>
                                            {product.cogs !== null && product.cogs !== undefined && product.price > 0 && (
                                                <p className="text-sm text-gray-400 mt-1 flex items-center gap-1">
                                                    Margin: {((1 - product.cogs / product.price) * 100).toFixed(1)}%
                                                    <CalculationTooltip
                                                        source="Calculated"
                                                        calculation="(1 - COGS / Price) * 100"
                                                        api="Calculated"
                                                    />
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setIsEditingCogs(true)}
                                            className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors flex items-center gap-2"
                                        >
                                            <Edit2 size={16} />
                                            <span className="text-sm">Edit</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Shipping to Customer - Fulfillment Options */}
                        <div className="space-y-3">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Truck className="text-blue-500" size={20} />
                                Shipping to Customer
                            </h3>
                            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-4">
                                {/* Fulfillment Type Selector */}
                                <div className="space-y-2">
                                    <p className="text-sm text-gray-400">Fulfillment Method</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => handleFulfillmentChange('fbt')}
                                            disabled={readOnly || isSavingFulfillment}
                                            className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${fulfillmentType === 'fbt'
                                                ? 'border-pink-500 bg-pink-500/10'
                                                : 'border-gray-600 hover:border-gray-500 bg-gray-900'
                                                } ${readOnly ? 'opacity-80 cursor-default' : ''}`}
                                        >
                                            <span className={`text-sm font-medium ${fulfillmentType === 'fbt' ? 'text-pink-400' : 'text-white'}`}>
                                                FBT
                                            </span>
                                            <span className="text-xs text-gray-400">Fulfilled by TikTok</span>
                                            {fulfillmentType === 'fbt' && (
                                                <Check size={14} className="text-pink-400 mt-1" />
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleFulfillmentChange('self')}
                                            disabled={readOnly || isSavingFulfillment}
                                            className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${fulfillmentType === 'self'
                                                ? 'border-blue-500 bg-blue-500/10'
                                                : 'border-gray-600 hover:border-gray-500 bg-gray-900'
                                                } ${readOnly ? 'opacity-80 cursor-default' : ''}`}
                                        >
                                            <span className={`text-sm font-medium ${fulfillmentType === 'self' ? 'text-blue-400' : 'text-white'}`}>
                                                Self-Fulfilled
                                            </span>
                                            <span className="text-xs text-gray-400">You ship to customer</span>
                                            {fulfillmentType === 'self' && (
                                                <Check size={14} className="text-blue-400 mt-1" />
                                            )}
                                        </button>
                                    </div>
                                    {isSavingFulfillment && (
                                        <div className="flex items-center gap-2 text-gray-400 text-sm">
                                            <Loader2 size={14} className="animate-spin" />
                                            Updating...
                                        </div>
                                    )}
                                </div>

                                {/* FBT Info or Self-Fulfilled Cost Entry */}
                                {fulfillmentType === 'fbt' ? (
                                    <div className="bg-pink-500/10 border border-pink-500/30 rounded-lg p-3">
                                        <p className="text-pink-300 text-sm">
                                            Shipping handled by TikTok. Fulfillment fees are automatically deducted from settlements.
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        {readOnly ? (
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-2xl font-bold text-white">
                                                        {product.shipping_cost !== null && product.shipping_cost !== undefined
                                                            ? `${product.currency} ${product.shipping_cost.toFixed(2)}`
                                                            : <span className="text-gray-500 text-lg">Not set</span>
                                                        }
                                                    </p>
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Per unit cost to ship to customer
                                                    </p>
                                                </div>
                                            </div>
                                        ) : isEditingShipping ? (
                                            <div className="space-y-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-400">{product.currency}</span>
                                                    <input
                                                        type="number"
                                                        value={shippingValue}
                                                        onChange={(e) => setShippingValue(e.target.value)}
                                                        placeholder="Enter shipping cost per unit"
                                                        min="0"
                                                        step="0.01"
                                                        className="flex-1 bg-gray-900 border border-gray-600 text-white px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500"
                                                        autoFocus
                                                    />
                                                </div>

                                                {/* Backdating Options */}
                                                <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
                                                    <p className="text-sm text-gray-400 mb-2">Apply this cost from:</p>
                                                    <div className="flex flex-col gap-2">
                                                        <label className="flex items-center gap-2 cursor-pointer">
                                                            <input
                                                                type="radio"
                                                                name="shippingApplyFrom"
                                                                checked={shippingApplyFrom === 'today'}
                                                                onChange={() => setShippingApplyFrom('today')}
                                                                className="text-blue-500"
                                                            />
                                                            <span className="text-white text-sm">Today (apply going forward)</span>
                                                        </label>
                                                        <label className="flex items-center gap-2 cursor-pointer">
                                                            <input
                                                                type="radio"
                                                                name="shippingApplyFrom"
                                                                checked={shippingApplyFrom === 'specific_date'}
                                                                onChange={() => setShippingApplyFrom('specific_date')}
                                                                className="text-blue-500"
                                                            />
                                                            <span className="text-white text-sm">Specific date (backdate)</span>
                                                        </label>
                                                        {shippingApplyFrom === 'specific_date' && (
                                                            <input
                                                                type="date"
                                                                value={shippingEffectiveDate}
                                                                onChange={(e) => setShippingEffectiveDate(e.target.value)}
                                                                className="mt-2 bg-gray-800 border border-gray-600 text-white px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500"
                                                            />
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        {shippingError && (
                                                            <p className="text-red-400 text-sm">{shippingError}</p>
                                                        )}
                                                        <p className="text-xs text-gray-500">
                                                            Cost to ship product to customer (per unit)
                                                        </p>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={handleSaveShipping}
                                                            disabled={isSavingShipping}
                                                            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                                                        >
                                                            {isSavingShipping ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                                            Save
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setIsEditingShipping(false);
                                                                setShippingValue(product.shipping_cost?.toString() || '');
                                                                setShippingError(null);
                                                                setShippingApplyFrom('today');
                                                            }}
                                                            disabled={isSavingShipping}
                                                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-2xl font-bold text-white">
                                                        {product.shipping_cost !== null && product.shipping_cost !== undefined
                                                            ? `${product.currency} ${product.shipping_cost.toFixed(2)}`
                                                            : <span className="text-gray-500 text-lg">Not set</span>
                                                        }
                                                    </p>
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Per unit cost to ship to customer
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => setIsEditingShipping(true)}
                                                    className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors flex items-center gap-2"
                                                >
                                                    <Edit2 size={16} />
                                                    <span className="text-sm">Edit</span>
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Description */}
                        {description && (
                            <div className="space-y-3">
                                <h3 className="text-lg font-semibold text-white">Description</h3>
                                <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                                    <div
                                        className="text-gray-300 text-sm leading-relaxed"
                                        dangerouslySetInnerHTML={{
                                            __html: showFullDescription ? description : `${shortDescription}${needsReadMore ? '...' : ''}`
                                        }}
                                    />
                                    {needsReadMore && (
                                        <button
                                            onClick={() => setShowFullDescription(!showFullDescription)}
                                            className="mt-3 text-pink-500 hover:text-pink-400 text-sm font-medium transition-colors"
                                        >
                                            {showFullDescription ? 'Show Less' : 'Read More'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* SKU Variants */}
                        {product.skus && product.skus.length > 0 && (
                            <div className="space-y-3">
                                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <Layers className="text-purple-500" size={20} />
                                    Variants ({product.skus.length})
                                </h3>
                                <p className="text-gray-400 text-sm">Set COGS for each variant individually for accurate profit tracking</p>
                                <div className="space-y-2">
                                    {product.skus.map((sku, index) => {
                                        const skuStock = sku.inventory?.reduce((sum, inv) => sum + inv.quantity, 0) || 0;
                                        const skuPrice = parseFloat(sku.price?.tax_exclusive_price || '0');
                                        const variantName = sku.sales_attributes
                                            ?.map(attr => `${attr.name}: ${attr.value_name}`)
                                            .join(', ') || `Variant ${index + 1}`;
                                        const isEditingSku = editingSkuId === sku.id;
                                        const isEditingSkuShipping = editingSkuShippingId === sku.id;

                                        return (
                                            <div key={sku.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <p className="text-white font-medium">{variantName}</p>
                                                            {sku.sales_attributes?.[0]?.sku_img?.urls?.[0] && (
                                                                <img
                                                                    src={sku.sales_attributes[0].sku_img.urls[0]}
                                                                    alt={variantName}
                                                                    className="w-8 h-8 rounded object-cover border border-gray-700"
                                                                />
                                                            )}
                                                        </div>
                                                        {sku.seller_sku && (
                                                            <p className="text-gray-400 text-xs mb-2">SKU: {sku.seller_sku}</p>
                                                        )}
                                                        <div className="flex flex-wrap gap-4 text-sm">
                                                            <div>
                                                                <span className="text-gray-400">Price: </span>
                                                                <span className="text-pink-500 font-semibold">
                                                                    {sku.price?.currency || product.currency} {skuPrice.toFixed(2)}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                <span className="text-gray-400">Stock: </span>
                                                                <span className={`font-semibold ${skuStock > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                                    {skuStock}
                                                                </span>
                                                            </div>
                                                            {/* COGS Display/Edit */}
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-gray-400">COGS: </span>
                                                                {readOnly ? (
                                                                    <span className={`font-semibold ${sku.cogs !== null && sku.cogs !== undefined ? 'text-orange-400' : 'text-gray-500'}`}>
                                                                        {sku.cogs !== null && sku.cogs !== undefined
                                                                            ? `${product.currency} ${sku.cogs.toFixed(2)}`
                                                                            : 'Not set'}
                                                                    </span>
                                                                ) : isEditingSku ? (
                                                                    <div className="flex items-center gap-2">
                                                                        <input
                                                                            type="number"
                                                                            value={skuCogsValues[sku.id] || ''}
                                                                            onChange={(e) => setSkuCogsValues(prev => ({
                                                                                ...prev,
                                                                                [sku.id]: e.target.value
                                                                            }))}
                                                                            className="w-20 bg-gray-900 border border-orange-500 text-white px-2 py-1 rounded text-sm"
                                                                            step="0.01"
                                                                            min="0"
                                                                            placeholder="0.00"
                                                                            autoFocus
                                                                        />
                                                                        <button
                                                                            onClick={() => handleSaveSkuCogs(sku.id)}
                                                                            disabled={isSavingSkuCogs}
                                                                            className="p-1 bg-green-600 hover:bg-green-700 rounded text-white disabled:opacity-50"
                                                                        >
                                                                            {isSavingSkuCogs ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                                        </button>
                                                                        <button
                                                                            onClick={() => {
                                                                                setEditingSkuId(null);
                                                                                setSkuCogsValues(prev => ({
                                                                                    ...prev,
                                                                                    [sku.id]: sku.cogs?.toString() || ''
                                                                                }));
                                                                                setSkuCogsError(null);
                                                                            }}
                                                                            className="p-1 bg-gray-600 hover:bg-gray-500 rounded text-white"
                                                                        >
                                                                            <X size={12} />
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-2">
                                                                        <span className={`font-semibold ${sku.cogs !== null && sku.cogs !== undefined ? 'text-orange-400' : 'text-gray-500'}`}>
                                                                            {sku.cogs !== null && sku.cogs !== undefined
                                                                                ? `${product.currency} ${sku.cogs.toFixed(2)}`
                                                                                : 'Not set'}
                                                                        </span>
                                                                        <button
                                                                            onClick={() => setEditingSkuId(sku.id)}
                                                                            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                                                                            title="Edit COGS"
                                                                        >
                                                                            <Edit2 size={12} />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {/* Shipping Display/Edit */}
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-gray-400">Shipping: </span>
                                                                {readOnly ? (
                                                                    <span className={`font-semibold ${sku.shipping_cost != null ? 'text-blue-400' : 'text-gray-500'}`}>
                                                                        {sku.shipping_cost != null
                                                                            ? `${product.currency} ${sku.shipping_cost.toFixed(2)}`
                                                                            : 'Not set'}
                                                                    </span>
                                                                ) : isEditingSkuShipping ? (
                                                                    <div className="flex items-center gap-2">
                                                                        <input
                                                                            type="number"
                                                                            value={skuShippingValues[sku.id] || ''}
                                                                            onChange={(e) => setSkuShippingValues(prev => ({
                                                                                ...prev,
                                                                                [sku.id]: e.target.value
                                                                            }))}
                                                                            className="w-20 bg-gray-900 border border-blue-500 text-white px-2 py-1 rounded text-sm"
                                                                            step="0.01"
                                                                            min="0"
                                                                            placeholder="0.00"
                                                                            autoFocus
                                                                        />
                                                                        <button
                                                                            onClick={() => handleSaveSkuShipping(sku.id)}
                                                                            disabled={isSavingSkuShipping}
                                                                            className="p-1 bg-green-600 hover:bg-green-700 rounded text-white disabled:opacity-50"
                                                                        >
                                                                            {isSavingSkuShipping ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                                        </button>
                                                                        <button
                                                                            onClick={() => {
                                                                                setEditingSkuShippingId(null);
                                                                                setSkuShippingValues(prev => ({
                                                                                    ...prev,
                                                                                    [sku.id]: sku.shipping_cost?.toString() || ''
                                                                                }));
                                                                                setSkuShippingError(null);
                                                                            }}
                                                                            className="p-1 bg-gray-600 hover:bg-gray-500 rounded text-white"
                                                                        >
                                                                            <X size={12} />
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-2">
                                                                        <span className={`font-semibold ${sku.shipping_cost != null ? 'text-blue-400' : 'text-gray-500'}`}>
                                                                            {sku.shipping_cost != null
                                                                                ? `${product.currency} ${sku.shipping_cost.toFixed(2)}`
                                                                                : 'Not set'}
                                                                        </span>
                                                                        <button
                                                                            onClick={() => setEditingSkuShippingId(sku.id)}
                                                                            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                                                                            title="Edit Shipping"
                                                                        >
                                                                            <Edit2 size={12} />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {isEditingSku && skuCogsError && (
                                                            <p className="text-red-400 text-xs mt-2">{skuCogsError}</p>
                                                        )}
                                                        {isEditingSkuShipping && skuShippingError && (
                                                            <p className="text-red-400 text-xs mt-2">{skuShippingError}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Layers className="text-pink-500" size={20} />
                                Specifications
                            </h3>
                            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-3">
                                <div className="flex justify-between py-2 border-b border-gray-700 last:border-0">
                                    <span className="text-gray-400">SKU ID</span>
                                    <span className="text-white font-mono text-sm">{product.product_id}</span>
                                </div>
                                <div className="flex justify-between py-2 border-b border-gray-700 last:border-0">
                                    <span className="text-gray-400">Currency</span>
                                    <span className="text-white">{product.currency}</span>
                                </div>
                                {createdDate && (
                                    <div className="flex justify-between py-2 border-b border-gray-700 last:border-0">
                                        <span className="text-gray-400 flex items-center gap-2">
                                            <Calendar size={14} />
                                            Created
                                        </span>
                                        <span className="text-white text-sm">{createdDate}</span>
                                    </div>
                                )}
                                {/* Add more specs if available */}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Edit Modal */}
            {!readOnly && showEditModal && (
                <ProductEditModal
                    product={product}
                    accountId={accountId}
                    onClose={() => setShowEditModal(false)}
                    onSave={() => setShowEditModal(false)}
                />
            )}
        </div>
    );
}
