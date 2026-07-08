import type { IProductCatalogProvider, ProductSearchCriteria } from '../../contracts/IProductCatalogProvider'
import type { Product } from '../../../domain/models/product'
import { ProductMapper } from '../../mappers/ProductMapper'
import { ProviderException } from '../../contracts/exceptions'
import type { RequestContext } from '../../contracts/RequestContext'
import { supabase } from './client'

const PROVIDER_NAME = 'SupabaseProductCatalogProvider'

export class SupabaseProductCatalogProvider implements IProductCatalogProvider {
  private context: RequestContext

  constructor(context: RequestContext) {
    this.context = context
  }

  async getProductById(id: string): Promise<Product | null> {
    const { data, error } = await supabase
      .from('products')
      .select('*, product_units(*)')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    if (!data) return null
    return ProductMapper.fromLegacyRow(data)
  }

  async searchProducts(criteria: ProductSearchCriteria): Promise<Product[]> {
    let query = supabase.from('products').select('*, product_units(*)')
    if (criteria.companyId) query = query.eq('company_id', criteria.companyId)
    if (criteria.searchQuery) {
      query = query.or(`product_name.ilike.%${criteria.searchQuery}%,legacy_code.ilike.%${criteria.searchQuery}%`)
    }
    if (criteria.categoryId) query = query.eq('category_id', criteria.categoryId)
    if (criteria.inStock === true) query = query.eq('is_out_of_stock', false)
    if (criteria.inStock === false) query = query.eq('is_out_of_stock', true)
    if (criteria.limit) query = query.limit(criteria.limit)
    if (criteria.offset && criteria.limit) {
      query = query.range(criteria.offset, criteria.offset + criteria.limit - 1)
    }
    const { data, error } = await query.order('product_name', { ascending: true })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map(ProductMapper.fromLegacyRow)
  }

  async getCompanyProducts(companyId: string): Promise<Product[]> {
    const { data, error } = await supabase
      .from('products')
      .select('*, product_units(*)')
      .eq('company_id', companyId)
      .order('product_name', { ascending: true })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map(ProductMapper.fromLegacyRow)
  }
}
