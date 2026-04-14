import { useMemo, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, X } from 'lucide-react';
import { useConsoleNotificationStore } from '../store/useConsoleNotificationStore';
import {
    extractInvitationTokenFromActionUrl,
    loadDismissedInvitationBannerTokens,
    mergeLegacyDismissedBannerIdsIntoTokens,
    saveDismissedInvitationBannerTokens,
} from '../lib/teamInviteNotifications';
import { usePendingMembershipInvites } from '../hooks/usePendingMembershipInvites';

type Props = {
    /** Only show on console home, per product request */
    activeTab: string;
    onOpenNotifications: () => void;
};

export function TeamInvitationStickyToast({ activeTab, onOpenNotifications }: Props) {
    const navigate = useNavigate();
    const notifications = useConsoleNotificationStore((s) => s.notifications);

    const { data: pendingInvites = [], isLoading } = usePendingMembershipInvites(activeTab === 'home');

    const [dismissedTokens, setDismissedTokens] = useState<Set<string>>(loadDismissedInvitationBannerTokens);

    useEffect(() => {
        setDismissedTokens((prev) => mergeLegacyDismissedBannerIdsIntoTokens(prev, notifications));
    }, [notifications]);

    const visible = useMemo(
        () => pendingInvites.filter((p) => !dismissedTokens.has(p.token)),
        [pendingInvites, dismissedTokens]
    );

    const primary = visible[0];
    const moreCount = Math.max(0, visible.length - 1);

    const message = useMemo(() => {
        if (!primary) return null;
        const match = notifications.find(
            (n) => extractInvitationTokenFromActionUrl(n.action_url) === primary.token
        );
        return match?.message ?? null;
    }, [primary, notifications]);

    const dismiss = useCallback((token: string) => {
        setDismissedTokens((prev) => {
            const next = new Set(prev);
            next.add(token);
            saveDismissedInvitationBannerTokens(next);
            return next;
        });
    }, []);

    const goAccept = useCallback(
        (acceptPath: string) => {
            navigate(acceptPath.startsWith('/') ? acceptPath : `/${acceptPath.replace(/^\//, '')}`);
        },
        [navigate]
    );

    if (activeTab !== 'home' || isLoading || !primary) return null;

    return (
        <div
            role="alert"
            className="fixed z-[10000] w-[min(22rem,calc(100vw-2rem))] animate-in slide-in-from-top-4 fade-in duration-300"
            style={{ top: '1.25rem', right: '1.25rem' }}
        >
            <div className="rounded-2xl border border-violet-500/35 bg-gray-950/95 backdrop-blur-xl shadow-2xl shadow-black/50 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-600/15 via-transparent to-pink-600/10 pointer-events-none" />
                <div className="relative p-4">
                    <div className="flex gap-3">
                        <div className="shrink-0 p-2 rounded-xl bg-violet-500/20 border border-violet-500/30">
                            <Users className="w-5 h-5 text-violet-300" strokeWidth={2} />
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-start justify-between gap-2">
                                <h3 className="text-sm font-bold text-white leading-snug">Team invitation</h3>
                                <button
                                    type="button"
                                    onClick={() => dismiss(primary.token)}
                                    className="shrink-0 inline-flex items-center gap-1 rounded-lg pl-2 pr-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                                    aria-label="Dismiss invitation reminder"
                                >
                                    Dismiss
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                                {message ??
                                    (primary.tenantName
                                        ? `You've been invited to join "${primary.tenantName}". Review and accept to get access.`
                                        : 'You have a pending team invitation to review.')}
                            </p>
                            {moreCount > 0 && (
                                <p className="text-[11px] text-violet-300/90 mt-2 font-medium">
                                    +{moreCount} more invitation{moreCount === 1 ? '' : 's'} in Notifications
                                </p>
                            )}
                            <div className="flex flex-wrap gap-2 mt-3">
                                <button
                                    type="button"
                                    onClick={() => goAccept(primary.acceptPath)}
                                    className="inline-flex items-center justify-center px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 shadow-lg shadow-violet-900/30 transition-all"
                                >
                                    Accept invitation
                                </button>
                                <button
                                    type="button"
                                    onClick={onOpenNotifications}
                                    className="inline-flex items-center justify-center px-3.5 py-2 rounded-xl text-xs font-semibold text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                                >
                                    View notifications
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
