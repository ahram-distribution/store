import { create } from 'zustand'
import { supabase } from '../lib/supabase'

interface EntityViewsState {
  unseenOrderIds: Set<string>
  unseenCustomerIds: Set<string>
  unseenOrdersCount: number
  unseenCustomersCount: number
  fetched: boolean

  ensureBaseline: (token: string) => Promise<void>
  fetchUnseenOrders: (token: string) => Promise<void>
  fetchUnseenCustomers: (token: string) => Promise<void>
  fetchUnseenCounts: (token: string) => Promise<void>
  markOrderViewed: (token: string, orderId: string) => void
  markCustomerViewed: (token: string, customerId: string) => void
  reset: () => void
}

export const useEntityViewsStore = create<EntityViewsState>((set, get) => ({
  unseenOrderIds: new Set(),
  unseenCustomerIds: new Set(),
  unseenOrdersCount: 0,
  unseenCustomersCount: 0,
  fetched: false,

  ensureBaseline: async (token: string) => {
    await supabase.rpc('ensure_baseline', { p_token: token })
  },

  fetchUnseenOrders: async (token: string) => {
    await get().ensureBaseline(token)
    const { data } = await supabase.rpc('get_unseen_order_ids', { p_token: token })
    if (data && Array.isArray(data)) {
      set({ unseenOrderIds: new Set(data), unseenOrdersCount: data.length })
    }
  },

  fetchUnseenCustomers: async (token: string) => {
    await get().ensureBaseline(token)
    const { data } = await supabase.rpc('get_unseen_customer_ids', { p_token: token })
    if (data && Array.isArray(data)) {
      set({ unseenCustomerIds: new Set(data), unseenCustomersCount: data.length })
    }
  },

  fetchUnseenCounts: async (token: string) => {
    await get().ensureBaseline(token)
    const { data } = await supabase.rpc('get_unseen_counts', { p_token: token })
    if (data && typeof data === 'object') {
      set({
        unseenOrdersCount: data.unseen_orders ?? 0,
        unseenCustomersCount: data.unseen_customers ?? 0,
        fetched: true,
      })
    }
  },

  markOrderViewed: (token: string, orderId: string) => {
    const { unseenOrderIds, unseenOrdersCount } = get()
    if (!unseenOrderIds.has(orderId)) return
    supabase.rpc('mark_entity_viewed', { p_token: token, p_entity_type: 'order', p_entity_id: orderId })
    const next = new Set(unseenOrderIds)
    next.delete(orderId)
    set({ unseenOrderIds: next, unseenOrdersCount: Math.max(0, unseenOrdersCount - 1) })
  },

  markCustomerViewed: (token: string, customerId: string) => {
    const { unseenCustomerIds, unseenCustomersCount } = get()
    if (!unseenCustomerIds.has(customerId)) return
    supabase.rpc('mark_entity_viewed', { p_token: token, p_entity_type: 'customer', p_entity_id: customerId })
    const next = new Set(unseenCustomerIds)
    next.delete(customerId)
    set({ unseenCustomerIds: next, unseenCustomersCount: Math.max(0, unseenCustomersCount - 1) })
  },

  reset: () => set({
    unseenOrderIds: new Set(),
    unseenCustomerIds: new Set(),
    unseenOrdersCount: 0,
    unseenCustomersCount: 0,
    fetched: false,
  }),
}))
