import { supabase } from '../lib/supabase'
import type { TierRecord, TierConfig, TierCompanyException, TierProductException } from '../types/storefront'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function mapTierRecord(row: any): TierRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    discountPercent: Number(row.discount_percent),
    minimumOrderAmount: Number(row.minimum_order_amount),
    iconUrl: row.icon_url || null,
    color: row.color || null,
    sortOrder: row.sort_order,
    isActive: row.is_active ?? true,
    isVisible: row.is_visible ?? true,
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    companyExceptions: (row.company_exceptions ?? []).map((ce: any) => ({
      id: ce.id,
      companyId: ce.company_id,
      companyName: ce.company_name,
      discountPercent: Number(ce.discount_percent),
    })),
    productExceptions: (row.product_exceptions ?? []).map((pe: any) => ({
      id: pe.id,
      productId: pe.product_id,
      productName: pe.product_name,
      discountPercent: Number(pe.discount_percent),
      appliesToAllTiers: pe.applies_to_all_tiers ?? false,
    })),
  }
}

export const tierService = {
  async getTiers(): Promise<TierRecord[]> {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_governed_tiers', { p_token: token ?? null })
    if (error) throw error
    return (data ?? []).map(mapTierRecord)
  },

  async create(params: {
    name: string
    description?: string
    discountPercent: number
    minimumOrderAmount: number
    color?: string
    iconUrl?: string
    sortOrder?: number
    isVisible?: boolean
  }): Promise<{ success: boolean; id?: string; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'Not authenticated' }
    const { data, error } = await supabase.rpc('governed_create_tier', {
      p_token: token,
      p_name: params.name,
      p_description: params.description || null,
      p_discount_percent: params.discountPercent,
      p_minimum_order_amount: params.minimumOrderAmount,
      p_color: params.color || null,
      p_icon_url: params.iconUrl || null,
      p_sort_order: params.sortOrder || null,
      p_is_visible: params.isVisible ?? true,
    })
    if (error) return { success: false, error: error.message }
    return data ?? { success: false, error: 'Unknown error' }
  },

  async update(id: string, params: Partial<{
    name: string
    description: string
    discountPercent: number
    minimumOrderAmount: number
    color: string
    iconUrl: string
    sortOrder: number
    isVisible: boolean
    isActive: boolean
    startsAt: string
    endsAt: string
  }>): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'Not authenticated' }
    const { data, error } = await supabase.rpc('governed_update_tier', {
      p_token: token,
      p_id: id,
      p_name: params.name || null,
      p_description: params.description ?? null,
      p_discount_percent: params.discountPercent ?? null,
      p_minimum_order_amount: params.minimumOrderAmount ?? null,
      p_color: params.color ?? null,
      p_icon_url: params.iconUrl ?? null,
      p_sort_order: params.sortOrder ?? null,
      p_is_visible: params.isVisible ?? null,
      p_is_active: params.isActive ?? null,
      p_starts_at: params.startsAt ?? null,
      p_ends_at: params.endsAt ?? null,
    })
    if (error) return { success: false, error: error.message }
    return data ?? { success: false }
  },

  async setCompanyException(tierId: string, companyId: string, discountPercent: number): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'Not authenticated' }
    const { data, error } = await supabase.rpc('governed_set_tier_company_exception', {
      p_token: token,
      p_tier_id: tierId,
      p_company_id: companyId,
      p_discount_percent: discountPercent,
    })
    if (error) return { success: false, error: error.message }
    return data ?? { success: false }
  },

  async removeCompanyException(exceptionId: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'Not authenticated' }
    const { data, error } = await supabase.rpc('governed_remove_tier_company_exception', {
      p_token: token,
      p_exception_id: exceptionId,
    })
    if (error) return { success: false, error: error.message }
    return data ?? { success: false }
  },

  async lookupEffectiveDiscount(
    tierId: string,
    productId: string,
    companyId: string
  ): Promise<{ productException: number | null; companyException: number | null; tierDefault: number }> {
    const token = getToken()
    if (!token) return { productException: null, companyException: null, tierDefault: 0 }

    const result: any = {}

    const pe = supabase.rpc('get_governed_tiers', { p_token: token })
    const { data: tiers } = await pe
    if (tiers) {
      const tier = (tiers ?? []).find((t: any) => t.id === tierId)
      if (tier) {
        result.tierDefault = Number(tier.discount_percent)
        const prodExc = (tier.product_exceptions ?? []).find(
          (e: any) => (e.product_id === productId || e.applies_to_all_tiers === true)
        )
        result.productException = prodExc ? Number(prodExc.discount_percent) : null
        const compExc = (tier.company_exceptions ?? []).find((e: any) => e.company_id === companyId)
        result.companyException = compExc ? Number(compExc.discount_percent) : null
      }
    }

    return {
      productException: result.productException ?? null,
      companyException: result.companyException ?? null,
      tierDefault: result.tierDefault ?? 0,
    }
  },

  async getEffectiveDiscount(
    tierId: string,
    productId: string,
    companyId: string
  ): Promise<number> {
    const lookup = await this.lookupEffectiveDiscount(tierId, productId, companyId)
    if (lookup.productException !== null) return lookup.productException
    if (lookup.companyException !== null) return lookup.companyException
    return lookup.tierDefault
  },
}
