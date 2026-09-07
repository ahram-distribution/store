import { supabase } from '../lib/supabase'
import type { TierRecord, TierConfig, TierExceptionLookup, PaymentMethodOption, ShippingMethodOption } from '../types/storefront'
import { mapTierRecord } from './tiers'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function mapPaymentMethodOption(row: any): PaymentMethodOption {
  return {
    id: row.id,
    name: row.name,
    discountPercent: Number(row.discount_percent ?? 0),
    sortOrder: row.sort_order ?? 0,
    isVisible: row.is_visible ?? true,
    isActive: row.is_active ?? true,
    updatedAt: row.updated_at || null,
    companyExceptions: (row.company_exceptions || []).map((ex: any) => ({
      id: ex.id,
      companyId: ex.company_id,
      companyName: ex.company_name,
      discountPercent: Number(ex.discount_percent ?? 0),
    })),
    productExceptions: (row.product_exceptions || []).map((ex: any) => ({
      id: ex.id,
      productId: ex.product_id,
      productName: ex.product_name,
      discountPercent: Number(ex.discount_percent ?? 0),
    })),
  }
}

function mapShippingMethodOption(row: any): ShippingMethodOption {
  return {
    id: row.id,
    name: row.name,
    discountPercent: Number(row.discount_percent ?? 0),
    sortOrder: row.sort_order ?? 0,
    isVisible: row.is_visible ?? true,
    isActive: row.is_active ?? true,
    updatedAt: row.updated_at || null,
    companyExceptions: (row.company_exceptions || []).map((ex: any) => ({
      id: ex.id,
      companyId: ex.company_id,
      companyName: ex.company_name,
      discountPercent: Number(ex.discount_percent ?? 0),
    })),
    productExceptions: (row.product_exceptions || []).map((ex: any) => ({
      id: ex.id,
      productId: ex.product_id,
      productName: ex.product_name,
      discountPercent: Number(ex.discount_percent ?? 0),
    })),
  }
}

export interface DiscountOptionsBundle {
  tiers: TierRecord[]
  paymentMethods: PaymentMethodOption[]
  shippingMethods: ShippingMethodOption[]
}

// ---------------------------------------------------------------------------
// Discount override resolution — single governed path used by the engine.
// Precedence per group (independently): product override > company override
// > option global. Each override is keyed by the SELECTED option id, so the
// tier/payment/shipping context stays as the admin configured the options.
// ---------------------------------------------------------------------------

export interface DiscountExceptionIndex {
  companies: Record<string, number>
  products: Record<string, number>
}

export interface DiscountPricingContext {
  tiers: Record<string, DiscountExceptionIndex>
  payments: Record<string, DiscountExceptionIndex>
  shippings: Record<string, DiscountExceptionIndex>
}

function indexExceptions(
  options: Array<{
    id: string
    companyExceptions?: Array<{ companyId: string; discountPercent: number }>
    productExceptions?: Array<{ productId: string; discountPercent: number }>
  }>
): Record<string, DiscountExceptionIndex> {
  const out: Record<string, DiscountExceptionIndex> = {}
  for (const o of options ?? []) {
    const companies: Record<string, number> = {}
    const products: Record<string, number> = {}
    for (const ce of o.companyExceptions ?? []) companies[ce.companyId] = Number(ce.discountPercent)
    for (const pe of o.productExceptions ?? []) products[pe.productId] = Number(pe.discountPercent)
    out[o.id] = { companies, products }
  }
  return out
}

export function buildDiscountPricingContext(bundle: DiscountOptionsBundle): DiscountPricingContext {
  return {
    tiers: indexExceptions(bundle.tiers as any),
    payments: indexExceptions(bundle.paymentMethods as any),
    shippings: indexExceptions(bundle.shippingMethods as any),
  }
}

export function resolveExceptionLookup(
  context: DiscountPricingContext | null | undefined,
  tier: TierConfig | null,
  payment: PaymentMethodOption | null,
  shipping: ShippingMethodOption | null,
  productId: string,
  companyId?: string | null
): TierExceptionLookup | null {
  if (!tier || !context) return null
  const company = companyId ?? ''
  const tierIdx = context.tiers[tier.id]
  const payIdx = payment ? context.payments[payment.id] : undefined
  const shipIdx = shipping ? context.shippings[shipping.id] : undefined
  const tierProduct = tierIdx?.products[productId]
  const tierCompany = tierIdx?.companies[company]
  const payProduct = payIdx?.products[productId]
  const payCompany = payIdx?.companies[company]
  const shipProduct = shipIdx?.products[productId]
  const shipCompany = shipIdx?.companies[company]
  return {
    productException: tierProduct !== undefined ? tierProduct : null,
    companyException: tierCompany !== undefined ? tierCompany : null,
    tierDefault: tier.discountPercent,
    paymentOverride: {
      productException: payProduct !== undefined ? payProduct : null,
      companyException: payCompany !== undefined ? payCompany : null,
    },
    shippingOverride: {
      productException: shipProduct !== undefined ? shipProduct : null,
      companyException: shipCompany !== undefined ? shipCompany : null,
    },
  }
}

export interface OrderDiscountSnapshot {
  orderId: string
  tierId: string | null
  paymentMethodOptionId: string | null
  shippingMethodOptionId: string | null
  effectiveDiscountPercent: number | null
  snapshotTierName: string | null
  snapshotTierDiscount: number | null
  snapshotPaymentName: string | null
  snapshotPaymentDiscount: number | null
  snapshotShippingName: string | null
  snapshotShippingDiscount: number | null
}

