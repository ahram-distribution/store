import type { Money } from '../value-objects'
import { createMoney, ZeroMoney } from '../value-objects'
import type { UnitType } from '../enums'

export interface PriceCalculationInput {
  cartonPrice: number
  cartonQuantity: number
  unitType: UnitType
  unitQuantity: number
}

export interface PriceCalculationResult {
  unitPrice: Money
  totalPrice: Money
  pieceQuantity: number
}

export interface TierConfig {
  discountPercent: number
  minimumOrderAmount: number
}

export interface TieredPriceInput extends PriceCalculationInput {
  tier: TierConfig | null
  productException?: number | null
  companyException?: number | null
}

export function calculateUnitPrice(pricePerCarton: number, unitType: UnitType, cartonQuantity: number): Money {
  if (unitType === 'carton') return createMoney(pricePerCarton)
  const baseUnitPrice = pricePerCarton / cartonQuantity
  if (unitType === 'dozen') return createMoney(baseUnitPrice * 12)
  return createMoney(baseUnitPrice)
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

export function calculatePrice(input: PriceCalculationInput): PriceCalculationResult {
  const unitPrice = calculateUnitPrice(input.cartonPrice, input.unitType, input.cartonQuantity)
  const totalPrice = createMoney(unitPrice.amount * input.unitQuantity)
  const multiplier = input.unitType === 'piece' ? 1 : input.unitType === 'dozen' ? 12 : input.cartonQuantity
  const pieceQuantity = input.unitQuantity * multiplier
  return { unitPrice, totalPrice, pieceQuantity }
}

export function calculateTieredPrice(input: TieredPriceInput): PriceCalculationResult {
  const base = calculatePrice(input)
  const discount = calculateEffectiveDiscount(input.tier, input.productException, input.companyException)
  if (discount <= 0) return base
  const discountedUnitAmount = applyDiscount(base.unitPrice.amount, discount)
  const discountedTotalAmount = applyDiscount(base.totalPrice.amount, discount)
  return {
    unitPrice: createMoney(discountedUnitAmount),
    totalPrice: createMoney(discountedTotalAmount),
    pieceQuantity: base.pieceQuantity,
  }
}

export function getCartUnitPrice(
  cartonPrice: number,
  cartonQuantity: number,
  unitType: UnitType,
): number {
  return calculateUnitPrice(cartonPrice, unitType, cartonQuantity).amount
}

export function computePieceQuantity(unitQuantity: number, unitType: UnitType, cartonQuantity: number): number {
  const multiplier = unitType === 'piece' ? 1 : unitType === 'dozen' ? 12 : cartonQuantity
  return unitQuantity * multiplier
}
