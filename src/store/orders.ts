import { create } from 'zustand'
import type { OrderRecord, OrderItemRecord, StatusHistoryEntry } from '../types/storefront'

interface OrdersState {
  orders: OrderRecord[]
  currentOrder: OrderRecord | null
  currentItems: OrderItemRecord[]
  currentHistory: StatusHistoryEntry[]
  setOrders: (orders: OrderRecord[]) => void
  setCurrentOrder: (order: OrderRecord | null, items?: OrderItemRecord[], history?: StatusHistoryEntry[]) => void
  addOrder: (order: OrderRecord) => void
  updateOrderStatus: (orderId: string, status: string) => void
}

export const useOrdersStore = create<OrdersState>((set) => ({
  orders: [],
  currentOrder: null,
  currentItems: [],
  currentHistory: [],
  setOrders: (orders) => set({ orders }),
  setCurrentOrder: (order, items = [], history = []) => set({ currentOrder: order, currentItems: items, currentHistory: history }),
  addOrder: (order) => set((s) => ({ orders: [order, ...s.orders] })),
  updateOrderStatus: (orderId, status) => set((s) => ({
    orders: s.orders.map((o) => o.id === orderId ? { ...o, status: status as any } : o),
    currentOrder: s.currentOrder?.id === orderId ? { ...s.currentOrder, status: status as any } : s.currentOrder,
  })),
}))
