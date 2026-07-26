import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

export interface Notification {
  id: string
  type: string
  title: string
  message: string
  entity_type: string | null
  entity_id: string | null
  target_path: string | null
  is_read: boolean
  created_at: string
}

export const notificationInboxService = {
  async getNotifications(limit = 50, offset = 0): Promise<{ notifications: Notification[]; total: number }> {
    const token = useAuthStore.getState().token
    if (!token) return { notifications: [], total: 0 }

    const { data, error } = await supabase.rpc('get_my_notifications', {
      p_token: token,
      p_limit: limit,
      p_offset: offset,
    })
    if (error) throw error
    if (data?.error) return { notifications: [], total: 0 }
    return { notifications: data.notifications ?? [], total: data.total ?? 0 }
  },

  async getUnreadCount(): Promise<number> {
    const token = useAuthStore.getState().token
    if (!token) return 0

    const { data, error } = await supabase.rpc('get_my_unread_count', { p_token: token })
    if (error) return 0
    return data?.count ?? 0
  },

  async markRead(id: string): Promise<boolean> {
    const token = useAuthStore.getState().token
    if (!token) return false

    const { error } = await supabase.rpc('mark_notification_read', { p_token: token, p_id: id })
    return !error
  },

  async markAllRead(): Promise<boolean> {
    const token = useAuthStore.getState().token
    if (!token) return false

    const { error } = await supabase.rpc('mark_all_notifications_read', { p_token: token })
    return !error
  },

  subscribeToNotifications(callback: (notification: Notification) => void): () => void {
    const user = useAuthStore.getState().user
    const employeeId = user?.employee_id
    if (!employeeId) return () => {}

    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_employee_id=eq.${employeeId}`,
        },
        (payload: any) => {
          const row = payload.new
          callback({
            id: row.id,
            type: row.type,
            title: row.title,
            message: row.message,
            entity_type: row.entity_type,
            entity_id: row.entity_id,
            target_path: row.target_path,
            is_read: row.is_read,
            created_at: row.created_at,
          })
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  },

  // ---- Push Subscription Management ----

  VAPID_PUBLIC_KEY: 'BLvPl__v7fL1hsF7u3cpCmiZqLpBMlyfRziC72PDU9NxltZMYnwAquRRpY_e79yyjUoummCC49uBaKADGFvywJk',

  isPushSupported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  },

  getPushPermissionState(): NotificationPermission {
    if (!this.isPushSupported()) return 'denied'
    return Notification.permission
  },

  async subscribeToPush(): Promise<boolean> {
    if (!this.isPushSupported()) return false
    const token = useAuthStore.getState().token
    if (!token) return false

    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return false

      const registration = await navigator.serviceWorker.ready
      const existingSubscription = await registration.pushManager.getSubscription()

      if (existingSubscription) {
        await this.saveSubscription(existingSubscription)
        return true
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(this.VAPID_PUBLIC_KEY),
      })

      await this.saveSubscription(subscription)
      return true
    } catch {
      return false
    }
  },

  async unsubscribeFromPush(): Promise<boolean> {
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) return true

      await subscription.unsubscribe()
      await this.removeSubscription(subscription.endpoint)
      return true
    } catch {
      return false
    }
  },

  async getExistingSubscription(): Promise<PushSubscription | null> {
    try {
      const registration = await navigator.serviceWorker.ready
      return await registration.pushManager.getSubscription()
    } catch {
      return null
    }
  },

  async saveSubscription(subscription: PushSubscription): Promise<void> {
    const token = useAuthStore.getState().token
    if (!token) return

    const subJson = subscription.toJSON()
    const p256dh = subJson.keys?.p256dh || ''
    const auth = subJson.keys?.auth || ''
    const endpoint = subscription.endpoint

    await supabase.rpc('save_push_subscription', {
      p_token: token,
      p_endpoint: endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: navigator.userAgent,
    })
  },

  async removeSubscription(endpoint: string): Promise<void> {
    await supabase.rpc('remove_push_subscription', { p_endpoint: endpoint })
  },

  urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  },
}
