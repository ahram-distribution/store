import { supabase } from '../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: any }> {
  const { data, error } = await supabase.rpc(fn, args)
  return { data: data as T, error }
}

export const returnService = {
  async getAll() {
    const token = getToken()
    if (!token) return { data: null, error: 'Not authenticated' }
    return rpc('get_governed_returns', { p_token: token })
  },
  async getById(id: string) {
    const token = getToken()
    if (!token) return { data: null, error: 'Not authenticated' }
    const { data, error } = await this.getAll()
    if (error) return { data: null, error }
    const found = (data as any[])?.find(r => r.id === id) || null
    return { data: found, error: null }
  },
}
