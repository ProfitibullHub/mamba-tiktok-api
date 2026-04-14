import { useEffect, useState } from 'react';
import { Bell, MessageSquare, Package, ShoppingBag, RefreshCcw } from 'lucide-react';
import { useNotificationStore, WebhookNotification } from '../store/useNotificationStore';

const AUTO_DISMISS_MS = 4000;

export function NotificationToast() {
    const activeToasts = useNotificationStore(state => state.activeToasts);
    const removeActiveToast = useNotificationStore(state => state.removeActiveToast);
    const setNavigationTarget = useNotificationStore(state => state.setNavigationTarget);

    if (activeToasts.length === 0) return null;

    // The container uses flex-col to automatically stack multiple incoming notifications. 
    // pointer-events-none stops the invisible container from blocking the screen, 
    // while pointer-events-auto on the children re-enables clicks.
    return (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-3 pointer-events-none">
            {activeToasts.map((toast) => (
                <ToastItem 
                    key={toast.id} 
                    toast={toast} 
                    removeToast={removeActiveToast} 
                    setNavigationTarget={setNavigationTarget} 
                />
            ))}
        </div>
    );
}

function ToastItem({ 
    toast, 
    removeToast, 
    setNavigationTarget 
}: { 
    toast: WebhookNotification; 
    removeToast: (id: string) => void;
    setNavigationTarget: (target: { tab: string; orderId?: string }) => void;
}) {
    const [visible, setVisible] = useState(false);
    const [mounted, setMounted] = useState(true);

    useEffect(() => {
        // Minor delay to ensure entering animation triggers correctly
        const mountTimer = setTimeout(() => {
            setVisible(true);
        }, 50);

        const dismissTimer = setTimeout(() => {
            setVisible(false);
            // Small delay so fade-out animation plays before clearing state
            setTimeout(() => {
                setMounted(false);
                removeToast(toast.id);
            }, 400);
        }, AUTO_DISMISS_MS);

        return () => {
            clearTimeout(mountTimer);
            clearTimeout(dismissTimer);
        };
    }, [toast.id, removeToast]);

    if (!mounted) return null;

    const getIcon = (category: string) => {
        switch (category) {
            case 'Order':
                return <ShoppingBag className="h-5 w-5 text-emerald-400" />;
            case 'Customer Service':
                return <MessageSquare className="h-5 w-5 text-blue-400" />;
            case 'Fulfillment':
                return <Package className="h-5 w-5 text-amber-400" />;
            case 'Reverse':
                return <RefreshCcw className="h-5 w-5 text-rose-400" />;
            default:
                return <Bell className="h-5 w-5 text-indigo-400" />;
        }
    };

    const getBgColor = (category: string) => {
        switch (category) {
            case 'Order': return 'bg-emerald-500/20';
            case 'Customer Service': return 'bg-blue-500/20';
            case 'Fulfillment': return 'bg-amber-500/20';
            case 'Reverse': return 'bg-rose-500/20';
            default: return 'bg-indigo-500/20';
        }
    };

    return (
        <div
            className={`flex items-center gap-4 rounded-2xl bg-gray-900/95 backdrop-blur-md px-5 py-4 shadow-2xl border border-gray-700/50 transition-all duration-500 ease-out cursor-pointer hover:bg-gray-800/95 pointer-events-auto ${
                visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-8 scale-95'
            }`}
            onClick={() => {
                const orderId = toast.raw_payload?.data?.order_id;
                if (orderId) {
                    setNavigationTarget({ tab: 'orders', orderId });
                } else if (toast.category === 'Order') {
                    setNavigationTarget({ tab: 'orders' });
                }
                setVisible(false);
                setTimeout(() => {
                    setMounted(false);
                    removeToast(toast.id);
                }, 400);
            }}
        >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${getBgColor(toast.category)}`}>
                {getIcon(toast.category)}
            </div>
            <div className="flex flex-col pr-4">
                <span className="text-sm font-semibold text-white">
                    {toast.title}
                </span>
                <span className="text-sm text-gray-300">{toast.message}</span>
            </div>
        </div>
    );
}
