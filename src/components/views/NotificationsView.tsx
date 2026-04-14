import { useEffect, useMemo, useState } from 'react';
import { useNotificationStore } from '../../store/useNotificationStore';
import { Bell, Check, CheckCheck, MessageSquare, Package, ShoppingBag, RefreshCcw, Trash2, Pause, Play } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { Order } from '../../store/useShopStore';
import { OrderDetails } from '../OrderDetails';
import { formatShopDateTime } from '../../utils/dateUtils';

export function NotificationsView() {
    const notifications = useNotificationStore(state => state.notifications);
    const markAsRead = useNotificationStore(state => state.markAsRead);
    const markAllAsRead = useNotificationStore(state => state.markAllAsRead);
    const unreadCount = useNotificationStore(state => state.unreadCount);
    const setNavigationTarget = useNotificationStore(state => state.setNavigationTarget);
    const isPaused = useNotificationStore(state => state.isPaused);
    const togglePause = useNotificationStore(state => state.togglePause);
    const deleteAllNotifications = useNotificationStore(state => state.deleteAllNotifications);
    const activeShopIds = useNotificationStore(state => state.activeShopIds);

    const [filter, setFilter] = useState<'all' | 'unread'>('all');
    const [isDeleting, setIsDeleting] = useState(false);
    const [isTogglingPause, setIsTogglingPause] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 100;

    const [shopTimezones, setShopTimezones] = useState<Record<string, string>>({});

    useEffect(() => {
        let cancelled = false;

        async function loadTimezones() {
            if (!activeShopIds.length) return;
            const { data, error } = await supabase
                .from('tiktok_shops')
                .select('shop_id, timezone')
                .in('shop_id', activeShopIds);

            if (error) throw error;
            if (cancelled) return;

            const map: Record<string, string> = {};
            (data || []).forEach((s: any) => {
                map[String(s.shop_id)] = s.timezone || 'America/Los_Angeles';
            });
            setShopTimezones(map);
        }

        loadTimezones().catch((e) => {
            console.error('[NotificationsView] Failed to load shop timezones:', e);
        });

        return () => {
            cancelled = true;
        };
    }, [activeShopIds]);

    // Inline Order view state
    const [isLoadingOrderId, setIsLoadingOrderId] = useState<string | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

    const filteredNotifications = useMemo(() => {
        if (filter === 'unread') return notifications.filter(n => !n.is_read);
        return notifications;
    }, [notifications, filter]);

    // Reset pagination when filter changes
    useEffect(() => {
        setCurrentPage(1);
    }, [filter]);

    const paginatedNotifications = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        return filteredNotifications.slice(startIndex, startIndex + pageSize);
    }, [filteredNotifications, currentPage]);

    const totalPages = Math.ceil(filteredNotifications.length / pageSize);

    const getIcon = (category: string) => {
        switch (category) {
            case 'Order':
                return <ShoppingBag className="w-5 h-5 text-emerald-400" />;
            case 'Customer Service':
                return <MessageSquare className="w-5 h-5 text-blue-400" />;
            case 'Fulfillment':
                return <Package className="w-5 h-5 text-amber-400" />;
            case 'Reverse':
                return <RefreshCcw className="w-5 h-5 text-rose-400" />;
            default:
                return <Bell className="w-5 h-5 text-indigo-400" />;
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
        <>
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        <Bell className="w-6 h-6 text-pink-500" />
                        Today's Notifications
                        {unreadCount > 0 && (
                            <span className="bg-pink-500 text-white text-sm font-bold px-2.5 py-0.5 rounded-full">
                                {unreadCount} new
                            </span>
                        )}
                    </h1>
                    <p className="text-sm text-gray-400 mt-1">Real-time updates and alerts from TikTok Shop</p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                    <div className="bg-gray-800 rounded-lg p-1 border border-gray-700 flex">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === 'all' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setFilter('unread')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === 'unread' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                            Unread
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={async () => {
                                setIsTogglingPause(true);
                                await togglePause();
                                setIsTogglingPause(false);
                            }}
                            disabled={isTogglingPause}
                            className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-all text-sm font-medium ${
                                isPaused 
                                ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 hover:bg-amber-500/20' 
                                : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white hover:bg-gray-700'
                            } ${isTogglingPause ? 'opacity-50 cursor-wait' : ''}`}
                            title={isPaused ? "Resume system webhooks" : "Stop receiving system webhooks"}
                        >
                            {isTogglingPause ? (
                                <div className="w-4 h-4 border-2 border-current border-t-transparent animate-spin rounded-full" />
                            ) : (
                                isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />
                            )}
                            {isPaused ? 'Resume System' : 'Pause System'}
                        </button>

                        {unreadCount > 0 && (
                            <button
                                onClick={() => markAllAsRead()}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors text-sm font-medium"
                            >
                                <CheckCheck className="w-4 h-4" />
                                Mark all read
                            </button>
                        )}

                        {notifications.length > 0 && (
                            <button
                                onClick={async () => {
                                    if (confirm('Are you sure you want to delete all notifications from the database? This cannot be undone.')) {
                                        setIsDeleting(true);
                                        await deleteAllNotifications(activeShopIds);
                                        setIsDeleting(false);
                                    }
                                }}
                                disabled={isDeleting}
                                className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-all text-sm font-medium ${
                                    isDeleting
                                    ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                                    : 'bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/50 text-rose-400 hover:text-rose-300'
                                }`}
                            >
                                {isDeleting ? (
                                    <div className="w-4 h-4 border-2 border-rose-400 border-t-transparent animate-spin rounded-full" />
                                ) : (
                                    <Trash2 className="w-4 h-4" />
                                )}
                                {isDeleting ? 'Deleting...' : 'Delete all'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="space-y-3">
                {isPaused && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-center gap-3">
                        <Pause className="w-5 h-5 text-amber-500" />
                        <div className="text-sm text-amber-200">
                            <strong>System is Paused</strong>: Incoming TikTok webhooks are currently being discarded by the server. Resume to start receiving real-time updates again.
                        </div>
                    </div>
                )}

                {filteredNotifications.length === 0 ? (
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl py-12 flex flex-col items-center justify-center text-center">
                        <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4 border border-gray-700">
                            <Bell className="w-7 h-7 text-gray-500" />
                        </div>
                        <h3 className="text-lg font-medium text-white mb-1">No notifications found</h3>
                        <p className="text-sm text-gray-400">You're all caught up! Real-time events will appear here.</p>
                    </div>
                ) : (
                    paginatedNotifications.map((notif) => {
                        const tz = shopTimezones[notif.shop_id] || 'America/Los_Angeles';
                        return (
                            <div 
                                key={notif.id} 
                                onClick={async () => {
                                    const orderId = notif.raw_payload?.data?.order_id;
                                    if (!notif.is_read) markAsRead(notif.id);

                                    if (orderId) {
                                        setIsLoadingOrderId(orderId);
                                        try {
                                            const { data, error } = await supabase
                                                .from('shop_orders')
                                                .select('*')
                                                .eq('order_id', orderId)
                                                .maybeSingle();
                                        
                                            if (error) throw error;
                                            if (data) {
                                                setSelectedOrder(data as Order);
                                            } else {
                                                console.warn('Order not found in database:', orderId);
                                                alert('Order is currently syncing from TikTok, please try again in a few seconds.');
                                            }
                                        } catch (err) {
                                            console.error('Failed to fetch order details:', err);
                                        } finally {
                                            setIsLoadingOrderId(null);
                                        }
                                    } else if (notif.category === 'Order') {
                                        setNavigationTarget({ tab: 'orders' });
                                    }
                                }}
                                className={`relative flex items-start gap-4 p-5 rounded-2xl border transition-all cursor-pointer group ${
                                    notif.is_read 
                                    ? 'bg-gray-900/40 border-gray-800/40 hover:bg-gray-800/40 hover:border-gray-700/40' 
                                    : 'bg-gray-900 border-gray-700 shadow-lg hover:bg-gray-800 hover:border-pink-500/30'
                                }`}
                            >
                                {isLoadingOrderId === notif.raw_payload?.data?.order_id && (
                                    <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm rounded-2xl flex items-center justify-center z-10">
                                        <div className="w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                                    </div>
                                )}
                                <div className={`w-12 h-12 shrink-0 rounded-full flex items-center justify-center ${getBgColor(notif.category)}`}>
                                    {getIcon(notif.category)}
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-4 mb-1">
                                        <h4 className={`text-base font-semibold truncate group-hover:text-pink-400 transition-colors ${notif.is_read ? 'text-gray-400' : 'text-gray-100'}`}>
                                            {notif.title}
                                        </h4>
                                        <span className="text-xs text-gray-500 shrink-0 whitespace-nowrap">
                                            {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                                        </span>
                                    </div>
                                    <p className={`text-sm mb-3 ${notif.is_read ? 'text-gray-500' : 'text-gray-300'}`}>
                                        {notif.message}
                                    </p>

                                    {/* Timestamp Section */}
                                    <div className="flex flex-wrap items-center gap-2 mb-4">
                                        <div className="flex items-center gap-1 text-[10px] text-gray-500 bg-gray-800/50 px-2 py-0.5 rounded border border-gray-700/30">
                                            <span>Received:</span>
                                            <span className="font-medium text-gray-400">{formatShopDateTime(notif.created_at, tz)}</span>
                                        </div>
                                        {notif.raw_payload?.data?.update_time && (
                                            <div className="flex items-center gap-1 text-[10px] text-pink-400/90 bg-pink-500/10 px-2 py-0.5 rounded border border-pink-500/20">
                                                <span>Event Time:</span>
                                                <span className="font-semibold">{formatShopDateTime(notif.raw_payload.data.update_time * 1000, tz)}</span>
                                            </div>
                                        )}
                                    </div>
                                
                                    <div className="mt-auto flex items-center gap-3">
                                        <span className="text-xs font-semibold tracking-wide px-2.5 py-1 bg-gray-800 border border-gray-700 rounded-md text-gray-400 group-hover:border-gray-600 transition-colors">
                                            {notif.category.toUpperCase()}
                                        </span>
                                        
                                        {!notif.is_read && (
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    markAsRead(notif.id);
                                                }}
                                                className="flex items-center gap-1.5 text-xs font-medium text-pink-400 hover:text-pink-300 transition-colors"
                                            >
                                                <Check className="w-3.5 h-3.5" />
                                                Mark as read
                                            </button>
                                        )}
                                    </div>
                                </div>
                                
                                {!notif.is_read && (
                                    <div className="w-2.5 h-2.5 rounded-full bg-pink-500 shrink-0 mt-2 shadow-[0_0_8px_rgba(236,72,153,0.8)]" />
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-2xl p-4 mt-6">
                    <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-4 py-2 text-sm font-medium border border-gray-700 rounded-lg disabled:opacity-50 text-white hover:bg-gray-800 transition-colors"
                    >
                        Previous
                    </button>
                    <span className="text-sm text-gray-400">
                        Page <strong className="text-white">{currentPage}</strong> of <strong className="text-white">{totalPages}</strong>
                    </span>
                    <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-4 py-2 text-sm font-medium border border-gray-700 rounded-lg disabled:opacity-50 text-white hover:bg-gray-800 transition-colors"
                    >
                        Next
                    </button>
                </div>
            )}
        </div>

        {selectedOrder && (
            <OrderDetails 
                order={selectedOrder}
                onClose={() => setSelectedOrder(null)}
            />
        )}
        </>
    );
}
