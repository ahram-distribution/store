import type { UnitOfMeasure } from './UnitOfMeasure'

export interface Quantity {
  readonly value: number
  readonly unit: UnitOfMeasure
}

export function createQuantity(value: number, unit: UnitOfMeasure): Quantity {
  if (value < 0) throw new Error('Quantity cannot be negative')
  return { value, unit }
}

export function addQuantity(a: Quantity, b: Quantity): Quantity {
  if (a.unit.code !== b.unit.code) throw new Error('Unit mismatch')
  return { value: a.value + b.value, unit: a.unit }
}
