import type { IProvider, HealthCheckResult, ProviderStatus } from '../../contracts/IProvider'
import type { IProductCatalogProvider, ProductSearchCriteria } from '../../contracts/IProductCatalogProvider'
import type { Product } from '../../../domain/models/product'
import type { DocumentStatus } from '../../../domain/enums/DocumentStatus'
import type { UnitType } from '../../../domain/enums/UnitType'

export class MockProductCatalogProvider implements IProductCatalogProvider, IProvider {
  readonly name = 'productCatalog'
  readonly status: ProviderStatus = 'connected'

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthCheck(): Promise<HealthCheckResult> {
    return { status: 'connected', latencyMs: 0, message: 'Mock OK', timestamp: new Date() }
  }

  async getProductById(id: string): Promise<Product | null> {
    if (id === 'nonexistent') return null
    return {
      id,
      companyId: 'comp-1',
      categoryId: 'cat-1',
      productName: 'Mock Product',
      legacyCode: 'MOCK-001',
      description: 'A mock product',
      defaultUnit: 'carton' as UnitType,
      availableUnits: ['carton' as UnitType, 'piece' as UnitType],
      cartonQuantity: 24,
      cartonPrice: 2400,
      status: 'active' as DocumentStatus,
      isOutOfStock: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }
  }

  async searchProducts(criteria: ProductSearchCriteria): Promise<Product[]> {
    return []
  }

  async getCompanyProducts(companyId: string): Promise<Product[]> {
    return []
  }
}
