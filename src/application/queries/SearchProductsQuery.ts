import type { IQuery } from '../contracts/IQuery'
import type { IQueryHandler } from '../contracts/IQueryHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success } from '../results/ApplicationResult'
import type { IProductCatalogProvider } from '../../providers/contracts/IProductCatalogProvider'

export interface SearchProductsQuery extends IQuery {
  readonly queryType: 'SearchProductsQuery'
  readonly companyId: string
  readonly searchQuery: string
}

export class SearchProductsHandler implements IQueryHandler<SearchProductsQuery, import('../../domain/models/product').Product[]> {
  readonly queryType = 'SearchProductsQuery' as const
  private productCatalogProvider: IProductCatalogProvider

  constructor(deps: { productCatalogProvider: IProductCatalogProvider }) {
    this.productCatalogProvider = deps.productCatalogProvider
  }

  async handle(query: SearchProductsQuery): Promise<ApplicationResult> {
    const products = await this.productCatalogProvider.searchProducts({ companyId: query.companyId, searchQuery: query.searchQuery })
    return success(products)
  }
}