/** Merges a snapshot's fields directly onto a unified-order header row (in place). */
export function mergeSnapshotIntoRow(row: {
  tier_id?: string | null
  payment_method_option_id?: string | null
  shipping_method_option_id?: string | null
  effective_discount_percent?: number | null
  snapshot_tier_name?: string | null
  snapshot_tier_discount?: number | null
  snapshot_payment_name?: string | null
  snapshot_payment_discount?: number | null
  snapshot_shipping_name?: string | null
  snapshot_shipping_discount?: number | null
}, snap: OrderDiscountSnapshot | undefined): void {
  if (!snap) return
  row.tier_id = snap.tierId ?? null
  row.payment_method_option_id = snap.paymentMethodOptionId ?? null
  row.shipping_method_option_id = snap.shippingMethodOptionId ?? null
  row.effective_discount_percent = snap.effectiveDiscountPercent ?? null
  row.snapshot_tier_name = snap.snapshotTierName
  row.snapshot_tier_discount = snap.snapshotTierDiscount
  row.snapshot_payment_name = snap.snapshotPaymentName
  row.snapshot_payment_discount = snap.snapshotPaymentDiscount
  row.snapshot_shipping_name = snap.snapshotShippingName
  row.snapshot_shipping_discount = snap.snapshotShippingDiscount
}

export const discountOptionsService = {
  async getAll(): Promise<DiscountOptionsBundle> {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_governed_discount_options', { p_token: token ?? null })
    if (error) throw error
    return {
      tiers: (data?.tiers ?? []).map(mapTierRecord),
      paymentMethods: (data?.payment_methods ?? []).map(mapPaymentMethodOption),
      shippingMethods: (data?.shipping_methods ?? []).map(mapShippingMethodOption),
    }
  },

  async createPaymentMethod(params: {
    name: string
    discountPercent: number
    sortOrder?: number
    isVisible?: boolean
  }): Promise<{ success: boolean; id?: string; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'Not authenticated' }
    const { data, error } = await supabase.rpc('governed_create_payment_method_option', {
      p_token: token,
      p_name: params.name,
      p_discount_percent: params.discountPercent,
      p_sort_order: params.sortOrder ?? 0,
      p_is_visible: params.isVisible ?? true,
    })
    if (error) return { success: false, error: error.message }
    return data ?? { success: false, error: 'Unknown error' }
  },

  async updatePaymentMethod(id: string, params: Partial<{
    name: string
    discountPercent: number
    sortOrder: number
    isVisible: boolean
    isActive: boolean
  }>): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'Not authenticated' }
    const { data, error } = await supabase.rpc('governed_update_payment_method_option', {
      p_token: token,
      p_id: id,
      p_name: params.name ?? null,
      p_discount_percent: params.discountPercent ?? null,
      p_sort_order: params.sortOrder ?? null,
      p_is_visible: params.isVisible ?? null,
      p_is_active: params.isActive ?? null,
    })
    if (error) return { success: false, error: error.message }
    return data ?? { success: false }
  },

  async createShippingMethod(params: {
    name: string
    discountPercent: number
    sortOrder?: number
    isVisible?: boolean
  }): Promise<{ success: boolean; id?: string; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'Not authenticated' }
    const { data, error } = await supabase.rpc('governed_create_shipping_method_option', {
      p_token: token,
      p_name: params.name,
      p_discount_percent: params.discountPercent,
      p_sort_order: params.sortOrder ?? 0,
      p_is_visible: params.isVisible ?? true,
    })
    if (error) return { success: false, error: error.message }
    return data ?? { success: false, error: 'Unknown error' }
  },

  async updateShippingMethod(id: string, params: Partial<{
    name: string
    discountPercent: number
    sortOrder: number
    isVisible: boolean
    isActive: boolean
  }>): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'Not authenticated' }
    const { data, error } = await supabase.rpc('governed_update_shipping_method_option', {
      p_token: token,
      p_id: id,
      p_name: params.name ?? null,
      p_discount_percent: params.discountPercent ?? null,
      p_sort_order: params.sortOrder ?? null,
      p_is_visible: params.isVisible ?? null,
      p_is_active: params.isActive ?? null,
    })
    if (error) return { success: false, error: error.message }
    return data ?? { success: false }
  },

  async getOrderDiscountSnapshots(orderIds: string[]): Promise<OrderDiscountSnapshot[]> {
    const token = getToken()
    if (!orderIds.length) return []
    const { data, error } = await supabase.rpc('get_order_discount_snapshots', {
      p_token: token ?? null,
      p_order_ids: orderIds,
    })
    if (error) throw error
    return (data?.snapshots ?? []).map((row: any) => ({
      orderId: row.order_id,
      tierId: row.tier_id ?? null,
      paymentMethodOptionId: row.payment_method_option_id ?? null,
      shippingMethodOptionId: row.shipping_method_option_id ?? null,
      effectiveDiscountPercent: row.effective_discount_percent ?? null,
      snapshotTierName: row.snapshot_tier_name ?? null,
      snapshotTierDiscount: row.snapshot_tier_discount ?? null,
      snapshotPaymentName: row.snapshot_payment_name ?? null,
      snapshotPaymentDiscount: row.snapshot_payment_discount ?? null,
      snapshotShippingName: row.snapshot_shipping_name ?? null,
      snapshotShippingDiscount: row.snapshot_shipping_discount ?? null,
    }))
  },
}