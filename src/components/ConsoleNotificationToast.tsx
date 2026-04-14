import { useEffect, useMemo } from 'react';
import { useConsoleNotificationStore, UserNotification } from '../store/useConsoleNotificationStore';
import { Bell, X, Users, AlertCircle, CheckCircle } from 'lucide-react';
import { isStickyInvitationNotification } from '../lib/teamInviteNotifications';

export function ConsoleNotificationToast() {
    const activeToasts = useConsoleNotificationStore((state) => state.activeToasts);
    const removeActiveToast = useConsoleNotificationStore((state) => state.removeActiveToast);

    const ephemeralToasts = useMemo(
        () => activeToasts.filter((t) => !isStickyInvitationNotification(t)),
        [activeToasts]
    );

    return (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
            {ephemeralToasts.map((toast) => (
                <div key={toast.id} className="pointer-events-auto">
                    <ToastItem toast={toast} onClose={() => removeActiveToast(toast.id)} />
                </div>
            ))}
        </div>
    );
}

function ToastItem({ toast, onClose }: { toast: UserNotification; onClose: () => void }) {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, 8000); // 8 seconds auto-dismiss

        return () => clearTimeout(timer);
    }, [toast.id, onClose]);

    const getIcon = (type: string) => {
        if (type.includes('invite')) return <Users className="w-5 h-5 text-indigo-400" />;
        if (type.includes('suspend') || type.includes('remove')) return <AlertCircle className="w-5 h-5 text-red-400" />;
        if (type.includes('reactivate')) return <CheckCircle className="w-5 h-5 text-emerald-400" />;
        return <Bell className="w-5 h-5 text-pink-400" />;
    };

    const getBackgroundClass = (type: string) => {
        if (type.includes('invite')) return 'from-indigo-500/10 to-transparent border-indigo-500/20';
        if (type.includes('suspend') || type.includes('remove')) return 'from-red-500/10 to-transparent border-red-500/20';
        if (type.includes('reactivate')) return 'from-emerald-500/10 to-transparent border-emerald-500/20';
        return 'from-pink-500/10 to-transparent border-pink-500/20';
    };

    return (
        <div className={`w-80 bg-gray-900 border ${getBackgroundClass(toast.type)} rounded-2xl shadow-lg shadow-black/50 overflow-hidden animate-in slide-in-from-right fade-in duration-300 relative`}>
            <div className={`absolute inset-0 bg-gradient-to-r ${getBackgroundClass(toast.type)} opacity-50 pointer-events-none`} />
            
            <div className="relative p-4 flex gap-3">
                <div className="shrink-0 mt-0.5">
                    {getIcon(toast.type)}
                </div>
                
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-bold text-white mb-1 leading-snug">{toast.title}</p>
                        <button
                            onClick={onClose}
                            className="shrink-0 text-gray-500 hover:text-white transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <p className="text-sm text-gray-400 leading-relaxed mb-3">
                        {toast.message}
                    </p>
                    
                    {toast.action_url && (
                        <a
                            href={toast.action_url}
                            className="inline-flex items-center text-xs font-semibold text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors border border-white/5 shadow-sm"
                        >
                            View Details
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
