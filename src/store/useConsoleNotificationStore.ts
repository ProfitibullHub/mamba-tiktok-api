import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { isStickyInvitationNotification } from '../lib/teamInviteNotifications';

export interface UserNotification {
    id: string;
    user_id: string;
    type: string;
    title: string;
    message: string;
    action_url?: string | null;
    is_read: boolean;
    created_at: string;
}

interface ConsoleNotificationState {
    notifications: UserNotification[];
    unreadCount: number;
    isLoading: boolean;
    activeToasts: UserNotification[];

    // Actions
    fetchNotifications: (userId: string) => Promise<void>;
    subscribeToNotifications: (userId: string) => void;
    unsubscribeFromNotifications: () => void;
    markAsRead: (id: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    removeActiveToast: (id: string) => void;
    requestBrowserPermission: () => Promise<void>;
}

let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

export const useConsoleNotificationStore = create<ConsoleNotificationState>((set, get) => ({
    notifications: [],
    unreadCount: 0,
    isLoading: false,
    activeToasts: [],

    fetchNotifications: async (userId: string) => {
        if (!userId) return;
        set({ isLoading: true });

        try {
            // Fetch notifications for the last 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const { data, error } = await supabase
                .from('user_notifications')
                .select('*')
                .eq('user_id', userId)
                .gte('created_at', thirtyDaysAgo.toISOString())
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (data) {
                set({
                    notifications: data,
                    unreadCount: data.filter((n) => !n.is_read).length,
                    isLoading: false,
                });
            }
        } catch (err) {
            console.error('[ConsoleNotificationStore] Failed to fetch notifications:', err);
            set({ isLoading: false });
        }
    },

    requestBrowserPermission: async () => {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'default') {
            try {
                await Notification.requestPermission();
            } catch (err) {
                console.error('[Browser Notifications] Failed to request permission', err);
            }
        }
    },

    subscribeToNotifications: (userId: string) => {
        const { unsubscribeFromNotifications, requestBrowserPermission } = get();

        requestBrowserPermission();
        unsubscribeFromNotifications();

        if (!userId) return;

        realtimeChannel = supabase
            .channel('console-notifications-channel')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${userId}` },
                (payload) => {
                    if (payload.eventType === 'INSERT') {
                        const newNotif = payload.new as UserNotification;

                        if ('Notification' in window && Notification.permission === 'granted') {
                            try {
                                new Notification(`Mamba: ${newNotif.title}`, {
                                    body: newNotif.message,
                                    icon: '/logo.svg', // using logo since vite.svg might be missing
                                });
                            } catch (e) {
                                console.error('[Browser Notification] Failed to trigger', e);
                            }
                        }

                        set((state) => {
                            const updated = [newNotif, ...state.notifications];
                            const showEphemeralToast = !isStickyInvitationNotification(newNotif);
                            const newActiveToasts = showEphemeralToast
                                ? [newNotif, ...state.activeToasts].slice(0, 5)
                                : state.activeToasts;

                            return {
                                notifications: updated,
                                unreadCount: updated.filter((n) => !n.is_read).length,
                                activeToasts: newActiveToasts,
                            };
                        });
                    } else if (payload.eventType === 'UPDATE') {
                        const updatedNotif = payload.new as UserNotification;
                        set((state) => {
                            const updated = state.notifications.map((n) =>
                                n.id === updatedNotif.id ? updatedNotif : n
                            );
                            return {
                                notifications: updated,
                                unreadCount: updated.filter((n) => !n.is_read).length,
                            };
                        });
                    } else if (payload.eventType === 'DELETE') {
                        const deletedId = payload.old.id;
                        set((state) => {
                            const updated = state.notifications.filter((n) => n.id !== deletedId);
                            return {
                                notifications: updated,
                                unreadCount: updated.filter((n) => !n.is_read).length,
                            };
                        });
                    }
                }
            )
            .subscribe();
    },

    unsubscribeFromNotifications: () => {
        if (realtimeChannel) {
            supabase.removeChannel(realtimeChannel);
            realtimeChannel = null;
        }
    },

    markAsRead: async (id: string) => {
        set((state) => {
            const updated = state.notifications.map((n) => (n.id === id ? { ...n, is_read: true } : n));
            return {
                notifications: updated,
                unreadCount: updated.filter((n) => !n.is_read).length,
            };
        });

        try {
            await supabase.from('user_notifications').update({ is_read: true }).eq('id', id);
        } catch (err) {
            console.error('[ConsoleNotificationStore] Failed to mark as read:', err);
        }
    },

    markAllAsRead: async () => {
        const { notifications } = get();
        const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);

        if (!unreadIds.length) return;

        set((state) => ({
            notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
            unreadCount: 0,
        }));

        try {
            await supabase.from('user_notifications').update({ is_read: true }).in('id', unreadIds);
        } catch (err) {
            console.error('[ConsoleNotificationStore] Failed to mark all as read:', err);
        }
    },

    removeActiveToast: (id: string) => {
        set((state) => ({ activeToasts: state.activeToasts.filter((toast) => toast.id !== id) }));
    },
}));
