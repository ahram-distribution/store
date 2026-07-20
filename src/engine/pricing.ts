import type { ComputedPrices, ProductWithPrice, TierConfig, UnitType, CartItem, CartDealItem, CartTotals, TierExceptionLookup } from '../types/storefront'

export function computePieceQuantity(unitQuantity: number, unitType: UnitType, cartonQuantity: number): number {
  const multiplier = unitType === 'piece' ? 1 : unitType === 'dozen' ? 12 : cartonQuantity
  return unitQuantity * multiplier
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
  exceptionLookup?: TierExceptionLookup | null
): ComputedPrices {
  const piecePrice = product.piecePrice
  const dozenPrice = product.dozenPrice
  const cartonPrice = product.cartonPrice
  const effectiveDiscount = computeEffectiveDiscountPercent(tier, exceptionLookup)
  const effectiveTier = tier ? { ...tier, discountPercent: effectiveDiscount } : null

  return {
    piecePrice,
    dozenPrice,
    cartonPrice,
    tierPiecePrice: computeTierPrice(piecePrice, effectiveTier),
    tierDozenPrice: computeTierPrice(dozenPrice, effectiveTier),
    tierCartonPrice: computeTierPrice(cartonPrice, effectiveTier),
    discountPercent: effectiveDiscount,
  }
}

export function getEffectiveUnitPrice(prices: ComputedPrices, unitType: UnitType, hasTier: boolean): number {
  if (!hasTier) {
    switch (unitType) {
      case 'piece': return prices.piecePrice
      case 'dozen': return prices.dozenPrice
      case 'carton': return prices.cartonPrice
    }
  }
  switch (unitType) {
    case 'piece': return prices.tierPiecePrice
    case 'dozen': return prices.tierDozenPrice
    case 'carton': return prices.tierCartonPrice
  }
}

export function computeCartTotals(
  items: CartItem[],
  tier: TierConfig | null,
  dealItems?: CartDealItem[],
  flashOfferItems?: CartDealItem[],
  exceptionLookup?: TierExceptionLookup | null
): CartTotals {
  const productSubtotal = items.reduce((sum, item) => sum + item.totalPrice, 0)
  const dealTotal = (dealItems ?? []).reduce((sum, d) => sum + d.totalPrice, 0)
  const flashOfferTotal = (flashOfferItems ?? []).reduce((sum, d) => sum + d.totalPrice, 0)

  const effectiveDiscountPercent = computeEffectiveDiscountPercent(tier, exceptionLookup)
  const tierDiscount = effectiveDiscountPercent > 0
    ? items.reduce((sum, item) => {
        const baseTotal = item.totalPrice / (1 - effectiveDiscountPercent / 100)
        return sum + (baseTotal - item.totalPrice)
      }, 0)
    : 0

  const subtotal = productSubtotal + dealTotal + flashOfferTotal
  const netTotal = productSubtotal - tierDiscount + dealTotal + flashOfferTotal

  const tierMinimum = tier?.minimumOrderAmount ?? 0
  const meetsTierMinimum = productSubtotal >= tierMinimum
  const remainingForMinimum = meetsTierMinimum ? 0 : tierMinimum - productSubtotal

  return {
    subtotal,
    tierDiscount,
    netTotal,
    itemCount: items.length + (dealItems?.length ?? 0) + (flashOfferItems?.length ?? 0),
    meetsTierMinimum,
    remainingForMinimum,
    tierMinimum,
    dealTotal: dealTotal + flashOfferTotal,
    productSubtotal,
  }
}

export function recalculateCartItem(
  item: CartItem,
  product: ProductWithPrice,
  tier: TierConfig | null
): CartItem {
  const prices = computeProductPrices(product, tier)
  const hasTier = tier !== null
  const unitPrice = getEffectiveUnitPrice(prices, item.unitType, hasTier)
  const totalPrice = unitPrice * item.unitQuantity
  const pieceQuantity = computePieceQuantity(item.unitQuantity, item.unitType, product.cartonQuantity)

  return {
    ...item,
    unitPrice: Math.round(unitPrice * 100) / 100,
    totalPrice: Math.round(totalPrice * 100) / 100,
    pieceQuantity,
  }
}
