import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConsoleNotificationStore, UserNotification } from '../../store/useConsoleNotificationStore';
import { Bell, Check, CheckCircle2, AlertCircle, Users, ExternalLink, RefreshCw, ChevronLeft, ChevronRight, Inbox, Trash2 } from 'lucide-react';
import {
    extractInvitationTokenFromActionUrl,
    isStickyInvitationNotification,
} from '../../lib/teamInviteNotifications';
import { usePendingMembershipInvites } from '../../hooks/usePendingMembershipInvites';

export function ConsoleNotificationsView() {
    const navigate = useNavigate();
    const notifications = useConsoleNotificationStore((state) => state.notifications);
    const markAsRead = useConsoleNotificationStore((state) => state.markAsRead);
    const markAllAsRead = useConsoleNotificationStore((state) => state.markAllAsRead);
    const deleteNotification = useConsoleNotificationStore((state) => state.deleteNotification);
    const unreadCount = useConsoleNotificationStore((state) => state.unreadCount);
    const isLoading = useConsoleNotificationStore((state) => state.isLoading);
    const { data: pendingInvites = [] } = usePendingMembershipInvites(true);

    const [currentPage, setCurrentPage] = useState(1);
    const [filter, setFilter] = useState<'all' | 'unread'>('all');
    const pageSize = 100; // Requirement: max 100 notifications per page

    const filteredNotifications = useMemo(() => {
        let result = notifications;
        if (filter === 'unread') {
            result = result.filter(n => !n.is_read);
        }
        return result;
    }, [notifications, filter]);

    const paginatedNotifications = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        return filteredNotifications.slice(startIndex, startIndex + pageSize);
    }, [filteredNotifications, currentPage]);

    const totalPages = Math.max(1, Math.ceil(filteredNotifications.length / pageSize));

    // Reset to page 1 if filter changes
    useEffect(() => {
        setCurrentPage(1);
    }, [filter]);

    const getIcon = (type: string) => {
        if (type.includes('invite')) return <Users className="w-5 h-5" style={{ color: 'var(--brand-secondary)' }} />;
        if (type.includes('suspend') || type.includes('remove')) return <AlertCircle className="w-5 h-5" style={{ color: 'var(--brand-danger-text)' }} />;
        if (type.includes('reactivate')) return <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--brand-success-text)' }} />;
        return <Bell className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />;
    };

    const getBgColor = (type: string, isRead: boolean) => {
        if (isRead) return 'brand-card opacity-70';
        if (type.includes('invite')) return 'brand-secondary-card shadow-lg';
        if (type.includes('suspend') || type.includes('remove')) return 'brand-state-danger shadow-lg';
        if (type.includes('reactivate')) return 'brand-state-success shadow-lg';
        return 'brand-primary-card shadow-lg';
    };

    const isSellerLinkInvite = (notif: UserNotification) => notif.type === 'seller_link_invite';

    return (
        <div className="w-full max-w-none space-y-6 h-full flex flex-col min-h-[600px]">
            {/* Header */}
            <div className="shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4 brand-card p-6 rounded-3xl">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl brand-primary-card flex items-center justify-center shadow-inner">
                        <Inbox className="w-6 h-6" style={{ color: 'var(--brand-primary)' }} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold brand-text flex items-center gap-3">
                            Notifications
                            {unreadCount > 0 && (
                                <span className="px-3 py-1 rounded-full brand-primary-card text-sm font-bold">
                                    {unreadCount} unread
                                </span>
                            )}
                        </h2>
                        <p className="brand-muted text-sm mt-1">Updates and alerts for your account and teams.</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex brand-toolbar rounded-xl p-1">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                                filter === 'all' ? 'brand-card brand-text shadow-sm' : 'brand-muted brand-nav-idle'
                            }`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setFilter('unread')}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                                filter === 'unread' ? 'brand-card brand-text shadow-sm' : 'brand-muted brand-nav-idle'
                            }`}
                        >
                            Unread
                        </button>
                    </div>
                    
                    {unreadCount > 0 && (
                        <button
                            onClick={() => markAllAsRead()}
                            className="flex items-center gap-2 px-4 py-2 brand-card brand-text brand-card-hover rounded-xl text-sm font-medium transition-colors"
                        >
                            <Check className="w-4 h-4" />
                            Mark all read
                        </button>
                    )}
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0 relative">
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3 pb-8">
                    {isLoading ? (
                        <div className="h-64 flex flex-col items-center justify-center brand-muted gap-4">
                            <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--brand-primary)' }} />
                            <p className="font-medium animate-pulse">Loading notifications...</p>
                        </div>
                    ) : filteredNotifications.length === 0 ? (
                        <div className="h-64 flex flex-col items-center justify-center brand-muted brand-card rounded-3xl">
                            <Bell className="w-12 h-12 mb-4 opacity-20" />
                            <p className="text-lg font-medium brand-text">All caught up!</p>
                            <p className="text-sm mt-1">You have no {filter === 'unread' ? 'unread ' : ''}notifications.</p>
                        </div>
                    ) : (
                        paginatedNotifications.map((notif: UserNotification) => {
                            const inviteToken = isStickyInvitationNotification(notif)
                                ? extractInvitationTokenFromActionUrl(notif.action_url)
                                : null;
                            const inviteStillPending =
                                !!inviteToken && pendingInvites.some((p) => p.token === inviteToken);

                            return (
                            <div
                                key={notif.id}
                                className={`group p-5 rounded-2xl border transition-all duration-300 ${getBgColor(notif.type, notif.is_read)}`}
                            >
                                <div className="flex gap-4">
                                    <div className="shrink-0 mt-1">
                                        {getIcon(notif.type)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-4 mb-1">
                                            <h3 className={`text-base font-bold truncate ${notif.is_read ? 'brand-muted' : 'brand-text'}`}>
                                                {notif.title}
                                            </h3>
                                            <span className="shrink-0 text-xs font-mono brand-muted">
                                                {new Date(notif.created_at).toLocaleString()}
                                            </span>
                                        </div>
                                        <p className={`text-sm leading-relaxed mb-4 ${notif.is_read ? 'brand-muted' : 'brand-text'}`}>
                                            {notif.message}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                            {!notif.is_read && (
                                                <button
                                                    type="button"
                                                    onClick={() => markAsRead(notif.id)}
                                                    className="inline-flex items-center gap-1.5 text-xs font-bold brand-nav-idle transition-colors"
                                                >
                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                    Mark as read
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => deleteNotification(notif.id)}
                                                className="inline-flex items-center gap-1.5 text-xs font-bold text-red-300 hover:text-red-200 transition-colors"
                                                title="Delete notification"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                Delete
                                            </button>
                                            {isStickyInvitationNotification(notif) &&
                                                !isSellerLinkInvite(notif) &&
                                                inviteToken &&
                                                !inviteStillPending && (
                                                    <span className="text-xs brand-muted">
                                                        This invitation was accepted, declined, or is no longer valid.
                                                    </span>
                                                )}
                                            {isStickyInvitationNotification(notif) &&
                                                (isSellerLinkInvite(notif) || inviteStillPending) &&
                                                notif.action_url && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (!notif.is_read) void markAsRead(notif.id);
                                                            let path = notif.action_url!.startsWith('/')
                                                                ? notif.action_url!
                                                                : `/${notif.action_url!.replace(/^\//, '')}`;
                                                            // Backward compatibility for older seller-link notifications.
                                                            if (notif.type === 'seller_link_invite' && path.startsWith('/accept-seller-link')) {
                                                                const token = extractInvitationTokenFromActionUrl(path);
                                                                if (token) {
                                                                    path = `/accept-invitation?type=seller-link&token=${token}`;
                                                                }
                                                            }
                                                            navigate(path);
                                                        }}
                                                        className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl shadow-md transition-all brand-on-primary"
                                                        style={{ backgroundColor: 'var(--brand-primary)' }}
                                                    >
                                                        Accept invitation
                                                    </button>
                                                )}
                                            {notif.action_url &&
                                                (!isStickyInvitationNotification(notif) ||
                                                    isSellerLinkInvite(notif) ||
                                                    inviteStillPending) && (
                                                    <a
                                                        href={notif.action_url}
                                                        onClick={() => !notif.is_read && markAsRead(notif.id)}
                                                        className="inline-flex items-center gap-1.5 text-xs font-bold transition-colors"
                                                        style={{ color: 'var(--brand-primary)' }}
                                                    >
                                                        {isStickyInvitationNotification(notif)
                                                            ? 'Open in new tab'
                                                            : 'View details'}
                                                        <ExternalLink className="w-3.5 h-3.5" />
                                                    </a>
                                                )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="shrink-0 flex items-center justify-between py-4 border-t border-white/10 mt-auto">
                    <p className="text-sm brand-muted font-medium">
                        Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredNotifications.length)} of {filteredNotifications.length}
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="p-2 rounded-xl brand-card brand-nav-idle disabled:opacity-30 disabled:pointer-events-none transition-all"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <div className="px-4 py-2 rounded-xl text-sm font-bold brand-text flex items-center brand-toolbar shadow-inner">
                            Page {currentPage} of {totalPages}
                        </div>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="p-2 rounded-xl brand-card brand-nav-idle disabled:opacity-30 disabled:pointer-events-none transition-all"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
