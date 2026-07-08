import type { RequestContext } from '../providers/contracts/RequestContext'
import type { ISalesOrderProvider } from '../providers/contracts/ISalesOrderProvider'
import type { ICustomerProvider } from '../providers/contracts/ICustomerProvider'
import type { IProductCatalogProvider } from '../providers/contracts/IProductCatalogProvider'
import type { IInventoryProvider } from '../providers/contracts/IInventoryProvider'
import type { IAttendanceProvider } from '../providers/contracts/IAttendanceProvider'
import type { ICollectionProvider } from '../providers/contracts/ICollectionProvider'

export type ProviderBackend = 'mock' | 'legacy' | 'supabase' | 'desktop'

export const DEFAULT_BACKEND: ProviderBackend = 'legacy'

export function resolveBackend(env?: string): ProviderBackend {
  switch (env) {
    case 'mock': return 'mock'
    case 'legacy': return 'legacy'
    case 'supabase': return 'supabase'
    case 'desktop': return 'desktop'
    default: return DEFAULT_BACKEND
  }
}

export interface ProviderSet {
  salesOrder: ISalesOrderProvider
  customer: ICustomerProvider
  productCatalog: IProductCatalogProvider
  inventory: IInventoryProvider
  attendance: IAttendanceProvider
  collection: ICollectionProvider
  identity?: { name: string }
}

export interface AppConfig {
  backend: ProviderBackend
  context: RequestContext
}
