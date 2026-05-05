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
                return <ShoppingBag className="w-5 h-5" style={{ color: 'var(--brand-success-text)' }} />;
            case 'Customer Service':
                return <MessageSquare className="w-5 h-5" style={{ color: 'var(--brand-info-text)' }} />;
            case 'Fulfillment':
                return <Package className="w-5 h-5" style={{ color: 'var(--brand-warning-text)' }} />;
            case 'Reverse':
                return <RefreshCcw className="w-5 h-5" style={{ color: 'var(--brand-danger-text)' }} />;
            default:
                return <Bell className="w-5 h-5" style={{ color: 'var(--brand-secondary)' }} />;
        }
    };

    const getBgColor = (category: string) => {
        switch (category) {
            case 'Order': return 'var(--brand-success-bg)';
            case 'Customer Service': return 'var(--brand-info-bg)';
            case 'Fulfillment': return 'var(--brand-warning-bg)';
            case 'Reverse': return 'var(--brand-danger-bg)';
            default: return 'var(--brand-secondary-card-bg)';
        }
    };

    return (
        <>
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 brand-card rounded-2xl p-6">
                <div>
                    <h1 className="text-2xl font-bold brand-text flex items-center gap-3">
                        <Bell className="w-6 h-6" style={{ color: 'var(--brand-primary)' }} />
                        Today's Notifications
                        {unreadCount > 0 && (
                            <span className="text-sm font-bold px-2.5 py-0.5 rounded-full brand-on-primary" style={{ backgroundColor: 'var(--brand-primary)' }}>
                                {unreadCount} new
                            </span>
                        )}
                    </h1>
                    <p className="text-sm brand-muted mt-1">Real-time updates and alerts from TikTok Shop</p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                    <div className="brand-toolbar rounded-lg p-1 flex">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === 'all' ? 'brand-card brand-text shadow' : 'brand-muted brand-nav-idle'}`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setFilter('unread')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === 'unread' ? 'brand-card brand-text shadow' : 'brand-muted brand-nav-idle'}`}
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
                                ? 'brand-state-warning' 
                                : 'brand-card brand-text brand-card-hover'
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
                                className="flex items-center gap-2 px-4 py-2 brand-card brand-text brand-card-hover rounded-lg transition-colors text-sm font-medium"
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
                                    ? 'brand-card brand-muted cursor-not-allowed'
                                    : 'brand-state-danger'
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
                    <div className="brand-state-warning rounded-2xl p-4 flex items-center gap-3">
                        <Pause className="w-5 h-5" style={{ color: 'var(--brand-warning-text)' }} />
                        <div className="text-sm">
                            <strong>System is Paused</strong>: Incoming TikTok webhooks are currently being discarded by the server. Resume to start receiving real-time updates again.
                        </div>
                    </div>
                )}

                {filteredNotifications.length === 0 ? (
                    <div className="brand-card rounded-2xl py-12 flex flex-col items-center justify-center text-center">
                        <div className="w-16 h-16 brand-toolbar rounded-full flex items-center justify-center mb-4">
                            <Bell className="w-7 h-7 brand-muted" />
                        </div>
                        <h3 className="text-lg font-medium brand-text mb-1">No notifications found</h3>
                        <p className="text-sm brand-muted">You're all caught up! Real-time events will appear here.</p>
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
                                    ? 'brand-card opacity-70 brand-card-hover' 
                                    : 'brand-card shadow-lg brand-card-hover'
                                }`}
                            >
                                {isLoadingOrderId === notif.raw_payload?.data?.order_id && (
                                    <div className="absolute inset-0 rounded-2xl flex items-center justify-center z-10" style={{ backgroundColor: 'color-mix(in srgb, var(--brand-bg) 72%, transparent)' }}>
                                        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-primary)', borderTopColor: 'transparent' }} />
                                    </div>
                                )}
                                <div className="w-12 h-12 shrink-0 rounded-full flex items-center justify-center" style={{ backgroundColor: getBgColor(notif.category) }}>
                                    {getIcon(notif.category)}
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-4 mb-1">
                                        <h4 className={`text-base font-semibold truncate transition-colors ${notif.is_read ? 'brand-muted' : 'brand-text'}`}>
                                            {notif.title}
                                        </h4>
                                        <span className="text-xs brand-muted shrink-0 whitespace-nowrap">
                                            {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                                        </span>
                                    </div>
                                    <p className={`text-sm mb-3 ${notif.is_read ? 'brand-muted' : 'brand-text'}`}>
                                        {notif.message}
                                    </p>

                                    {/* Timestamp Section */}
                                    <div className="flex flex-wrap items-center gap-2 mb-4">
                                        <div className="flex items-center gap-1 text-[10px] brand-muted brand-card px-2 py-0.5 rounded">
                                            <span>Received:</span>
                                            <span className="font-medium brand-text">{formatShopDateTime(notif.created_at, tz)}</span>
                                        </div>
                                        {notif.raw_payload?.data?.update_time && (
                                            <div className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded brand-primary-card">
                                                <span>Event Time:</span>
                                                <span className="font-semibold">{formatShopDateTime(notif.raw_payload.data.update_time * 1000, tz)}</span>
                                            </div>
                                        )}
                                    </div>
                                
                                    <div className="mt-auto flex items-center gap-3">
                                        <span className="text-xs font-semibold tracking-wide px-2.5 py-1 rounded-md brand-card brand-muted transition-colors">
                                            {notif.category.toUpperCase()}
                                        </span>
                                        
                                        {!notif.is_read && (
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    markAsRead(notif.id);
                                                }}
                                                className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                                                style={{ color: 'var(--brand-primary)' }}
                                            >
                                                <Check className="w-3.5 h-3.5" />
                                                Mark as read
                                            </button>
                                        )}
                                    </div>
                                </div>
                                
                                {!notif.is_read && (
                                    <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-2" style={{ backgroundColor: 'var(--brand-primary)' }} />
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-between brand-card rounded-2xl p-4 mt-6">
                    <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 brand-card brand-text brand-card-hover transition-colors"
                    >
                        Previous
                    </button>
                    <span className="text-sm brand-muted">
                        Page <strong className="brand-text">{currentPage}</strong> of <strong className="brand-text">{totalPages}</strong>
                    </span>
                    <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 brand-card brand-text brand-card-hover transition-colors"
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
