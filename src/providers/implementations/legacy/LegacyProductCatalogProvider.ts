import { supabase } from '../../../lib/supabase'
import type { IProductCatalogProvider, ProductSearchCriteria } from '../../contracts/IProductCatalogProvider'
import type { Product } from '../../../domain/models/product'
import { ProductMapper } from '../../mappers/ProductMapper'
import { ProviderException } from '../../contracts/exceptions'
import type { RequestContext } from '../../contracts/RequestContext'

const PROVIDER_NAME = 'LegacyProductCatalogProvider'

export class LegacyProductCatalogProvider implements IProductCatalogProvider {
  private context: RequestContext

  constructor(context: RequestContext) {
    this.context = context
  }

  async getProductById(id: string): Promise<Product | null> {
    const { data, error } = await supabase.rpc('get_governed_products', {
      p_token: this.context.token,
      p_active_only: false,
      p_visible_only: false,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    const found = arr.find((p: any) => p.id === id)
    return found ? ProductMapper.fromLegacyRow(found) : null
  }

  async searchProducts(criteria: ProductSearchCriteria): Promise<Product[]> {
    const params: Record<string, unknown> = { p_token: this.context.token, p_active_only: false }
    if (criteria.companyId) params.p_company_id = criteria.companyId
    if (criteria.searchQuery) params.p_search = criteria.searchQuery
    if (criteria.inStock === true) params.p_active_only = true
    const { data, error } = await supabase.rpc('get_governed_products', params)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map(ProductMapper.fromLegacyRow)
  }

  async getCompanyProducts(companyId: string): Promise<Product[]> {
    const { data, error } = await supabase.rpc('get_governed_products', {
      p_token: this.context.token,
      p_company_id: companyId,
      p_active_only: false,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map(ProductMapper.fromLegacyRow)
  }
}
