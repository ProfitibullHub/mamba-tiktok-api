import { useShopStore } from '../store/useShopStore';
import { Loader2, CheckCircle2, Package, ShoppingCart, DollarSign, XCircle } from 'lucide-react';

export function SyncProgressBar() {
    const { syncProgress, cancelSync } = useShopStore();

    if (!syncProgress.isActive && !syncProgress.message) {
        return null;
    }

    const getStepIcon = (step: string, isComplete: boolean, isCurrent: boolean) => {
        const iconClass = isComplete
            ? 'text-green-400'
            : isCurrent
                ? 'text-pink-400 animate-pulse'
                : 'text-gray-500';

        const icons: Record<string, React.ReactNode> = {
            orders: <ShoppingCart className={`w-5 h-5 ${iconClass}`} />,
            products: <Package className={`w-5 h-5 ${iconClass}`} />,
            settlements: <DollarSign className={`w-5 h-5 ${iconClass}`} />,
        };
        return icons[step] || null;
    };

    return (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-right-2 duration-300">
            <div className="bg-gray-900/95 backdrop-blur-xl border border-gray-700 rounded-2xl shadow-2xl p-4 min-w-[320px]">
                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                    {syncProgress.currentStep !== 'complete' ? (
                        <Loader2 className="w-5 h-5 text-pink-400 animate-spin" />
                    ) : (
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                    )}
                    <span className="text-white font-medium">
                        {syncProgress.isFirstSync ? 'First Time Sync' : 'Syncing Data'}
                    </span>

                    {/* Terminate Button */}
                    <button
                        onClick={cancelSync}
                        className="ml-auto text-gray-400 hover:text-red-400 transition-colors p-1"
                        title="Terminate Sync"
                    >
                        <XCircle className="w-5 h-5" />
                    </button>
                </div>

                {/* Message */}
                <p className="text-sm text-gray-300 mb-4">{syncProgress.message}</p>

                {/* Progress Steps */}
                <div className="flex items-center justify-between gap-2">
                    {/* Orders */}
                    <div className={`flex flex-col items-center gap-1 flex-1 p-2 rounded-lg ${syncProgress.currentStep === 'orders' ? 'bg-pink-500/10' :
                        syncProgress.ordersComplete ? 'bg-green-500/10' : 'bg-gray-800'
                        }`}>
                        {getStepIcon('orders', syncProgress.ordersComplete, syncProgress.currentStep === 'orders')}
                        <span className="text-xs text-gray-400">Orders</span>
                        {syncProgress.ordersComplete && syncProgress.ordersFetched > 0 && (
                            <span className="text-xs text-green-400">{syncProgress.ordersFetched}</span>
                        )}
                    </div>

                    {/* Connector */}
                    <div className={`h-0.5 w-4 ${syncProgress.ordersComplete ? 'bg-green-500' : 'bg-gray-700'}`} />

                    {/* Products */}
                    <div className={`flex flex-col items-center gap-1 flex-1 p-2 rounded-lg ${syncProgress.currentStep === 'products' ? 'bg-pink-500/10' :
                        syncProgress.productsComplete ? 'bg-green-500/10' : 'bg-gray-800'
                        }`}>
                        {getStepIcon('products', syncProgress.productsComplete, syncProgress.currentStep === 'products')}
                        <span className="text-xs text-gray-400">Products</span>
                        {syncProgress.productsComplete && syncProgress.productsFetched > 0 && (
                            <span className="text-xs text-green-400">{syncProgress.productsFetched}</span>
                        )}
                    </div>

                    {/* Connector */}
                    <div className={`h-0.5 w-4 ${syncProgress.productsComplete ? 'bg-green-500' : 'bg-gray-700'}`} />

                    {/* Settlements */}
                    <div className={`flex flex-col items-center gap-1 flex-1 p-2 rounded-lg ${syncProgress.currentStep === 'settlements' ? 'bg-pink-500/10' :
                        syncProgress.settlementsComplete ? 'bg-green-500/10' : 'bg-gray-800'
                        }`}>
                        {getStepIcon('settlements', syncProgress.settlementsComplete, syncProgress.currentStep === 'settlements')}
                        <span className="text-xs text-gray-400">Finance</span>
                        {syncProgress.settlementsComplete && syncProgress.settlementsFetched > 0 && (
                            <span className="text-xs text-green-400">{syncProgress.settlementsFetched}</span>
                        )}
                    </div>
                </div>

                {/* First Sync Warning */}
                {syncProgress.isFirstSync && syncProgress.currentStep !== 'complete' && (
                    <p className="text-xs text-yellow-400/80 mt-3 text-center">
                        ⏳ This is your first sync. Please be patient...
                    </p>
                )}
            </div>
        </div>
    );
}
