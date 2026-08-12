import { create } from 'zustand'
import { notificationInboxService, type Notification } from '../services/notifications'

interface NotificationState {
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  hasMore: boolean
  total: number
  toastNotification: Notification | null
  fetchInitial: () => Promise<void>
  fetchMore: () => Promise<void>
  refresh: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  deleteNotifications: (ids: string[]) => Promise<void>
  deleteAllNotifications: () => Promise<void>
  prependNotification: (n: Notification) => void
  showToast: (n: Notification) => void
  dismissToast: () => void
  reset: () => void
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  hasMore: true,
  total: 0,
  toastNotification: null,

  fetchInitial: async () => {
    set({ loading: true })
    try {
      const [result, count] = await Promise.all([
        notificationInboxService.getNotifications(30, 0),
        notificationInboxService.getUnreadCount(),
      ])
      set({
        notifications: result.notifications,
        total: result.total,
        unreadCount: count,
        hasMore: result.notifications.length < result.total,
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  },

  fetchMore: async () => {
    const { notifications, hasMore, loading } = get()
    if (!hasMore || loading) return

    set({ loading: true })
    try {
      const result = await notificationInboxService.getNotifications(30, notifications.length)
      set({
        notifications: [...notifications, ...result.notifications],
        hasMore: notifications.length + result.notifications.length < result.total,
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  },

  refresh: async () => {
    try {
      const [result, count] = await Promise.all([
        notificationInboxService.getNotifications(30, 0),
        notificationInboxService.getUnreadCount(),
      ])
      set({
        notifications: result.notifications,
        total: result.total,
        unreadCount: count,
        hasMore: result.notifications.length < result.total,
      })
    } catch {
      // silent
    }
  },

  markRead: async (id: string) => {
    const success = await notificationInboxService.markRead(id)
    if (success) {
      const { notifications, unreadCount } = get()
      const target = notifications.find((n) => n.id === id)
      set({
        notifications: notifications.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
        unreadCount: target && !target.is_read ? Math.max(0, unreadCount - 1) : unreadCount,
      })
    }
  },

  markAllRead: async () => {
    const success = await notificationInboxService.markAllRead()
    if (success) {
      set({
        notifications: get().notifications.map((n) => ({ ...n, is_read: true })),
        unreadCount: 0,
      })
    }
  },

  deleteNotifications: async (ids: string[]) => {
    if (ids.length === 0) return
    const success = await notificationInboxService.deleteNotifications(ids)
    if (!success) return

    const { notifications, unreadCount, total } = get()
    const idSet = new Set(ids)
    const deletedUnread = notifications.filter((n) => idSet.has(n.id) && !n.is_read).length
    set({
      notifications: notifications.filter((n) => !idSet.has(n.id)),
      unreadCount: Math.max(0, unreadCount - deletedUnread),
      total: Math.max(0, total - ids.length),
    })
  },

  deleteAllNotifications: async () => {
    const success = await notificationInboxService.deleteAllNotifications()
    if (!success) return

    set({ notifications: [], unreadCount: 0, total: 0, hasMore: false })
  },

  prependNotification: (n: Notification) => {
    const { notifications, unreadCount } = get()
    // Avoid duplicates
    if (notifications.some((existing) => existing.id === n.id)) return
    set({
      notifications: [n, ...notifications],
      unreadCount: n.is_read ? unreadCount : unreadCount + 1,
      total: get().total + 1,
    })
  },

  showToast: (n: Notification) => {
    set({ toastNotification: n })
  },

  dismissToast: () => {
    set({ toastNotification: null })
  },

  reset: () => {
    set({ notifications: [], unreadCount: 0, loading: false, hasMore: true, total: 0, toastNotification: null })
  },
}))
