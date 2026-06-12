import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

function getToken(): string | null {
  return useAuthStore.getState().token
}

export interface ReturnItemInput {
  product_id: string
  unit_type: 'piece' | 'dozen' | 'carton'
  quantity: number
  reason?: string
}

export interface ReturnRecord {
  id: string
  code: string
  order_id: string
  customer_id: string
  status: 'pending' | 'inspecting' | 'approved' | 'rejected'
  credit_note_number: string | null
  credit_note_amount: number | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ReturnItemRecord {
  id: string
  return_id: string
  product_id: string
  unit_type: string
  quantity: number
  reason: string | null
}

export const returnService = {
  async getAll(): Promise<ReturnRecord[]> {
    const token = getToken()
    if (!token) return []
    const { data, error } = await supabase.rpc('get_governed_returns', { p_token: token })
    if (error) throw error
    return (data ?? []) as ReturnRecord[]
  },

  async getById(id: string): Promise<ReturnRecord | null> {
    const token = getToken()
    if (!token) return null
    const { data, error } = await supabase.rpc('get_governed_return', { p_token: token, p_id: id })
    if (error) throw error
    return data as ReturnRecord
  },

  async getItems(returnId: string): Promise<ReturnItemRecord[]> {
    const token = getToken()
    if (!token) return []
    const { data, error } = await supabase.rpc('get_governed_return_items', { p_token: token, p_return_id: returnId })
    if (error) throw error
    return (data ?? []) as ReturnItemRecord[]
  },

  async create(p_order_id: string, p_customer_id: string, p_notes: string | null, p_items: ReturnItemInput[]): Promise<{ success: boolean; return?: ReturnRecord; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_create_return', {
      p_token: token, p_order_id, p_customer_id, p_notes, p_items: JSON.parse(JSON.stringify(p_items)),
    })
    if (error) return { success: false, error: error.message }
    return { success: true, return: data as ReturnRecord }
  },

  async approve(id: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_approve_return', { p_token: token, p_id: id })
    if (error) return { success: false, error: error.message }
    return { success: true }
  },

  async reject(id: string, reason?: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_reject_return', { p_token: token, p_id: id, p_reason: reason })
    if (error) return { success: false, error: error.message }
    return { success: true }
  },
}
