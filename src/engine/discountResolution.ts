import type {
  PaymentMethodOption,
  ShippingMethodOption,
  TierConfig,
  TierExceptionLookup,
  TierRecord,
} from '../types/storefront'

/**
 * THE single server-parity resolver for pricing/benefit overrides.
 *
 * Every surface that decides a money/benefit value — Product Card, Cart,
 * Order Review, Order creation — resolves through buildDiscountPricingContext
 * + resolveExceptionLookup (one context, one lookup). Precedence per benefit
 * group, independently: product override > company override > option global.
 * An explicit 0% is a REAL override and is never mistaken for "no exception".
 *
 * Deterministic — never depends on DB row order or JSON array order. Mirrors
 * the authoritative server function `_get_effective_tier_discount`
 * (ORDER BY applies_to_all_tiers DESC NULLS LAST LIMIT 1):
 * an ALL-TIERS product exception beats a SELECTED-TIER exception for the same
 * product, in any array order. Company/product keys are scoped per option, so
 * no cross-product / cross-company leak is possible.
 */
export interface DiscountOptionsBundle {
  tiers: TierRecord[]
  paymentMethods: PaymentMethodOption[]
  shippingMethods: ShippingMethodOption[]
}

export interface DiscountExceptionIndex {
  companies: Record<string, number>
  products: Record<string, number>
}

export interface DiscountPricingContext {
  tiers: Record<string, DiscountExceptionIndex>
  payments: Record<string, DiscountExceptionIndex>
  shippings: Record<string, DiscountExceptionIndex>
}

interface IndexableOption {
  id: string
  companyExceptions?: Array<{ companyId: string; discountPercent: number }>
  productExceptions?: Array<{ productId: string; discountPercent: number; appliesToAllTiers?: boolean }>
}

function indexOptionExceptions(option: IndexableOption): DiscountExceptionIndex {
  const companies: Record<string, number> = {}
  const products: Record<string, number> = {}
  const productAllTiers: Record<string, boolean> = {}
  for (const ce of option.companyExceptions ?? []) {
    if (!(ce.companyId in companies)) companies[ce.companyId] = Number(ce.discountPercent)
  }
  for (const pe of option.productExceptions ?? []) {
    if (pe.productId in products) {
      // An all-tiers row may replace a previously-seen selected-tier row;
      // nothing may replace an all-tiers row (server LIMIT-1 precedes it).
      if (pe.appliesToAllTiers === true && productAllTiers[pe.productId] !== true) {
        products[pe.productId] = Number(pe.discountPercent)
        productAllTiers[pe.productId] = true
      }
      continue
    }
    products[pe.productId] = Number(pe.discountPercent)
    productAllTiers[pe.productId] = pe.appliesToAllTiers === true
  }
  return { companies, products }
}

function indexOptions(options: Array<IndexableOption> | null | undefined): Record<string, DiscountExceptionIndex> {
  const out: Record<string, DiscountExceptionIndex> = {}
  for (const o of options ?? []) out[o.id] = indexOptionExceptions(o)
  return out
}

export function buildDiscountPricingContext(bundle: DiscountOptionsBundle): DiscountPricingContext {
  return {
    tiers: indexOptions(bundle.tiers),
    payments: indexOptions(bundle.paymentMethods),
    shippings: indexOptions(bundle.shippingMethods),
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