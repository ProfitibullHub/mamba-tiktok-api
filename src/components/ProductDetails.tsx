import { useState } from 'react';
import { X, Package, BarChart2, Layers, Calendar } from 'lucide-react';
import { Product } from '../store/useShopStore';

interface ProductDetailsProps {
    product: Product;
    onClose: () => void;
}

export function ProductDetails({ product, onClose }: ProductDetailsProps) {
    const [showFullDescription, setShowFullDescription] = useState(false);

    // Extract description from details
    const description = product.details?.description || '';
    const strippedDescription = description.replace(/<[^>]*>/g, ''); // Remove HTML tags
    const shortDescription = strippedDescription.slice(0, 150);
    const needsReadMore = strippedDescription.length > 150;

    // Format created time
    const createdDate = product.details?.create_time
        ? new Date(product.details.create_time * 1000).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        })
        : null;

    // Calculate total stock from SKUs (same logic as ProductCard)
    const skus = product.skus || [];
    const totalStock = skus.reduce((sum, sku) => {
        const skuStock = sku.inventory?.reduce((s, inv) => s + inv.quantity, 0) || 0;
        return sum + skuStock;
    }, 0);
    const displayStock = totalStock > 0 ? totalStock : product.stock_quantity;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-gray-800 shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-800 p-6 flex justify-between items-center z-10">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Product Details</h2>
                        <p className="text-gray-400 text-sm">ID: {product.product_id}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={24} />
                    </button>
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
                                </div>
                                <p className="text-2xl font-bold text-white">{displayStock}</p>
                            </div>
                            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                                <div className="flex items-center gap-2 text-gray-400 mb-1">
                                    <BarChart2 size={16} />
                                    <span>Sales</span>
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
                                    <p className="text-gray-400 text-xs mb-1">GMV</p>
                                    <p className="text-lg font-bold text-white">
                                        {product.currency} {product.gmv?.toFixed(2) || '0.00'}
                                    </p>
                                </div>
                                <div className="bg-gray-800 p-3 rounded-xl border border-gray-700">
                                    <p className="text-gray-400 text-xs mb-1">Orders</p>
                                    <p className="text-lg font-bold text-white">{product.orders_count || 0}</p>
                                </div>
                                <div className="bg-gray-800 p-3 rounded-xl border border-gray-700">
                                    <p className="text-gray-400 text-xs mb-1">CTR</p>
                                    <p className="text-lg font-bold text-white">
                                        {((product.click_through_rate || 0) * 100).toFixed(2)}%
                                    </p>
                                </div>
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
                                <h3 className="text-lg font-semibold text-white">
                                    Variants ({product.skus.length})
                                </h3>
                                <div className="space-y-2">
                                    {product.skus.map((sku, index) => {
                                        const skuStock = sku.inventory?.reduce((sum, inv) => sum + inv.quantity, 0) || 0;
                                        const skuPrice = parseFloat(sku.price?.tax_exclusive_price || '0');
                                        const variantName = sku.sales_attributes
                                            ?.map(attr => `${attr.name}: ${attr.value_name}`)
                                            .join(', ') || `Variant ${index + 1}`;

                                        return (
                                            <div key={sku.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="flex-1">
                                                        <p className="text-white font-medium mb-2">{variantName}</p>
                                                        {sku.seller_sku && (
                                                            <p className="text-gray-400 text-xs mb-2">SKU: {sku.seller_sku}</p>
                                                        )}
                                                        <div className="flex gap-4 text-sm">
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
                                                        </div>
                                                    </div>
                                                    {sku.sales_attributes?.[0]?.sku_img?.urls?.[0] && (
                                                        <img
                                                            src={sku.sales_attributes[0].sku_img.urls[0]}
                                                            alt={variantName}
                                                            className="w-16 h-16 rounded-lg object-cover border border-gray-700"
                                                        />
                                                    )}
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
        </div>
    );
}
