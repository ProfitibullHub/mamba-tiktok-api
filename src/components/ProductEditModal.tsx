import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    X, Save, Loader2, Package, DollarSign, Layers, Image as ImageIcon,
    Plus, Trash2, AlertCircle, CheckCircle, Edit2, Box, Upload
} from 'lucide-react';
import { Product, useShopStore } from '../store/useShopStore';
import { RichTextEditor } from './RichTextEditor';
import { apiFetch } from '../lib/apiClient';

interface ProductEditModalProps {
    product: Product;
    accountId: string;
    onClose: () => void;
    onSave?: () => void;
}

type EditTab = 'basic' | 'pricing' | 'inventory' | 'images';

interface SKUEdit {
    id: string;
    seller_sku?: string;
    original_price: string;
    sale_price?: string;
    quantity: number;
    warehouse_id?: string;
    variantName: string;
}

export function ProductEditModal({ product, accountId, onClose, onSave }: ProductEditModalProps) {
    const { editProduct, updateProductPrices, updateProductInventory, fetchWarehouses, warehouses } = useShopStore();

    // Tab state
    const [activeTab, setActiveTab] = useState<EditTab>('basic');

    // Basic info state
    const [title, setTitle] = useState(product.name || '');
    const [description, setDescription] = useState(product.details?.description || '');

    // SKU/Variant state
    const [skuEdits, setSkuEdits] = useState<SKUEdit[]>([]);

    // UI state
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);

    // Image upload state
    const [uploadedImages, setUploadedImages] = useState<Array<{ uri: string; url: string }>>([]);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Initialize SKU edits from product
    useEffect(() => {
        const skus = product.skus || [];
        const initialSkuEdits: SKUEdit[] = skus.map(sku => {
            const variantName = sku.sales_attributes
                ?.map(attr => `${attr.name}: ${attr.value_name}`)
                .join(', ') || 'Default';
            const totalStock = sku.inventory?.reduce((sum, inv) => sum + inv.quantity, 0) || 0;
            const warehouseId = sku.inventory?.[0]?.warehouse_id || '';

            return {
                id: sku.id,
                seller_sku: sku.seller_sku,
                original_price: sku.price?.tax_exclusive_price || String(product.price),
                sale_price: sku.price?.sale_price,
                quantity: totalStock,
                warehouse_id: warehouseId,
                variantName
            };
        });

        // If no SKUs, create a default one
        if (initialSkuEdits.length === 0) {
            initialSkuEdits.push({
                id: 'default',
                original_price: String(product.price),
                quantity: product.stock_quantity,
                variantName: 'Default'
            });
        }

        setSkuEdits(initialSkuEdits);
    }, [product]);

    // Fetch warehouses on mount
    useEffect(() => {
        if (warehouses.length === 0) {
            fetchWarehouses(accountId).catch(console.error);
        }
    }, [accountId, fetchWarehouses, warehouses.length]);

    // Track changes with debounce to prevent excessive re-renders
    const changeCheckTimer = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // Debounce change detection
        if (changeCheckTimer.current) {
            clearTimeout(changeCheckTimer.current);
        }

        changeCheckTimer.current = setTimeout(() => {
            const titleChanged = title !== product.name;
            const descriptionChanged = description !== (product.details?.description || '');

            const skusChanged = skuEdits.some(edit => {
                const originalSku = product.skus?.find(s => s.id === edit.id);
                if (!originalSku) return true;
                const originalPrice = originalSku.price?.tax_exclusive_price || String(product.price);
                const originalStock = originalSku.inventory?.reduce((sum, inv) => sum + inv.quantity, 0) || 0;
                return edit.original_price !== originalPrice || edit.quantity !== originalStock;
            });

            setHasChanges(titleChanged || descriptionChanged || skusChanged);
        }, 300);

        return () => {
            if (changeCheckTimer.current) {
                clearTimeout(changeCheckTimer.current);
            }
        };
    }, [title, description, skuEdits, product]);

    const handleSaveBasicInfo = async () => {
        if (!title.trim()) {
            setSaveError('Title is required');
            return;
        }

        setIsSaving(true);
        setSaveError(null);
        setSaveSuccess(null);

        try {
            await editProduct(accountId, product.product_id, {
                title: title.trim(),
                description: description.trim() || undefined
            });
            setSaveSuccess('Basic info updated successfully');
            setTimeout(() => setSaveSuccess(null), 3000);
        } catch (error: any) {
            setSaveError(error.message || 'Failed to update basic info');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSavePrices = async () => {
        setIsSaving(true);
        setSaveError(null);
        setSaveSuccess(null);

        try {
            const skuPrices = skuEdits
                .filter(edit => edit.id !== 'default')
                .map(edit => ({
                    id: edit.id,
                    original_price: edit.original_price,
                    ...(edit.sale_price && { sale_price: edit.sale_price })
                }));

            if (skuPrices.length > 0) {
                await updateProductPrices(accountId, product.product_id, skuPrices);
            }
            setSaveSuccess('Prices updated successfully');
            setTimeout(() => setSaveSuccess(null), 3000);
        } catch (error: any) {
            setSaveError(error.message || 'Failed to update prices');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveInventory = async () => {
        setIsSaving(true);
        setSaveError(null);
        setSaveSuccess(null);

        try {
            // Get default warehouse if none specified
            const defaultWarehouse = warehouses.find(w => w.is_default) || warehouses[0];

            const skuInventory = skuEdits
                .filter(edit => edit.id !== 'default')
                .map(edit => ({
                    id: edit.id,
                    inventory: [{
                        warehouse_id: edit.warehouse_id || defaultWarehouse?.id || '',
                        quantity: edit.quantity
                    }]
                }));

            if (skuInventory.length > 0) {
                // Validate warehouse IDs
                const missingWarehouse = skuInventory.some(s => !s.inventory[0].warehouse_id);
                if (missingWarehouse) {
                    setSaveError('Warehouse ID is required. Please fetch warehouses first.');
                    setIsSaving(false);
                    return;
                }
                await updateProductInventory(accountId, product.product_id, skuInventory);
            }
            setSaveSuccess('Inventory updated successfully');
            setTimeout(() => setSaveSuccess(null), 3000);
        } catch (error: any) {
            setSaveError(error.message || 'Failed to update inventory');
        } finally {
            setIsSaving(false);
        }
    };

    // Memoized SKU update handler
    const updateSkuEdit = useCallback((skuId: string, field: keyof SKUEdit, value: string | number) => {
        setSkuEdits(prev => prev.map(sku =>
            sku.id === skuId ? { ...sku, [field]: value } : sku
        ));
    }, []);

    // Handle image file selection and upload
    const handleImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        setIsUploadingImage(true);
        setUploadError(null);

        try {
            for (const file of Array.from(files)) {
                // Validate file type
                if (!file.type.startsWith('image/')) {
                    throw new Error(`File "${file.name}" is not an image`);
                }

                // Validate file size (max 5MB)
                if (file.size > 5 * 1024 * 1024) {
                    throw new Error(`File "${file.name}" exceeds 5MB limit`);
                }

                // Convert file to base64
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const result = reader.result as string;
                        // Remove data URL prefix to get pure base64
                        const base64Data = result.split(',')[1];
                        resolve(base64Data);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                // Upload to TikTok via backend
                const response = await apiFetch('/api/tiktok-shop/images/upload', {
                    method: 'POST',
                    body: JSON.stringify({
                        accountId,
                        imageData: base64,
                        fileName: file.name,
                        useCase: 'MAIN_IMAGE'
                    })
                });

                const data = await response.json();
                if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Failed to upload image');
                }

                // Add uploaded image to state - TikTok returns a URI to use in product updates
                setUploadedImages(prev => [...prev, {
                    uri: data.data.uri,
                    url: data.data.url || data.data.uri // Use URL if available for preview
                }]);

                setSaveSuccess(`Image "${file.name}" uploaded successfully!`);
                setTimeout(() => setSaveSuccess(null), 3000);
            }
        } catch (error: any) {
            console.error('Image upload error:', error);
            setUploadError(error.message);
        } finally {
            setIsUploadingImage(false);
            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    }, [accountId]);

    // Remove an uploaded image from the list - memoized
    const removeUploadedImage = useCallback((index: number) => {
        setUploadedImages(prev => prev.filter((_, i) => i !== index));
    }, []);

    // Save images to product
    const handleSaveImages = async () => {
        if (uploadedImages.length === 0) {
            setSaveError('Please upload at least one image');
            return;
        }

        setIsSaving(true);
        setSaveError(null);

        try {
            // Combine existing images with newly uploaded ones
            const existingImages = product.main_image_url
                ? [{ uri: product.main_image_url }]
                : [];

            // Note: For TikTok, we need to include ALL images we want to keep
            const allImages = [
                ...existingImages,
                ...uploadedImages.map(img => ({ uri: img.uri }))
            ];

            const response = await apiFetch(`/api/tiktok-shop/products/${product.product_id}/partial-edit`, {
                method: 'POST',
                body: JSON.stringify({
                    accountId,
                    main_images: allImages
                })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to update images');
            }

            setSaveSuccess('Images updated successfully! This may trigger a product review.');
            setUploadedImages([]);
            setTimeout(() => setSaveSuccess(null), 3000);
        } catch (error: any) {
            setSaveError(error.message);
        } finally {
            setIsSaving(false);
        }
    };

    // Memoize tabs array to prevent recreation on every render
    const tabs = useMemo(() => [
        { id: 'basic' as EditTab, label: 'Basic Info', icon: <Edit2 size={16} /> },
        { id: 'pricing' as EditTab, label: 'Pricing', icon: <DollarSign size={16} /> },
        { id: 'inventory' as EditTab, label: 'Inventory', icon: <Box size={16} /> },
        { id: 'images' as EditTab, label: 'Images', icon: <ImageIcon size={16} /> }
    ], []);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden border border-gray-800 shadow-2xl flex flex-col">
                {/* Header */}
                <div className="bg-gray-900/95 backdrop-blur border-b border-gray-800 p-6 flex justify-between items-start">
                    <div className="flex gap-4">
                        {/* Product Image Thumbnail */}
                        <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-800 border border-gray-700 flex-shrink-0">
                            {product.main_image_url ? (
                                <img
                                    src={product.main_image_url}
                                    alt={product.name}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <Package size={24} className="text-gray-600" />
                                </div>
                            )}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">Edit Product</h2>
                            <p className="text-gray-400 text-sm mt-1 line-clamp-1">{product.name}</p>
                            <p className="text-gray-500 text-xs">ID: {product.product_id}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="border-b border-gray-800 px-6">
                    <div className="flex gap-1">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === tab.id
                                    ? 'text-pink-500 border-pink-500'
                                    : 'text-gray-400 border-transparent hover:text-white hover:border-gray-600'
                                    }`}
                            >
                                {tab.icon}
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* Error/Success Messages */}
                    {saveError && (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400">
                            <AlertCircle size={18} />
                            <span className="text-sm">{saveError}</span>
                        </div>
                    )}
                    {saveSuccess && (
                        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-2 text-green-400">
                            <CheckCircle size={18} />
                            <span className="text-sm">{saveSuccess}</span>
                        </div>
                    )}

                    {/* Basic Info Tab */}
                    {activeTab === 'basic' && (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    Product Title *
                                </label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    className="w-full bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-pink-500 transition-colors"
                                    placeholder="Enter product title"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    Changing the title may trigger a product review by TikTok
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    Description
                                </label>
                                <RichTextEditor
                                    value={description}
                                    onChange={setDescription}
                                    placeholder="Enter product description..."
                                />
                                <p className="text-xs text-gray-500 mt-2">
                                    Use the toolbar above to format text. Changing description may trigger a product review.
                                </p>
                            </div>

                            <div className="flex justify-end">
                                <button
                                    onClick={handleSaveBasicInfo}
                                    disabled={isSaving || (!title.trim())}
                                    className="flex items-center gap-2 px-6 py-2.5 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                    Save Basic Info
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Pricing Tab */}
                    {activeTab === 'pricing' && (
                        <div className="space-y-6">
                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                                <p className="text-blue-300 text-sm">
                                    <strong>Note:</strong> Price updates are usually instant and don't trigger a product review.
                                </p>
                            </div>

                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <Layers className="text-pink-500" size={20} />
                                    SKU Prices ({skuEdits.length})
                                </h3>

                                {skuEdits.map((sku, index) => (
                                    <div key={sku.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                                        <div className="flex items-center justify-between mb-3">
                                            <div>
                                                <p className="text-white font-medium">{sku.variantName}</p>
                                                {sku.seller_sku && (
                                                    <p className="text-gray-400 text-xs">SKU: {sku.seller_sku}</p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">
                                                    Original Price ({product.currency})
                                                </label>
                                                <input
                                                    type="number"
                                                    value={sku.original_price}
                                                    onChange={(e) => updateSkuEdit(sku.id, 'original_price', e.target.value)}
                                                    min="0"
                                                    step="0.01"
                                                    className="w-full bg-gray-900 border border-gray-600 text-white px-3 py-2 rounded-lg focus:outline-none focus:border-pink-500"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">
                                                    Sale Price (Optional)
                                                </label>
                                                <input
                                                    type="number"
                                                    value={sku.sale_price || ''}
                                                    onChange={(e) => updateSkuEdit(sku.id, 'sale_price', e.target.value)}
                                                    min="0"
                                                    step="0.01"
                                                    placeholder="No sale"
                                                    className="w-full bg-gray-900 border border-gray-600 text-white px-3 py-2 rounded-lg focus:outline-none focus:border-pink-500"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-end">
                                <button
                                    onClick={handleSavePrices}
                                    disabled={isSaving || skuEdits.filter(s => s.id !== 'default').length === 0}
                                    className="flex items-center gap-2 px-6 py-2.5 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                    Update Prices
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Inventory Tab */}
                    {activeTab === 'inventory' && (
                        <div className="space-y-6">
                            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                                <p className="text-green-300 text-sm">
                                    <strong>Good news!</strong> Stock updates are instant and don't trigger a product review.
                                </p>
                            </div>

                            {/* Warehouse Info */}
                            {warehouses.length > 0 && (
                                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                                    <p className="text-sm text-gray-400 mb-2">Available Warehouses:</p>
                                    <div className="flex flex-wrap gap-2">
                                        {warehouses.map(wh => (
                                            <span
                                                key={wh.id}
                                                className={`px-2 py-1 rounded text-xs ${wh.is_default
                                                    ? 'bg-green-500/20 text-green-400'
                                                    : 'bg-gray-700 text-gray-300'
                                                    }`}
                                            >
                                                {wh.name} {wh.is_default && '(Default)'}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <Box className="text-pink-500" size={20} />
                                    SKU Inventory ({skuEdits.length})
                                </h3>

                                {skuEdits.map((sku) => (
                                    <div key={sku.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                                        <div className="flex items-center justify-between mb-3">
                                            <div>
                                                <p className="text-white font-medium">{sku.variantName}</p>
                                                {sku.seller_sku && (
                                                    <p className="text-gray-400 text-xs">SKU: {sku.seller_sku}</p>
                                                )}
                                            </div>
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${sku.quantity === 0
                                                ? 'bg-red-500/20 text-red-400'
                                                : sku.quantity < 10
                                                    ? 'bg-yellow-500/20 text-yellow-400'
                                                    : 'bg-green-500/20 text-green-400'
                                                }`}>
                                                {sku.quantity === 0 ? 'Out of Stock' : sku.quantity < 10 ? 'Low Stock' : 'In Stock'}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">
                                                    Quantity
                                                </label>
                                                <input
                                                    type="number"
                                                    value={sku.quantity}
                                                    onChange={(e) => updateSkuEdit(sku.id, 'quantity', parseInt(e.target.value) || 0)}
                                                    min="0"
                                                    className="w-full bg-gray-900 border border-gray-600 text-white px-3 py-2 rounded-lg focus:outline-none focus:border-pink-500"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">
                                                    Warehouse
                                                </label>
                                                <select
                                                    value={sku.warehouse_id || ''}
                                                    onChange={(e) => updateSkuEdit(sku.id, 'warehouse_id', e.target.value)}
                                                    className="w-full bg-gray-900 border border-gray-600 text-white px-3 py-2 rounded-lg focus:outline-none focus:border-pink-500"
                                                >
                                                    {warehouses.length === 0 ? (
                                                        <option value="">Loading warehouses...</option>
                                                    ) : (
                                                        warehouses.map(wh => (
                                                            <option key={wh.id} value={wh.id}>
                                                                {wh.name} {wh.is_default ? '(Default)' : ''}
                                                            </option>
                                                        ))
                                                    )}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-end">
                                <button
                                    onClick={handleSaveInventory}
                                    disabled={isSaving || skuEdits.filter(s => s.id !== 'default').length === 0}
                                    className="flex items-center gap-2 px-6 py-2.5 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                    Update Inventory
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Images Tab */}
                    {activeTab === 'images' && (
                        <div className="space-y-6">
                            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                                <p className="text-yellow-300 text-sm">
                                    <strong>Warning:</strong> Changing images will trigger a product review by TikTok.
                                    You must include ALL images you want to keep (not just new ones).
                                </p>
                            </div>

                            {/* Current Images */}
                            <div>
                                <h3 className="text-lg font-semibold text-white mb-4">Current Images</h3>
                                <div className="grid grid-cols-4 gap-4">
                                    {product.main_image_url && (
                                        <div className="relative aspect-square rounded-lg overflow-hidden bg-gray-800 border border-gray-700">
                                            <img
                                                src={product.main_image_url}
                                                alt="Main image"
                                                className="w-full h-full object-cover"
                                            />
                                            <span className="absolute bottom-2 left-2 px-2 py-1 bg-pink-500/80 text-white text-xs rounded">
                                                Main
                                            </span>
                                        </div>
                                    )}
                                    {product.images?.filter(img => img !== product.main_image_url).map((img, idx) => (
                                        <div key={idx} className="relative aspect-square rounded-lg overflow-hidden bg-gray-800 border border-gray-700">
                                            <img
                                                src={img}
                                                alt={`Image ${idx + 2}`}
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Uploaded Images (pending) */}
                            {uploadedImages.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                        <Plus size={18} className="text-green-400" />
                                        New Images ({uploadedImages.length})
                                    </h3>
                                    <div className="grid grid-cols-4 gap-4">
                                        {uploadedImages.map((img, idx) => (
                                            <div key={idx} className="relative aspect-square rounded-lg overflow-hidden bg-gray-800 border border-green-500/50">
                                                <img
                                                    src={img.url}
                                                    alt={`New image ${idx + 1}`}
                                                    className="w-full h-full object-cover"
                                                />
                                                <button
                                                    onClick={() => removeUploadedImage(idx)}
                                                    className="absolute top-2 right-2 p-1.5 bg-red-500/80 hover:bg-red-500 text-white rounded-full transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                                <span className="absolute bottom-2 left-2 px-2 py-1 bg-green-500/80 text-white text-xs rounded">
                                                    New
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Upload Error */}
                            {uploadError && (
                                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400">
                                    <AlertCircle size={18} />
                                    <span className="text-sm">{uploadError}</span>
                                </div>
                            )}

                            {/* Image Upload Area */}
                            <div
                                className={`bg-gray-800 rounded-xl p-6 border-2 border-dashed transition-colors ${isUploadingImage
                                    ? 'border-pink-500/50 bg-pink-500/5'
                                    : 'border-gray-700 hover:border-gray-600'
                                    }`}
                            >
                                <div className="text-center">
                                    {isUploadingImage ? (
                                        <>
                                            <Loader2 size={48} className="mx-auto text-pink-500 mb-4 animate-spin" />
                                            <p className="text-gray-300 font-medium mb-2">Uploading to TikTok...</p>
                                            <p className="text-gray-500 text-sm">
                                                Please wait while your image is being processed.
                                            </p>
                                        </>
                                    ) : (
                                        <>
                                            <Upload size={48} className="mx-auto text-gray-500 mb-4" />
                                            <p className="text-gray-300 font-medium mb-2">Upload Product Images</p>
                                            <p className="text-gray-500 text-sm mb-4">
                                                Click or drag and drop images here (PNG, JPG, max 5MB each)
                                            </p>
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept="image/png,image/jpeg,image/jpg,image/webp"
                                                multiple
                                                onChange={handleImageUpload}
                                                className="hidden"
                                                id="image-upload"
                                            />
                                            <label
                                                htmlFor="image-upload"
                                                className="inline-flex items-center gap-2 px-6 py-2.5 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors cursor-pointer"
                                            >
                                                <Upload size={18} />
                                                Select Images
                                            </label>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Save Images Button */}
                            {uploadedImages.length > 0 && (
                                <div className="flex justify-end">
                                    <button
                                        onClick={handleSaveImages}
                                        disabled={isSaving}
                                        className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                        Save {uploadedImages.length} New Image{uploadedImages.length > 1 ? 's' : ''}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-gray-800 p-4 bg-gray-900/95 flex justify-between items-center">
                    <div className="text-sm text-gray-500">
                        {hasChanges && (
                            <span className="flex items-center gap-1 text-yellow-400">
                                <AlertCircle size={14} />
                                Unsaved changes
                            </span>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
