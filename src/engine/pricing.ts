import type {
  ComputedPrices,
  ProductWithPrice,
  TierConfig,
  PaymentMethodOption,
  ShippingMethodOption,
  UnitType,
  CartItem,
  CartDealItem,
  CartTotals,
  TierExceptionLookup,
  DiscountOverridePair,
  CompanyRuleResult,
} from '../types/storefront'

export function computePieceQuantity(unitQuantity: number, unitType: UnitType, cartonQuantity: number): number {
  const multiplier = unitType === 'piece' ? 1 : unitType === 'dozen' ? 12 : cartonQuantity
  return unitQuantity * multiplier
}

export function applyGeographicAdjustment(basePrice: number, adjustmentPercent: number): number {
  return basePrice * (1 + adjustmentPercent / 100)
}

export function computeTierPrice(basePrice: number, tier: TierConfig | null): number {
  if (!tier || tier.discountPercent === 0) return basePrice
  return basePrice * (1 - tier.discountPercent / 100)
}

export function computeEffectiveDiscountPercent(
  tier: TierConfig | null,
  exceptionLookup?: TierExceptionLookup | null
): number {
  if (!tier) return 0
  if (exceptionLookup?.productException !== null && exceptionLookup?.productException !== undefined) {
    return exceptionLookup.productException
  }
  if (exceptionLookup?.companyException !== null && exceptionLookup?.companyException !== undefined) {
    return exceptionLookup.companyException
  }
  return tier.discountPercent
}

/** Resolves one override group: product override > company override > option global. */
function resolveGroupOverride(globalPercent: number, override?: DiscountOverridePair | null): number {
  if (override?.productException !== null && override?.productException !== undefined) {
    return override.productException
  }
  if (override?.companyException !== null && override?.companyException !== undefined) {
    return override.companyException
  }
  return globalPercent
}

export function computeEffectivePaymentDiscountPercent(
  paymentOption?: PaymentMethodOption | null,
  exceptionLookup?: TierExceptionLookup | null
): number {
  if (!paymentOption) return 0
  return resolveGroupOverride(paymentOption.discountPercent, exceptionLookup?.paymentOverride)
}

export function computeEffectiveShippingDiscountPercent(
  shippingOption?: ShippingMethodOption | null,
  exceptionLookup?: TierExceptionLookup | null
): number {
  if (!shippingOption) return 0
  return resolveGroupOverride(shippingOption.discountPercent, exceptionLookup?.shippingOverride)
}

/**
 * Sum of the three independent discount groups (Method B — sum then apply once).
 * Example: tier 2.5% + payment 1% + shipping 1% => 4.5% applied ONCE on the base price.
 */
export function computeTotalDiscountPercent(
  tier: TierConfig | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null,
  exceptionLookup?: TierExceptionLookup | null
): number {
  const tierPart = computeEffectiveDiscountPercent(tier, exceptionLookup)
  const paymentPart = computeEffectivePaymentDiscountPercent(paymentOption, exceptionLookup)
  const shippingPart = computeEffectiveShippingDiscountPercent(shippingOption, exceptionLookup)
  return tierPart + paymentPart + shippingPart
}

export function computeExceptionAwareTierPrice(
  basePrice: number,
  tier: TierConfig | null,
  exceptionLookup?: TierExceptionLookup | null
): number {
  const discountPercent = computeEffectiveDiscountPercent(tier, exceptionLookup)
  if (!tier || discountPercent === 0) return basePrice
  return basePrice * (1 - discountPercent / 100)
}

export function computeProductPrices(
  product: ProductWithPrice,
  tier: TierConfig | null,
  exceptionLookup?: TierExceptionLookup | null,
  geographicAdjustment?: number | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null
): ComputedPrices {
  const geoAdj = geographicAdjustment ?? 0
  const piecePrice = Math.round(applyGeographicAdjustment(product.piecePrice, geoAdj) * 100) / 100
  const dozenPrice = Math.round(applyGeographicAdjustment(product.dozenPrice, geoAdj) * 100) / 100
  const cartonPrice = Math.round(applyGeographicAdjustment(product.cartonPrice, geoAdj) * 100) / 100
  const effectiveDiscount = computeEffectiveDiscountPercent(tier, exceptionLookup)
  const effectiveTier = tier ? { ...tier, discountPercent: effectiveDiscount } : null
  const totalDiscountPercent = computeTotalDiscountPercent(tier, paymentOption, shippingOption, exceptionLookup)
  const totalTier = { ...(tier ?? {}), discountPercent: totalDiscountPercent } as TierConfig

  return {
    piecePrice,
    dozenPrice,
    cartonPrice,
    tierPiecePrice: computeTierPrice(piecePrice, effectiveTier),
    tierDozenPrice: computeTierPrice(dozenPrice, effectiveTier),
    tierCartonPrice: computeTierPrice(cartonPrice, effectiveTier),
    discountPercent: effectiveDiscount,
    paymentDiscountPercent: computeEffectivePaymentDiscountPercent(paymentOption, exceptionLookup),
    shippingDiscountPercent: computeEffectiveShippingDiscountPercent(shippingOption, exceptionLookup),
    totalDiscountPercent,
    finalPiecePrice: computeTierPrice(piecePrice, totalTier),
    finalDozenPrice: computeTierPrice(dozenPrice, totalTier),
    finalCartonPrice: computeTierPrice(cartonPrice, totalTier),
  }
}

