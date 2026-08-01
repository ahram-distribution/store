import type { ProductWithPrice, ProductUnitPrice, UnitType } from '../types/storefront'

export function toProductWithPrice(row: any): ProductWithPrice {
  const cartonPrice = Number(row.carton_price) || 0
  const cartonQuantity = Number(row.carton_quantity) || 0
  const piecePrice = Number(row.piece_price) || 0
  const dozenPrice = Number(row.dozen_price) || 0
  const activeUnits = (row.product_units ?? []).filter((u: any) => u.is_active !== false)
  const availableUnitTypes: UnitType[] = activeUnits.map((u: any) => u.unit_type)
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
