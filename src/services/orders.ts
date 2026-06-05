import { supabase } from '../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: any }> {
  const { data, error } = await supabase.rpc(fn, args)
  return { data: data as T, error }
}

export const orderService = {
  async getAll() {
    const token = getToken()
    if (!token) return { data: null, error: 'Not authenticated' }
    return rpc('get_governed_orders', { p_token: token })
  },
  async getById(id: string) {
    const token = getToken()
    if (!token) return { data: null, error: 'Not authenticated' }
    return rpc('get_governed_order', { p_token: token, p_id: id })
  },
  async getByCustomer(customerId: string) {
    const { data, error } = await this.getAll()
    if (error) return { data: null, error }
    const filtered = (data as any[])?.filter(o => o.customer_id === customerId) || []
    return { data: filtered, error: null }
  },
  async getByStatus(status: string) {
    const { data, error } = await this.getAll()
    if (error) return { data: null, error }
    const filtered = (data as any[])?.filter(o => o.status === status) || []
    return { data: filtered, error: null }
  },
}
