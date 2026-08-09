import type { ProductWithPrice, ProductUnitPrice, UnitType } from '../types/storefront'
import { useAuthStore } from '../store/auth'
import { isUpperManagement } from './roleNormalization'

/**
 * Resolves the selling units for a product row coming from get_governed_products.
 * - Supreme/Upper Management: ALL configured units for the product, regardless of
 *   the is_active flag. Reads from the product/unit data model (row.product_units).
 * - Every other user: only active configured units (existing behavior, unchanged).
 * The role check reuses the existing authorization mechanism
 * (roleNormalization.isUpperManagement over the session user's roles).
 */
export function resolveConfiguredUnitTypes(row: any): UnitType[] {
  const user = useAuthStore.getState().user
  const isSupreme = Array.isArray(user?.roles) && user.roles.some((r: any) => {
    const name = typeof r === 'string' ? r : r?.name
    return isUpperManagement(name ?? '')
  })
  const units = Array.isArray(row.product_units) ? row.product_units : []
  if (isSupreme) {
    return units.map((u: any) => u.unit_type)
  }
  return units.filter((u: any) => u.is_active !== false).map((u: any) => u.unit_type)
}

export function toProductWithPrice(row: any): ProductWithPrice {
  const cartonPrice = Number(row.carton_price) || 0
  const cartonQuantity = Number(row.carton_quantity) || 0
  const piecePrice = Number(row.piece_price) || 0
  const dozenPrice = Number(row.dozen_price) || 0
  const availableUnitTypes: UnitType[] = resolveConfiguredUnitTypes(row)
  const allUnitPrices: ProductUnitPrice[] = [
    { unitType: 'piece', price: piecePrice },
    { unitType: 'dozen', price: dozenPrice },
    { unitType: 'carton', price: cartonPrice },
  ]
  const unitPrices = allUnitPrices.filter((up) => availableUnitTypes.includes(up.unitType))
  return {
    id: row.id,
    productName: row.product_name,
    legacyCode: row.legacy_code || '',
    cartonPrice,
    cartonQuantity,
    piecePrice,
    dozenPrice,
    isActive: row.is_active ?? true,
    isOutOfStock: row.is_out_of_stock === true,
    isVisible: row.is_visible ?? true,
    imageUrl: row.image_url || undefined,
    companyId: row.company_id,
    companyName: row.company_name ?? '',
    unitPrices,
    availableUnitTypes,
    recentlyAvailableAt: row.recently_available_at || undefined,
  }
}
