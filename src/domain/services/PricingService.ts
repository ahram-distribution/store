import type { UnitType } from '../enums'

export interface TierConfig {
  discountPercent: number
  minimumOrderAmount: number
}

export function calculateEffectiveDiscount(
  tier: TierConfig | null,
  productException?: number | null,
  companyException?: number | null,
): number {
  if (!tier) return 0
  if (productException != null) return productException
  if (companyException != null) return companyException
  return tier.discountPercent
}

export function applyDiscount(price: number, discountPercent: number): number {
  if (discountPercent <= 0) return price
  return price * (1 - discountPercent / 100)
}

export function computePieceQuantity(unitQuantity: number, unitType: UnitType, cartonQuantity: number): number {
  const multiplier = unitType === 'piece' ? 1 : unitType === 'dozen' ? 12 : cartonQuantity
  return unitQuantity * multiplier
}
