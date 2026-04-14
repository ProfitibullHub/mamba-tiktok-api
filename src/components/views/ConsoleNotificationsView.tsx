import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConsoleNotificationStore, UserNotification } from '../../store/useConsoleNotificationStore';
import { Bell, Check, CheckCircle2, AlertCircle, Users, ExternalLink, RefreshCw, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
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
        if (type.includes('invite')) return <Users className="w-5 h-5 text-indigo-400" />;
        if (type.includes('suspend') || type.includes('remove')) return <AlertCircle className="w-5 h-5 text-red-500" />;
        if (type.includes('reactivate')) return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
        return <Bell className="w-5 h-5 text-pink-400" />;
    };

    const getBgColor = (type: string, isRead: boolean) => {
        if (isRead) return 'bg-white/[0.02] border-white/5 opacity-70';
        if (type.includes('invite')) return 'bg-indigo-500/10 border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]';
        if (type.includes('suspend') || type.includes('remove')) return 'bg-red-500/10 border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]';
        if (type.includes('reactivate')) return 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]';
        return 'bg-pink-500/10 border-pink-500/20 shadow-[0_0_15px_rgba(236,72,153,0.1)]';
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto h-full flex flex-col min-h-[600px]">
            {/* Header */}
            <div className="shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/[0.02] border border-white/10 p-6 rounded-3xl backdrop-blur-sm">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center border border-white/10 shadow-inner">
                        <Inbox className="w-6 h-6 text-pink-400" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                            Notifications
                            {unreadCount > 0 && (
                                <span className="px-3 py-1 rounded-full bg-pink-500/20 text-pink-400 text-sm font-bold border border-pink-500/30">
                                    {unreadCount} unread
                                </span>
                            )}
                        </h2>
                        <p className="text-gray-400 text-sm mt-1">Updates and alerts for your account and teams.</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex bg-black/40 rounded-xl p-1 border border-white/10">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                                filter === 'all' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-white/5'
                            }`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setFilter('unread')}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                                filter === 'unread' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-white/5'
                            }`}
                        >
                            Unread
                        </button>
                    </div>
                    
                    {unreadCount > 0 && (
                        <button
                            onClick={() => markAllAsRead()}
                            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-medium transition-colors border border-white/10"
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
                        <div className="h-64 flex flex-col items-center justify-center text-gray-400 gap-4">
                            <RefreshCw className="w-8 h-8 animate-spin text-pink-500" />
                            <p className="font-medium animate-pulse">Loading notifications...</p>
                        </div>
                    ) : filteredNotifications.length === 0 ? (
                        <div className="h-64 flex flex-col items-center justify-center text-gray-500 bg-white/[0.02] border border-white/10 rounded-3xl">
                            <Bell className="w-12 h-12 mb-4 opacity-20" />
                            <p className="text-lg font-medium text-gray-400">All caught up!</p>
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
                                            <h3 className={`text-base font-bold truncate ${notif.is_read ? 'text-gray-300' : 'text-white'}`}>
                                                {notif.title}
                                            </h3>
                                            <span className="shrink-0 text-xs font-mono text-gray-500">
                                                {new Date(notif.created_at).toLocaleString()}
                                            </span>
                                        </div>
                                        <p className={`text-sm leading-relaxed mb-4 ${notif.is_read ? 'text-gray-500' : 'text-gray-300'}`}>
                                            {notif.message}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                            {!notif.is_read && (
                                                <button
                                                    type="button"
                                                    onClick={() => markAsRead(notif.id)}
                                                    className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white transition-colors"
                                                >
                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                    Mark as read
                                                </button>
                                            )}
                                            {isStickyInvitationNotification(notif) &&
                                                inviteToken &&
                                                !inviteStillPending && (
                                                    <span className="text-xs text-gray-500">
                                                        This invitation was accepted, declined, or is no longer valid.
                                                    </span>
                                                )}
                                            {isStickyInvitationNotification(notif) &&
                                                inviteStillPending &&
                                                notif.action_url && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (!notif.is_read) void markAsRead(notif.id);
                                                            const path = notif.action_url!.startsWith('/')
                                                                ? notif.action_url!
                                                                : `/${notif.action_url!.replace(/^\//, '')}`;
                                                            navigate(path);
                                                        }}
                                                        className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-3 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 shadow-md shadow-violet-900/30 transition-all"
                                                    >
                                                        Accept invitation
                                                    </button>
                                                )}
                                            {notif.action_url &&
                                                (!isStickyInvitationNotification(notif) || inviteStillPending) && (
                                                    <a
                                                        href={notif.action_url}
                                                        onClick={() => !notif.is_read && markAsRead(notif.id)}
                                                        className="inline-flex items-center gap-1.5 text-xs font-bold text-pink-400 hover:text-pink-300 transition-colors"
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
                    <p className="text-sm text-gray-400 font-medium">
                        Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredNotifications.length)} of {filteredNotifications.length}
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="p-2 rounded-xl bg-white/[0.02] border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition-all"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <div className="px-4 py-2 roundeed-xl text-sm font-bold text-gray-300 flex items-center bg-black/20 border border-white/5 shadow-inner">
                            Page {currentPage} of {totalPages}
                        </div>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="p-2 rounded-xl bg-white/[0.02] border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition-all"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
