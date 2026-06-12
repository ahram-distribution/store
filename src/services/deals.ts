import { supabase } from '../lib/supabase'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

export interface PackageDealRecord {
  id: string
  packageType: 'daily_deal' | 'flash_offer'
  name: string
  description: string | null
  price: number
  availableQuantity: number
  originalQuantity: number
  startTime: string | null
  endTime: string | null
  status: string
  isManualStop: boolean
  createdAt: string
  updatedAt: string
}

function mapDailyDeal(d: any): PackageDealRecord {
  return {
    id: d.id,
    packageType: 'daily_deal',
    name: d.title || '',
    description: d.description || null,
    price: Number(d.fixed_price || 0),
    availableQuantity: d.available_quantity ?? 0,
    originalQuantity: d.original_quantity ?? 0,
    startTime: d.starts_at || null,
    endTime: d.ends_at || null,
    status: d.status || 'draft',
    isManualStop: false,
    createdAt: d.created_at || '',
    updatedAt: d.updated_at || '',
  }
}

export const dealService = {
  async getAll() {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    const { data, error } = await supabase.rpc('get_governed_daily_deals', { p_token: token })
    if (error) throw error
    return (Array.isArray(data) ? data : []).map(mapDailyDeal)
  },

  async getActive() {
    const { data, error } = await supabase.rpc('get_governed_active_daily_deals', { p_token: null })
    if (error) throw error
    return (Array.isArray(data) ? data : []).map(mapDailyDeal)
  },

  async getById(id: string) {
    const all = await this.getAll()
    return all.find((d) => d.id === id) || null
  },
}
