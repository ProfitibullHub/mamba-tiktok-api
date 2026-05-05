import { Package, BarChart2, AlertCircle, DollarSign } from 'lucide-react';
import { Product } from '../store/useShopStore';

interface ProductCardProps {
    product: Product;
    onClick: () => void;
    salesCount?: number;
}

export function ProductCard({ product, onClick, salesCount }: ProductCardProps) {
    const getStatusColor = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'active': return 'brand-state-success';
            case 'inactive': return 'brand-card brand-muted';
            case 'frozen': return 'brand-state-info';
            case 'deleted': return 'brand-state-danger';
            default: return 'brand-card brand-muted';
        }
    };

    // Calculate SKU information
    const skus = product.skus || [];
    const hasMultipleSkus = skus.length > 1;

    // Get price range if multiple SKUs with different prices
    const prices = skus.map(sku => parseFloat(sku.price?.tax_exclusive_price || '0'));
    const minPrice = prices.length > 0 ? Math.min(...prices) : product.price;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : product.price;
    const hasPriceRange = minPrice !== maxPrice;

    // Calculate total stock across all SKUs
    const totalStock = skus.reduce((sum, sku) => {
        const skuStock = sku.inventory?.reduce((s, inv) => s + inv.quantity, 0) || 0;
        return sum + skuStock;
    }, 0);
    const displayStock = totalStock > 0 ? totalStock : product.stock_quantity;

    return (
        <div
            onClick={onClick}
            className="brand-card rounded-xl p-4 transition-all cursor-pointer group flex flex-col h-full brand-card-hover"
        >
            <div className="relative aspect-square mb-4 rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--brand-interactive-hover-bg)' }}>
                {product.main_image_url ? (
                    <img
                        src={product.main_image_url}
                        alt={product.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Package size={48} className="brand-muted" />
                    </div>
                )}
                <div className="absolute top-2 right-2 flex gap-2 ">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(product.status)}`}>
                        {product.status}
                    </span>
                    {product.is_fbt && (
                        <span className="px-2 py-1 rounded-full text-xs font-medium brand-state-info" title="Fulfilled by TikTok">
                            FBT
                        </span>
                    )}
                    {hasMultipleSkus && (
                        <span className="px-2 py-1 rounded-full text-xs font-medium" style={{ color: 'var(--brand-primary)', backgroundColor: 'var(--brand-interactive-hover-bg)', border: '1px solid var(--brand-card-border)' }}>
                            {skus.length} variants
                        </span>
                    )}
                </div>
            </div>

            <div className="flex-1">
                <h3 className="brand-text font-medium line-clamp-2 mb-2 h-12" title={product.name}>
                    {product.name}
                </h3>

                <div className="flex items-baseline gap-1 mb-4">
                    {hasPriceRange ? (
                        <span className="text-lg font-bold" style={{ color: 'var(--brand-primary)' }}>
                            {product.currency} {minPrice.toFixed(2)} - {maxPrice.toFixed(2)}
                        </span>
                    ) : (
                        <span className="text-lg font-bold" style={{ color: 'var(--brand-primary)' }}>
                            {product.currency} {product.price}
                        </span>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--brand-interactive-hover-bg)' }}>
                        <p className="brand-muted text-xs mb-1">Stock</p>
                        <p className="brand-text font-medium flex items-center gap-1">
                            <Package size={12} />
                            {displayStock}
                        </p>
                    </div>
                    <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--brand-interactive-hover-bg)' }}>
                        <p className="brand-muted text-xs mb-1">Sales</p>
                        <p className="brand-text font-medium flex items-center gap-1">
                            <BarChart2 size={12} />
                            {salesCount !== undefined ? salesCount : product.sales_count}
                        </p>
                    </div>
                </div>
            </div>

            {displayStock === 0 && (
                <div className="mt-3 flex items-center gap-2 text-xs p-2 rounded-lg brand-state-danger">
                    <AlertCircle size={12} />
                    <span>Out of stock</span>
                </div>
            )}

            {/* Show COGS missing indicator for all products without COGS */}
            {(product.cogs === null || product.cogs === undefined || product.cogs === 0) && (
                <div className="mt-3 flex items-center gap-2 text-xs p-2 rounded-lg brand-state-warning">
                    <DollarSign size={12} />
                    <span>COGS not set — Click to add</span>
                </div>
            )}
        </div>
    );
}
