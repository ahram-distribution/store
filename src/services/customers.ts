import { supabase } from '../lib/supabase'

function getToken(): string | null {
  try {
    const raw = localStorage.getItem('session_token')
    return raw
  } catch { return null }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: any }> {
  const { data, error } = await supabase.rpc(fn, args)
  return { data: data as T, error }
}

export const customerService = {
  async getAll() {
    const token = getToken()
    if (!token) return { data: null, error: 'Not authenticated' }
    return rpc('get_governed_customers', { p_token: token })
  },
  async getById(id: string) {
    const token = getToken()
    if (!token) return { data: null, error: 'Not authenticated' }
    return rpc('get_governed_customer', { p_token: token, p_id: id })
  },
  async getByOwner(ownerId: string) {
    // Filter from governed view client-side
    const { data, error } = await this.getAll()
    if (error) return { data: null, error }
    const filtered = (data as any[])?.filter(c => c.owner_id === ownerId) || []
    return { data: filtered, error: null }
  },
}