export function getUnitBasePrice(prices: ComputedPrices, unitType: UnitType): number {
  switch (unitType) {
    case 'piece': return prices.piecePrice
    case 'dozen': return prices.dozenPrice
    case 'carton': return prices.cartonPrice
  }
}

export function getEffectiveUnitPrice(prices: ComputedPrices, unitType: UnitType, hasTier: boolean): number {
  if (!hasTier) return getUnitBasePrice(prices, unitType)
  switch (unitType) {
    case 'piece': return prices.tierPiecePrice
    case 'dozen': return prices.tierDozenPrice
    case 'carton': return prices.tierCartonPrice
  }
}

/** Final unit price after ALL discount groups are applied once (used by the cart). */
export function getFinalUnitPrice(prices: ComputedPrices, unitType: UnitType): number {
  switch (unitType) {
    case 'piece': return prices.finalPiecePrice
    case 'dozen': return prices.finalDozenPrice
    case 'carton': return prices.finalCartonPrice
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Company diversification rules (minimum distinct companies + per-company % cap),
 * evaluated over a given item set and a base subtotal. Exact same logic as the
 * block historically inlined in computeCartTotals — extracted so the bonus engine
 * can evaluate it against MAIN products only (spec §24.2: bonus items never count).
 */
export function computeCompanyRuleResult(
  items: CartItem[],
  tier: TierConfig | null,
  baseSubtotal: number
): { companyRule: CompanyRuleResult | null; meetsCompanyRules: boolean } {
  const minCompanyCount = tier?.minimumCompanyCount ?? null
  const maxCompanyPct = tier?.maxCompanyPurchasePercent ?? null
  const hasCompanyRules = minCompanyCount !== null || maxCompanyPct !== null

  if (!hasCompanyRules) return { companyRule: null, meetsCompanyRules: true }

  const companyMap = new Map<string, { value: number; companyName: string }>()
  for (const item of items) {
    const cid = item.companyId || ''
    const entry = companyMap.get(cid)
    const itemBase =
      typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0
        ? item.baseUnitPrice * item.unitQuantity
        : item.totalPrice
    if (entry) {
      entry.value += itemBase
    } else {
      companyMap.set(cid, { value: itemBase, companyName: item.companyName || '' })
    }
  }

  const distinctCompanyCount = companyMap.size
  const meetsMinimumCompanies = minCompanyCount === null || distinctCompanyCount >= minCompanyCount

  const companies = Array.from(companyMap.entries()).map(([companyId, { value, companyName }]) => {
    const percent = baseSubtotal > 0 ? (value / baseSubtotal) * 100 : 0
    const exceedsCap = maxCompanyPct !== null && percent > maxCompanyPct + 0.0001
    return { companyId, companyName, value: round2(value), percent: round2(percent), maxPercent: maxCompanyPct, exceedsCap }
  })

  const meetsCompanyCaps = maxCompanyPct === null || companies.every((c) => !c.exceedsCap)

  const meetsCompanyRules = meetsMinimumCompanies && meetsCompanyCaps

  const companyRule: CompanyRuleResult = {
    minimumCompanyCount: minCompanyCount,
    maxCompanyPurchasePercent: maxCompanyPct,
    distinctCompanyCount,
    meetsMinimumCompanies,
    meetsCompanyCaps,
    companies,
  }

  return { companyRule, meetsCompanyRules }
}

export function computeCartTotals(
  items: CartItem[],
  tier: TierConfig | null,
  dealItems?: CartDealItem[],
  flashOfferItems?: CartDealItem[],
  exceptionLookup?: TierExceptionLookup | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null,
  exceptionsByProduct?: Record<string, TierExceptionLookup | null>
): CartTotals {
  const dealTotal = (dealItems ?? []).reduce((sum, d) => sum + d.totalPrice, 0)
  const flashOfferTotal = (flashOfferItems ?? []).reduce((sum, d) => sum + d.totalPrice, 0)

  const totalDiscountPercent = computeTotalDiscountPercent(tier, paymentOption, shippingOption, exceptionLookup)
  const capPct = Math.min(totalDiscountPercent, 99.99)

  const lookupForItem = (item: CartItem): TierExceptionLookup | null | undefined => {
    if (exceptionsByProduct && item.productId in exceptionsByProduct) {
      return exceptionsByProduct[item.productId]
    }
    return exceptionLookup
  }

  let productBaseSubtotal = 0
  let productSubtotal = 0
  let tierDiscount = 0
  let paymentDiscount = 0
  let shippingDiscount = 0

  for (const item of items) {
    productSubtotal += item.totalPrice
    const lookup = lookupForItem(item)
    const itemTotalPct = computeTotalDiscountPercent(tier, paymentOption, shippingOption, lookup ?? exceptionLookup)
    const itemCapPct = Math.min(itemTotalPct, 99.99)
    const baseTotal =
      typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0
        ? item.baseUnitPrice * item.unitQuantity
        : itemTotalPct > 0
          ? item.totalPrice / (1 - itemCapPct / 100)
          : item.totalPrice
    productBaseSubtotal += baseTotal

    const itemDiscount = Math.max(0, baseTotal - item.totalPrice)
    if (itemTotalPct > 0 && itemDiscount > 0) {
      const itemTierPercent = computeEffectiveDiscountPercent(tier, lookup ?? exceptionLookup)
      const itemPaymentPercent = computeEffectivePaymentDiscountPercent(paymentOption, lookup ?? exceptionLookup)
      const itemShippingPercent = computeEffectiveShippingDiscountPercent(shippingOption, lookup ?? exceptionLookup)
      tierDiscount += round2(itemDiscount * (itemTierPercent / itemTotalPct))
      paymentDiscount += round2(itemDiscount * (itemPaymentPercent / itemTotalPct))
      shippingDiscount += round2(itemDiscount * (itemShippingPercent / itemTotalPct))
    }
  }

  const totalDiscount = Math.max(0, productBaseSubtotal - productSubtotal)

  const subtotal = round2(productSubtotal + dealTotal + flashOfferTotal)
  const netTotal = subtotal

  const tierMinimum = tier?.minimumOrderAmount ?? 0
  const meetsTierMinimum = productBaseSubtotal >= tierMinimum
  const remainingForMinimum = meetsTierMinimum ? 0 : Math.max(0, tierMinimum - productBaseSubtotal)

  // ── Company diversification rules ──────────────────────────────────────
  const { companyRule, meetsCompanyRules } = computeCompanyRuleResult(items, tier, productBaseSubtotal)

  return {
    subtotal,
    totalDiscount: round2(totalDiscount),
    tierDiscount,
    paymentDiscount,
    shippingDiscount,
    totalDiscountPercent,
    netTotal,
    itemCount: items.length + (dealItems?.length ?? 0) + (flashOfferItems?.length ?? 0),
    meetsTierMinimum,
    remainingForMinimum,
    tierMinimum,
    dealTotal: dealTotal + flashOfferTotal,
    productSubtotal: round2(productSubtotal),
    productBaseSubtotal: round2(productBaseSubtotal),
    companyRule,
    meetsCompanyRules,
  }
}

export function recalculateCartItem(
  item: CartItem,
  product: ProductWithPrice,
  tier: TierConfig | null,
  geographicAdjustment?: number | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null,
  exceptionLookup?: TierExceptionLookup | null
): CartItem {
  const prices = computeProductPrices(product, tier, exceptionLookup, geographicAdjustment, paymentOption, shippingOption)
  const hasTier = tier !== null
  const baseUnitPrice = getUnitBasePrice(prices, item.unitType)
  const finalUnitPrice = getFinalUnitPrice(prices, item.unitType)
  const totalPrice = finalUnitPrice * item.unitQuantity
  const pieceQuantity = computePieceQuantity(item.unitQuantity, item.unitType, product.cartonQuantity)

  return {
    ...item,
    baseUnitPrice: Math.round(baseUnitPrice * 100) / 100,
    unitPrice: Math.round(finalUnitPrice * 100) / 100,
    totalPrice: Math.round(totalPrice * 100) / 100,
    pieceQuantity,
  }
}

export { round2 }