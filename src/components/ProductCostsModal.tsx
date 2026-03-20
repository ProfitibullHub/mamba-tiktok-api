import { useState, useCallback } from 'react';
import { X, DollarSign, Loader2, Check, Truck, Layers, ChevronDown } from 'lucide-react';
import { Product, useShopStore } from '../store/useShopStore';

interface ProductCostsModalProps {
    product: Product;
    accountId: string;
    onClose: () => void;
}

type ApplyFromOption = 'today' | 'specific_date';

export function ProductCostsModal({ product, accountId, onClose }: ProductCostsModalProps) {
    const { updateProductCosts, updateProductSkuCosts } = useShopStore();

    // COGS state
    const [cogsValue, setCogsValue] = useState<string>(product.cogs?.toString() || '');
    const [isSavingCogs, setIsSavingCogs] = useState(false);
    const [cogsError, setCogsError] = useState<string | null>(null);
    const [cogsApplyFrom, setCogsApplyFrom] = useState<ApplyFromOption>('today');
    const [cogsEffectiveDate, setCogsEffectiveDate] = useState<string>(new Date().toISOString().split('T')[0]);

    // Shipping cost state
    const [shippingValue, setShippingValue] = useState<string>(product.shipping_cost?.toString() || '');
    const [isSavingShipping, setIsSavingShipping] = useState(false);
    const [shippingError, setShippingError] = useState<string | null>(null);
    const [shippingApplyFrom, setShippingApplyFrom] = useState<ApplyFromOption>('today');
    const [shippingEffectiveDate, setShippingEffectiveDate] = useState<string>(new Date().toISOString().split('T')[0]);

    // Fulfillment type state
    const [fulfillmentType, setFulfillmentType] = useState<'fbt' | 'self'>(product.is_fbt ? 'fbt' : 'self');
    const [isSavingFulfillment, setIsSavingFulfillment] = useState(false);

    // SKU-level state
    const [expandedSkuId, setExpandedSkuId] = useState<string | null>(null);
    const [skuCogsValues, setSkuCogsValues] = useState<Record<string, string>>(() => {
        const initial: Record<string, string> = {};
        product.skus?.forEach(sku => { initial[sku.id] = sku.cogs?.toString() || ''; });
        return initial;
    });
    const [skuShippingValues, setSkuShippingValues] = useState<Record<string, string>>(() => {
        const initial: Record<string, string> = {};
        product.skus?.forEach(sku => { initial[sku.id] = sku.shipping_cost?.toString() || ''; });
        return initial;
    });
    const [skuCogsApplyFrom, setSkuCogsApplyFrom] = useState<Record<string, ApplyFromOption>>({});
    const [skuCogsEffectiveDate, setSkuCogsEffectiveDate] = useState<Record<string, string>>({});
    const [skuShippingApplyFrom, setSkuShippingApplyFrom] = useState<Record<string, ApplyFromOption>>({});
    const [skuShippingEffectiveDate, setSkuShippingEffectiveDate] = useState<Record<string, string>>({});
    const [isSavingSkuCogs, setIsSavingSkuCogs] = useState(false);
    const [isSavingSkuShipping, setIsSavingSkuShipping] = useState(false);
    const [skuCogsError, setSkuCogsError] = useState<string | null>(null);
    const [skuShippingError, setSkuShippingError] = useState<string | null>(null);

    // Handle Save COGS
    const handleSaveCogs = useCallback(async () => {
        setCogsError(null);
        const numValue = cogsValue.trim() === '' ? null : parseFloat(cogsValue);

        if (numValue !== null && (isNaN(numValue) || numValue < 0)) {
            setCogsError('Please enter a valid non-negative number');
            return;
        }

        setIsSavingCogs(true);
        try {
            await updateProductCosts(product.product_id, {
                cogs: numValue,
                applyFrom: cogsApplyFrom,
                effectiveDate: cogsApplyFrom === 'specific_date' ? cogsEffectiveDate : undefined,
                accountId
            });
        } catch (error: any) {
            setCogsError(error.message);
        } finally {
            setIsSavingCogs(false);
        }
    }, [cogsValue, cogsApplyFrom, cogsEffectiveDate, product.product_id, updateProductCosts, accountId]);

    // Handle Save Shipping
    const handleSaveShipping = useCallback(async () => {
        setShippingError(null);
        const numValue = shippingValue.trim() === '' ? null : parseFloat(shippingValue);

        if (numValue !== null && (isNaN(numValue) || numValue < 0)) {
            setShippingError('Please enter a valid non-negative number');
            return;
        }

        setIsSavingShipping(true);
        try {
            await updateProductCosts(product.product_id, {
                shipping_cost: numValue,
                applyFrom: shippingApplyFrom,
                effectiveDate: shippingApplyFrom === 'specific_date' ? shippingEffectiveDate : undefined,
                accountId
            });
        } catch (error: any) {
            setShippingError(error.message);
        } finally {
            setIsSavingShipping(false);
        }
    }, [shippingValue, shippingApplyFrom, shippingEffectiveDate, product.product_id, updateProductCosts, accountId]);

    // Handle Fulfillment Type Change
    const handleFulfillmentChange = useCallback(async (type: 'fbt' | 'self') => {
        setFulfillmentType(type);
        setIsSavingFulfillment(true);

        try {
            await updateProductCosts(product.product_id, {
                is_fbt: type === 'fbt',
                // Clear shipping cost if switching to FBT
                ...(type === 'fbt' ? { shipping_cost: null } : {}),
                accountId
            });

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
    }, [product.product_id, updateProductCosts, accountId]);

    // Handle Save SKU COGS
    const handleSaveSkuCogs = useCallback(async (skuId: string) => {
        setSkuCogsError(null);
        const value = skuCogsValues[skuId];
        const numValue = value.trim() === '' ? null : parseFloat(value);

        if (numValue !== null && (isNaN(numValue) || numValue < 0)) {
            setSkuCogsError('Please enter a valid non-negative number');
            return;
        }

        const applyFrom = skuCogsApplyFrom[skuId] || 'today';
        const effectiveDate = applyFrom === 'specific_date' ? (skuCogsEffectiveDate[skuId] || new Date().toISOString().split('T')[0]) : undefined;

        setIsSavingSkuCogs(true);
        try {
            await updateProductSkuCosts(product.product_id, skuId, {
                cogs: numValue,
                applyFrom,
                effectiveDate
            }, accountId);
        } catch (error: any) {
            setSkuCogsError(error.message);
        } finally {
            setIsSavingSkuCogs(false);
        }
    }, [skuCogsValues, skuCogsApplyFrom, skuCogsEffectiveDate, product.product_id, updateProductSkuCosts, accountId]);

    // Handle Save SKU Shipping
    const handleSaveSkuShipping = useCallback(async (skuId: string) => {
        setSkuShippingError(null);
        const value = skuShippingValues[skuId];
        const numValue = value.trim() === '' ? null : parseFloat(value);

        if (numValue !== null && (isNaN(numValue) || numValue < 0)) {
            setSkuShippingError('Please enter a valid non-negative number');
            return;
        }

        const applyFrom = skuShippingApplyFrom[skuId] || 'today';
        const effectiveDate = applyFrom === 'specific_date' ? (skuShippingEffectiveDate[skuId] || new Date().toISOString().split('T')[0]) : undefined;

        setIsSavingSkuShipping(true);
        try {
            await updateProductSkuCosts(product.product_id, skuId, {
                shipping_cost: numValue,
                applyFrom,
                effectiveDate
            }, accountId);
        } catch (error: any) {
            setSkuShippingError(error.message);
        } finally {
            setIsSavingSkuShipping(false);
        }
    }, [skuShippingValues, skuShippingApplyFrom, skuShippingEffectiveDate, product.product_id, updateProductSkuCosts, accountId]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-800 shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-800 p-6 flex justify-between items-center z-10">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <DollarSign className="text-green-500" />
                            Edit Product Costs
                        </h2>
                        <p className="text-gray-400 text-sm">{product.name}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 space-y-8">
                    {/* COGS Section */}
                    <div className="space-y-3">
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <DollarSign className="text-orange-500" size={20} />
                            Cost of Goods Sold (COGS)
                        </h3>
                        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
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
                                    <button
                                        onClick={handleSaveCogs}
                                        disabled={isSavingCogs}
                                        className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {isSavingCogs ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                        Save COGS
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Shipping Section */}
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
                                        onClick={() => handleFulfillmentChange('fbt')}
                                        disabled={isSavingFulfillment}
                                        className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${fulfillmentType === 'fbt'
                                            ? 'border-pink-500 bg-pink-500/10'
                                            : 'border-gray-600 hover:border-gray-500 bg-gray-900'
                                            }`}
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
                                        onClick={() => handleFulfillmentChange('self')}
                                        disabled={isSavingFulfillment}
                                        className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${fulfillmentType === 'self'
                                            ? 'border-blue-500 bg-blue-500/10'
                                            : 'border-gray-600 hover:border-gray-500 bg-gray-900'
                                            }`}
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
                            </div>

                            {/* Self-Fulfilled Cost Entry */}
                            {fulfillmentType === 'self' && (
                                <div className="space-y-4 border-t border-gray-700 pt-4">
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
                                        <button
                                            onClick={handleSaveShipping}
                                            disabled={isSavingShipping}
                                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {isSavingShipping ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                            Save Shipping
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* SKU Variants Section */}
                    {product.skus && product.skus.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Layers className="text-purple-500" size={20} />
                                Variant Costs ({product.skus.length})
                            </h3>
                            <div className="space-y-2">
                                {product.skus.map((sku, index) => {
                                    const variantName = sku.sales_attributes
                                        ?.map(attr => `${attr.name}: ${attr.value_name}`)
                                        .join(', ') || `Variant ${index + 1}`;
                                    const isExpanded = expandedSkuId === sku.id;

                                    return (
                                        <div key={sku.id} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                                            {/* Collapsed header */}
                                            <button
                                                onClick={() => setExpandedSkuId(isExpanded ? null : sku.id)}
                                                className="w-full p-4 flex items-center justify-between gap-4 hover:bg-gray-750 transition-colors"
                                            >
                                                <div className="flex-1 text-left">
                                                    <p className="text-white font-medium">{variantName}</p>
                                                    {sku.seller_sku && (
                                                        <p className="text-gray-400 text-xs">SKU: {sku.seller_sku}</p>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-4 text-sm">
                                                    <div>
                                                        <span className="text-gray-400">COGS: </span>
                                                        <span className={sku.cogs != null ? 'text-orange-400 font-semibold' : 'text-gray-500'}>
                                                            {sku.cogs != null ? `${product.currency} ${sku.cogs.toFixed(2)}` : 'Not set'}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <span className="text-gray-400">Shipping: </span>
                                                        <span className={sku.shipping_cost != null ? 'text-blue-400 font-semibold' : 'text-gray-500'}>
                                                            {sku.shipping_cost != null ? `${product.currency} ${sku.shipping_cost.toFixed(2)}` : 'Not set'}
                                                        </span>
                                                    </div>
                                                    <ChevronDown size={16} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                                </div>
                                            </button>

                                            {/* Expanded edit section */}
                                            {isExpanded && (
                                                <div className="border-t border-gray-700 p-4 space-y-6">
                                                    {/* SKU COGS */}
                                                    <div className="space-y-3">
                                                        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                                                            <DollarSign className="text-orange-500" size={16} />
                                                            COGS
                                                        </h4>
                                                        <div className="bg-gray-900 rounded-lg p-3 border border-gray-700 space-y-3">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-gray-400 text-sm">{product.currency}</span>
                                                                <input
                                                                    type="number"
                                                                    value={skuCogsValues[sku.id] || ''}
                                                                    onChange={(e) => setSkuCogsValues(prev => ({ ...prev, [sku.id]: e.target.value }))}
                                                                    className="flex-1 bg-gray-800 border border-gray-600 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-orange-500"
                                                                    step="0.01"
                                                                    min="0"
                                                                    placeholder="Enter cost per unit"
                                                                />
                                                            </div>
                                                            <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                                                                <p className="text-xs text-gray-400 mb-2">Apply from:</p>
                                                                <div className="flex flex-col gap-2">
                                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                                        <input
                                                                            type="radio"
                                                                            name={`skuCogsApplyFrom_${sku.id}`}
                                                                            checked={(skuCogsApplyFrom[sku.id] || 'today') === 'today'}
                                                                            onChange={() => setSkuCogsApplyFrom(prev => ({ ...prev, [sku.id]: 'today' }))}
                                                                            className="text-orange-500"
                                                                        />
                                                                        <span className="text-white text-xs">Today (apply going forward)</span>
                                                                    </label>
                                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                                        <input
                                                                            type="radio"
                                                                            name={`skuCogsApplyFrom_${sku.id}`}
                                                                            checked={(skuCogsApplyFrom[sku.id] || 'today') === 'specific_date'}
                                                                            onChange={() => setSkuCogsApplyFrom(prev => ({ ...prev, [sku.id]: 'specific_date' }))}
                                                                            className="text-orange-500"
                                                                        />
                                                                        <span className="text-white text-xs">Specific date (backdate)</span>
                                                                    </label>
                                                                    {skuCogsApplyFrom[sku.id] === 'specific_date' && (
                                                                        <input
                                                                            type="date"
                                                                            value={skuCogsEffectiveDate[sku.id] || new Date().toISOString().split('T')[0]}
                                                                            onChange={(e) => setSkuCogsEffectiveDate(prev => ({ ...prev, [sku.id]: e.target.value }))}
                                                                            className="mt-1 bg-gray-900 border border-gray-600 text-white px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-orange-500"
                                                                        />
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center justify-between">
                                                                {skuCogsError && <p className="text-red-400 text-xs">{skuCogsError}</p>}
                                                                <div className="ml-auto">
                                                                    <button
                                                                        onClick={() => handleSaveSkuCogs(sku.id)}
                                                                        disabled={isSavingSkuCogs}
                                                                        className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                                                    >
                                                                        {isSavingSkuCogs ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                                        Save COGS
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* SKU Shipping */}
                                                    <div className="space-y-3">
                                                        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                                                            <Truck className="text-blue-500" size={16} />
                                                            Shipping to Customer
                                                        </h4>
                                                        <div className="bg-gray-900 rounded-lg p-3 border border-gray-700 space-y-3">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-gray-400 text-sm">{product.currency}</span>
                                                                <input
                                                                    type="number"
                                                                    value={skuShippingValues[sku.id] || ''}
                                                                    onChange={(e) => setSkuShippingValues(prev => ({ ...prev, [sku.id]: e.target.value }))}
                                                                    className="flex-1 bg-gray-800 border border-gray-600 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                                                                    step="0.01"
                                                                    min="0"
                                                                    placeholder="Enter shipping cost per unit"
                                                                />
                                                            </div>
                                                            <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                                                                <p className="text-xs text-gray-400 mb-2">Apply from:</p>
                                                                <div className="flex flex-col gap-2">
                                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                                        <input
                                                                            type="radio"
                                                                            name={`skuShippingApplyFrom_${sku.id}`}
                                                                            checked={(skuShippingApplyFrom[sku.id] || 'today') === 'today'}
                                                                            onChange={() => setSkuShippingApplyFrom(prev => ({ ...prev, [sku.id]: 'today' }))}
                                                                            className="text-blue-500"
                                                                        />
                                                                        <span className="text-white text-xs">Today (apply going forward)</span>
                                                                    </label>
                                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                                        <input
                                                                            type="radio"
                                                                            name={`skuShippingApplyFrom_${sku.id}`}
                                                                            checked={(skuShippingApplyFrom[sku.id] || 'today') === 'specific_date'}
                                                                            onChange={() => setSkuShippingApplyFrom(prev => ({ ...prev, [sku.id]: 'specific_date' }))}
                                                                            className="text-blue-500"
                                                                        />
                                                                        <span className="text-white text-xs">Specific date (backdate)</span>
                                                                    </label>
                                                                    {skuShippingApplyFrom[sku.id] === 'specific_date' && (
                                                                        <input
                                                                            type="date"
                                                                            value={skuShippingEffectiveDate[sku.id] || new Date().toISOString().split('T')[0]}
                                                                            onChange={(e) => setSkuShippingEffectiveDate(prev => ({ ...prev, [sku.id]: e.target.value }))}
                                                                            className="mt-1 bg-gray-900 border border-gray-600 text-white px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                                                                        />
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center justify-between">
                                                                {skuShippingError && <p className="text-red-400 text-xs">{skuShippingError}</p>}
                                                                <div className="ml-auto">
                                                                    <button
                                                                        onClick={() => handleSaveSkuShipping(sku.id)}
                                                                        disabled={isSavingSkuShipping}
                                                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                                                    >
                                                                        {isSavingSkuShipping ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                                        Save Shipping
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="border-t border-gray-800 p-4 bg-gray-900/95 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                    >
                        done
                    </button>
                </div>
            </div>
        </div>
    );
}
