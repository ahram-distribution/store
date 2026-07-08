export interface UnitOfMeasure {
  readonly code: 'piece' | 'dozen' | 'carton'
  readonly name: string
  readonly baseUnit: 'piece'
  readonly conversionFactor: number
}

export const UnitOfMeasure = {
  Piece: { code: 'piece', name: 'قطعة', baseUnit: 'piece', conversionFactor: 1 } as UnitOfMeasure,
  Dozen: { code: 'dozen', name: 'دستة', baseUnit: 'piece', conversionFactor: 12 } as UnitOfMeasure,
  Carton: { code: 'carton', name: 'كرتونة', baseUnit: 'piece', conversionFactor: 1 } as UnitOfMeasure,
} as const

export type UnitCode = (typeof UnitOfMeasure)[keyof typeof UnitOfMeasure]['code']

export function getUnitOfMeasure(code: string): UnitOfMeasure | undefined {
  return Object.values(UnitOfMeasure).find(u => u.code === code)
}

export function convertToPieces(quantity: number, unit: UnitOfMeasure, cartonQuantity: number): number {
  if (unit.code === 'carton') return quantity * cartonQuantity
  if (unit.code === 'dozen') return quantity * 12
  return quantity
}
