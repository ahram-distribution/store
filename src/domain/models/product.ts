import type { DocumentStatus, UnitType } from '../enums'
import type { Money } from '../value-objects'

export interface Category {
  readonly id: string
  readonly companyId: string
  readonly name: string
  readonly status: DocumentStatus
}

export interface Product {
  readonly id: string
  readonly companyId: string
  readonly categoryId: string
  readonly productName: string
  readonly legacyCode: string
  readonly description: string | null
  readonly defaultUnit: UnitType
  readonly availableUnits: UnitType[]
  readonly cartonQuantity: number
  readonly cartonPrice: number
  readonly status: DocumentStatus
  readonly isOutOfStock: boolean
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface ProductUnit {
  readonly id: string
  readonly productId: string
  readonly unitType: UnitType
  readonly isActive: boolean
}

export function createProduct(
  id: string,
  companyId: string,
  categoryId: string,
  productName: string,
  legacyCode: string,
  cartonQuantity: number,
  cartonPrice: number,
): Product {
  const now = new Date()
  return {
    id, companyId, categoryId, productName, legacyCode,
    description: null,
    defaultUnit: 'carton' as UnitType,
    availableUnits: ['carton' as UnitType, 'piece' as UnitType, 'dozen' as UnitType],
    cartonQuantity, cartonPrice,
    status: 'active' as DocumentStatus,
    isOutOfStock: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function createCategory(id: string, companyId: string, name: string): Category {
  return { id, companyId, name, status: 'active' as DocumentStatus }
}

export function markProductOutOfStock(product: Product): Product {
  return { ...product, isOutOfStock: true, updatedAt: new Date() }
}

export function markProductInStock(product: Product): Product {
  return { ...product, isOutOfStock: false, updatedAt: new Date() }
}
