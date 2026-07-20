import type { UnitType } from '../enums'
import { type Money, createMoney } from '../value-objects'

export interface PricingRule {
  readonly id: string
  readonly productId: string
  readonly minQuantity: number
  readonly unitType: UnitType
  readonly pricePerUnit: Money
  readonly isActive: boolean
}

export interface CustomerPrice {
  readonly id: string
  readonly customerId: string
  readonly productId: string
  readonly price: Money
  readonly unitType: UnitType
}

export interface TieredPrice {
  readonly productId: string
  readonly unitType: UnitType
  readonly tier: number
  readonly price: Money
}

export function createPricingRule(
  id: string,
  productId: string,
  minQuantity: number,
  unitType: UnitType,
  pricePerUnit: Money,
): PricingRule {
  return { id, productId, minQuantity, unitType, pricePerUnit, isActive: true }
}

export function createCustomerPrice(
  id: string,
  customerId: string,
  productId: string,
  price: Money,
  unitType: UnitType,
): CustomerPrice {
  return { id, customerId, productId, price, unitType }
}


