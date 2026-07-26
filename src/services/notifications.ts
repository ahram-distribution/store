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
}
