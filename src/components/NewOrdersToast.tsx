import { useEffect, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { useShopStore } from '../store/useShopStore';

const AUTO_DISMISS_MS = 4000;

export function NewOrdersToast() {
    const notification = useShopStore(state => state.newOrdersNotification);
    const clearNewOrdersNotification = useShopStore(state => state.clearNewOrdersNotification);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!notification) {
            setVisible(false);
            return;
        }

        setVisible(true);
        const timer = setTimeout(() => {
            setVisible(false);
            // Small delay so fade-out animation plays before clearing state
            setTimeout(clearNewOrdersNotification, 300);
        }, AUTO_DISMISS_MS);

        return () => clearTimeout(timer);
    }, [notification]);

    if (!notification) return null;

    return (
        <div
            className={`fixed top-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-2xl bg-gray-900/95 backdrop-blur-md px-5 py-3.5 shadow-2xl border border-gray-700/50 transition-all duration-400 ease-out ${
                visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-95 pointer-events-none'
            }`}
        >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/20">
                <ShoppingBag className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="flex flex-col">
                <span className="text-sm font-semibold text-white">
                    {notification.count} new order{notification.count !== 1 ? 's' : ''} found
                </span>
                <span className="text-xs text-gray-400">Synced in the background</span>
            </div>
        </div>
    );
}
