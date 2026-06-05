import { supabase } from '../lib/supabase'
import type { DailyDealRecord } from '../types/storefront'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function mapRow(row: any): DailyDealRecord {
  return {
    id: row.id,
    title: row.title,
    imageUrl: row.image_url || null,
    description: row.description || null,
    fixedPrice: Number(row.fixed_price),
    availableQuantity: row.available_quantity,
    originalQuantity: row.original_quantity,
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    status: row.status,
    isPurchasable: row.is_purchasable ?? false,
    items: (row.items ?? []).map((i: any) => ({
      id: i.id,
      productId: i.product_id,
      productName: i.product_name,
      quantity: i.quantity,
    })),
  }
}

export const dailyDealService = {
  async getAll(): Promise<DailyDealRecord[]> {
    const token = getToken()
    if (!token) return []
    const { data, error } = await supabase.rpc('get_governed_daily_deals', { p_token: token })
    if (error) throw error
    return (data ?? []).map(mapRow)
  },

  async getActive(): Promise<DailyDealRecord[]> {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_governed_active_daily_deals', { p_token: token })
    if (error) throw error
    return (data ?? []).map(mapRow)
  },

  async create(params: {
    title: string
    imageUrl?: string
    description?: string
    fixedPrice: number
    quantity: number
    startsAt?: string
    endsAt?: string
    items: { productId: string; quantity: number }[]
  }): Promise<{ success: boolean; id?: string; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'Not authenticated' }
    const { data, error } = await supabase.rpc('governed_create_daily_deal', {
      p_token: token,
      p_title: params.title,
      p_image_url: params.imageUrl || null,
      p_description: params.description || null,
      p_fixed_price: params.fixedPrice,
      p_quantity: params.quantity,
      p_starts_at: params.startsAt || null,
      p_ends_at: params.endsAt || null,
      p_items: params.items.map(i => ({ product_id: i.productId, quantity: i.quantity })),
    })
    if (error) return { success: false, error: error.message }
    return data ?? { success: false, error: 'Unknown error' }
  },

  async activate(id: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'Not authenticated' }
    const { data, error } = await supabase.rpc('governed_activate_daily_deal', { p_token: token, p_id: id })
    if (error) return { success: false, error: error.message }
    return data ?? { success: false }
  },

  async cancel(id: string, reason?: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'Not authenticated' }
    const { data, error } = await supabase.rpc('governed_cancel_daily_deal', {
      p_token: token,
      p_id: id,
      p_reason: reason || null,
    })
    if (error) return { success: false, error: error.message }
    return data ?? { success: false }
  },
}
