import type { Product } from '../../domain/models/product'

export interface ProductSearchCriteria {
  companyId: string
  searchQuery?: string
  categoryId?: string
  inStock?: boolean
  limit?: number
  offset?: number
}

export interface IProductCatalogProvider {
  getProductById(id: string): Promise<Product | null>
  searchProducts(criteria: ProductSearchCriteria): Promise<Product[]>
  getCompanyProducts(companyId: string): Promise<Product[]>
}
