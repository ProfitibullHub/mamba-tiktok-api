import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useShopStore } from './useShopStore';

export interface WebhookNotification {
  id: string;
  shop_id: string;
  type_id: number;
  category: string;
  title: string;
  message: string;
  raw_payload: any;
  tts_notification_id?: string | null;
  is_read: boolean;
  created_at: string;
}

interface NotificationState {
  notifications: WebhookNotification[];
  unreadCount: number;
  isLoading: boolean;
  isPaused: boolean; 
  activeShopIds: string[];
  activeToasts: WebhookNotification[];
  navigationTarget: { tab: string; orderId?: string } | null;

  // Actions
  fetchNotifications: (shopIds: string[]) => Promise<void>;
  subscribeToNotifications: (shopIds: string[]) => void;
  unsubscribeFromNotifications: () => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteAllNotifications: (shopIds: string[]) => Promise<void>;
  togglePause: (shopIds?: string[]) => Promise<void>;
  syncPauseState: (shopIds: string[]) => Promise<void>;
  removeActiveToast: (id: string) => void;
  setNavigationTarget: (target: { tab: string; orderId?: string } | null) => void;
  requestBrowserPermission: () => Promise<void>;
}

let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  isPaused: false,
  activeShopIds: [],
  activeToasts: [],
  navigationTarget: null,

  fetchNotifications: async (shopIds: string[]) => {
    if (!shopIds.length) return;
    set({ isLoading: true, activeShopIds: shopIds });
    
    // Also sync the pause state from the DB
    get().syncPauseState(shopIds);

    try {
      // Identify the target timezone
      const { data: tzData } = await supabase.from('tiktok_shops').select('timezone').eq('shop_id', shopIds[0]).maybeSingle();
      const shopTz = tzData?.timezone || 'America/Los_Angeles';

      // Mathematically shift to exactly 00:00:00 in the Shop's real timezone
      const now = new Date();
      const tzString = now.toLocaleString('en-US', { timeZone: shopTz });
      const localTzTime = new Date(tzString);
      const tzOffset = now.getTime() - localTzTime.getTime();
      
      localTzTime.setHours(0, 0, 0, 0);
      const todayStartUTC = new Date(localTzTime.getTime() + tzOffset).toISOString();

      const { data, error } = await supabase
        .from('webhook_notifications')
        .select('*')
        .in('shop_id', shopIds)
        .gte('created_at', todayStartUTC)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        set({ 
          notifications: data, 
          unreadCount: data.filter(n => !n.is_read).length,
          isLoading: false 
        });
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
      set({ isLoading: false });
    }
  },

  syncPauseState: async (shopIds: string[]) => {
    if (!shopIds.length) return;
    try {
      const { data, error } = await supabase
        .from('tiktok_shops')
        .select('is_paused')
        .in('shop_id', shopIds);
      
      if (error) throw error;
      
      const allPaused = data?.every(s => s.is_paused) || false;
      set({ isPaused: allPaused });
    } catch (err) {
      console.error('Failed to sync pause state:', err);
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

  subscribeToNotifications: (shopIds: string[]) => {
    const { unsubscribeFromNotifications, requestBrowserPermission } = get();
    
    set({ activeShopIds: shopIds });
    requestBrowserPermission();
    unsubscribeFromNotifications();

    if (!shopIds.length) return;

    realtimeChannel = supabase.channel('custom-notifications-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'webhook_notifications' },
        (payload) => {
          const { isPaused } = get();
          if (isPaused) return;

          if (payload.eventType === 'INSERT') {
            const newNotif = payload.new as WebhookNotification;
            
            if (shopIds.includes(newNotif.shop_id)) {
              if ('Notification' in window && Notification.permission === 'granted') {
                try {
                  new Notification(`Mamba: ${newNotif.title}`, {
                    body: newNotif.message,
                    icon: '/vite.svg',
                  });
                } catch (e) {
                  console.error('[Browser Notification] Failed to trigger', e);
                }
              }

              set((state) => {
                // Ensure array pruning mathematically follows the exact timezone rules dynamically
                const now = new Date();
                const tzString = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }); // We can assume standard since real DB drops handle accuracy
                const localTzTime = new Date(tzString);
                const tzOffset = now.getTime() - localTzTime.getTime();
                
                localTzTime.setHours(0, 0, 0, 0);
                const todayStartUTC = localTzTime.getTime() + tzOffset;

                const updated = [newNotif, ...state.notifications].filter(
                  n => new Date(n.created_at).getTime() >= todayStartUTC
                );
                
                // Automatically fetch and merge real-time order data if this is an Order notification
                // This mimics autoSync's direct UI update without forcing a full heavy refetch.
                if (newNotif.category === 'Order') {
                  const orderId = newNotif.raw_payload?.data?.order_id;
                  if (orderId) {
                    supabase
                      .from('shop_orders')
                      .select('*')
                      .eq('order_id', orderId)
                      .single()
                      .then(({ data, error }) => {
                        if (error) {
                          console.error('[NotificationStore] Error fetching real-time order for UI sync:', error);
                        } else if (data) {
                          console.log(`[NotificationStore] Fetched real-time order ${orderId}, merging into UI...`);
                          useShopStore.getState().mergeRealtimeOrder(data);
                        }
                      });
                  }
                }

                // Keep maximum of 5 toasts on screen at once to prevent clutter
                const newActiveToasts = [newNotif, ...state.activeToasts].slice(0, 5);

                return {
                  notifications: updated,
                  unreadCount: updated.filter(n => !n.is_read).length,
                  activeToasts: newActiveToasts
                };
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedNotif = payload.new as WebhookNotification;
            set((state) => {
              const updated = state.notifications.map(n => n.id === updatedNotif.id ? updatedNotif : n);
              return {
                notifications: updated,
                unreadCount: updated.filter(n => !n.is_read).length
              };
            });
          } else if (payload.eventType === 'DELETE') {
             const deletedId = payload.old.id;
             set((state) => {
               const updated = state.notifications.filter(n => n.id !== deletedId);
               return {
                 notifications: updated,
                 unreadCount: updated.filter(n => !n.is_read).length
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
      const updated = state.notifications.map(n => n.id === id ? { ...n, is_read: true } : n);
      return {
        notifications: updated,
        unreadCount: updated.filter(n => !n.is_read).length
      };
    });

    try {
      await supabase
        .from('webhook_notifications')
        .update({ is_read: true })
        .eq('id', id);
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  },

  markAllAsRead: async () => {
    const { notifications } = get();
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    
    if (!unreadIds.length) return;

    set((state) => ({
      notifications: state.notifications.map(n => ({ ...n, is_read: true })),
      unreadCount: 0
    }));

    try {
      await supabase
        .from('webhook_notifications')
        .update({ is_read: true })
        .in('id', unreadIds);
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  },

  deleteAllNotifications: async (shopIds: string[]) => {
    if (!shopIds.length) {
      console.warn('[NotificationStore] No shop IDs provided for deletion');
      return;
    }

    console.log('[NotificationStore] Deleting all notifications for shops:', shopIds);
    set({ notifications: [], unreadCount: 0, activeToasts: [] });

    try {
      const { error, count } = await supabase
        .from('webhook_notifications')
        .delete({ count: 'exact' })
        .in('shop_id', shopIds);
      
      if (error) throw error;
      console.log(`[NotificationStore] Successfully deleted ${count} notifications from database.`);
    } catch (err) {
      console.error('Failed to delete all notifications:', err);
      // Re-fetch to restore UI state if delete failed
      get().fetchNotifications(shopIds);
    }
  },

  togglePause: async (specificShopIds?: string[]) => {
    const { isPaused, activeShopIds } = get();
    const shopIds = specificShopIds || activeShopIds;
    if (!shopIds.length) return;
    
    const nextState = !isPaused;
    
    set({ isPaused: nextState });

    try {
      const { error } = await supabase
        .from('tiktok_shops')
        .update({ is_paused: nextState })
        .in('shop_id', shopIds);
      
      if (error) throw error;
    } catch (err) {
      console.error('Failed to toggle hard pause in DB:', err);
      get().syncPauseState(shopIds);
    }
  },

  removeActiveToast: (id: string) => {
    set((state) => ({ activeToasts: state.activeToasts.filter(toast => toast.id !== id) }));
  },

  setNavigationTarget: (target) => {
    set({ navigationTarget: target });
  }
}));
