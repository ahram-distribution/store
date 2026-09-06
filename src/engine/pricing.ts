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
  const paymentPart = paymentOption?.discountPercent ?? 0
  const shippingPart = shippingOption?.discountPercent ?? 0
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
    paymentDiscountPercent: paymentOption?.discountPercent ?? 0,
    shippingDiscountPercent: shippingOption?.discountPercent ?? 0,
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

export function computeCartTotals(
  items: CartItem[],
  tier: TierConfig | null,
  dealItems?: CartDealItem[],
  flashOfferItems?: CartDealItem[],
  exceptionLookup?: TierExceptionLookup | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null
): CartTotals {
  const dealTotal = (dealItems ?? []).reduce((sum, d) => sum + d.totalPrice, 0)
  const flashOfferTotal = (flashOfferItems ?? []).reduce((sum, d) => sum + d.totalPrice, 0)

  const totalDiscountPercent = computeTotalDiscountPercent(tier, paymentOption, shippingOption, exceptionLookup)
  const capPct = Math.min(totalDiscountPercent, 99.99)

  let productBaseSubtotal = 0
  let productSubtotal = 0

  for (const item of items) {
    productSubtotal += item.totalPrice
    const baseTotal =
      typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0
        ? item.baseUnitPrice * item.unitQuantity
        : totalDiscountPercent > 0
          ? item.totalPrice / (1 - capPct / 100)
          : item.totalPrice
    productBaseSubtotal += baseTotal
  }

  const totalDiscount = Math.max(0, productBaseSubtotal - productSubtotal)

  const tierPercent = computeEffectiveDiscountPercent(tier, exceptionLookup)
  const paymentPercent = paymentOption?.discountPercent ?? 0
  const shippingPercent = shippingOption?.discountPercent ?? 0

  const allocate = (part: number): number => {
    if (totalDiscountPercent <= 0 || totalDiscount <= 0) return 0
    return round2(totalDiscount * (part / totalDiscountPercent))
  }
  const tierDiscount = allocate(tierPercent)
  const paymentDiscount = allocate(paymentPercent)
  const shippingDiscount = allocate(shippingPercent)

  const subtotal = round2(productSubtotal + dealTotal + flashOfferTotal)
  const netTotal = subtotal

  const tierMinimum = tier?.minimumOrderAmount ?? 0
  const meetsTierMinimum = productBaseSubtotal >= tierMinimum
  const remainingForMinimum = meetsTierMinimum ? 0 : Math.max(0, tierMinimum - productBaseSubtotal)

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
  }
}

export function recalculateCartItem(
  item: CartItem,
  product: ProductWithPrice,
  tier: TierConfig | null,
  geographicAdjustment?: number | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null
): CartItem {
  const prices = computeProductPrices(product, tier, undefined, geographicAdjustment, paymentOption, shippingOption)
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