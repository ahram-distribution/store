import type { Product } from '../../domain/models/product'
import type { UnitType } from '../../domain/enums/UnitType'
import type { DocumentStatus } from '../../domain/enums/DocumentStatus'

export class ProductMapper {
  static fromLegacyRow(row: any): Product {
    const productUnits = row.product_units ?? []
    return {
      id: row.id,
      companyId: row.company_id ?? '',
      categoryId: row.category_id ?? '',
      productName: row.product_name,
      legacyCode: row.legacy_code ?? '',
      description: row.description ?? null,
      defaultUnit: 'carton' as UnitType,
      availableUnits: (productUnits.length > 0
        ? productUnits.map((u: any) => u.unit_type as UnitType)
        : ['carton' as UnitType, 'piece' as UnitType, 'dozen' as UnitType]
      ),
      cartonQuantity: Number(row.carton_quantity) || 0,
      cartonPrice: Number(row.carton_price) || 0,
      status: (row.is_active !== false ? 'active' : 'inactive') as DocumentStatus,
      isOutOfStock: row.is_out_of_stock === true,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at ?? row.created_at),
    }
  }
}
