import type { ProviderBackend, ProviderSet } from './ProviderConfig'
import type { RequestContext } from '../providers/contracts/RequestContext'
import { LegacySalesOrderProvider } from '../providers/implementations/legacy/LegacySalesOrderProvider'
import { LegacyCustomerProvider } from '../providers/implementations/legacy/LegacyCustomerProvider'
import { LegacyProductCatalogProvider } from '../providers/implementations/legacy/LegacyProductCatalogProvider'
import { LegacyInventoryProvider } from '../providers/implementations/legacy/LegacyInventoryProvider'
import { LegacyAttendanceProvider } from '../providers/implementations/legacy/LegacyAttendanceProvider'
import { LegacyCollectionProvider } from '../providers/implementations/legacy/LegacyCollectionProvider'
import { SupabaseSalesOrderProvider } from '../providers/implementations/supabase/SupabaseSalesOrderProvider'
import { SupabaseCustomerProvider } from '../providers/implementations/supabase/SupabaseCustomerProvider'
import { SupabaseProductCatalogProvider } from '../providers/implementations/supabase/SupabaseProductCatalogProvider'
import { SupabaseInventoryProvider } from '../providers/implementations/supabase/SupabaseInventoryProvider'
import { SupabaseAttendanceProvider } from '../providers/implementations/supabase/SupabaseAttendanceProvider'
import { SupabaseCollectionProvider } from '../providers/implementations/supabase/SupabaseCollectionProvider'
import { MockSalesOrderProvider } from '../providers/implementations/mock/MockSalesOrderProvider'
import { MockCustomerProvider } from '../providers/implementations/mock/MockCustomerProvider'
import { MockProductCatalogProvider } from '../providers/implementations/mock/MockProductCatalogProvider'
import { MockInventoryProvider } from '../providers/implementations/mock/MockInventoryProvider'
import { MockAttendanceProvider } from '../providers/implementations/mock/MockAttendanceProvider'
import { MockCollectionProvider } from '../providers/implementations/mock/MockCollectionProvider'

function createMockProviders(context: RequestContext): ProviderSet {
  return {
    salesOrder: new MockSalesOrderProvider(),
    customer: new MockCustomerProvider(),
    productCatalog: new MockProductCatalogProvider(),
    inventory: new MockInventoryProvider(),
    attendance: new MockAttendanceProvider(),
    collection: new MockCollectionProvider(),
  }
}

function createLegacyProviders(context: RequestContext): ProviderSet {
  return {
    salesOrder: new LegacySalesOrderProvider(context),
    customer: new LegacyCustomerProvider(context),
    productCatalog: new LegacyProductCatalogProvider(context),
    inventory: new LegacyInventoryProvider(context),
    attendance: new LegacyAttendanceProvider(context),
    collection: new LegacyCollectionProvider(context),
  }
}

function createSupabaseProviders(context: RequestContext): ProviderSet {
  return {
    salesOrder: new SupabaseSalesOrderProvider(context),
    customer: new SupabaseCustomerProvider(context),
    productCatalog: new SupabaseProductCatalogProvider(context),
    inventory: new SupabaseInventoryProvider(context),
    attendance: new SupabaseAttendanceProvider(context),
    collection: new SupabaseCollectionProvider(context),
  }
}

function createDesktopProviders(context: RequestContext): ProviderSet {
  return createLegacyProviders(context)
}

const PROVIDER_FACTORIES: Record<ProviderBackend, (ctx: RequestContext) => ProviderSet> = {
  mock: createMockProviders,
  legacy: createLegacyProviders,
  supabase: createSupabaseProviders,
  desktop: createDesktopProviders,
}

export function createProviderSet(backend: ProviderBackend, context: RequestContext): ProviderSet {
  const factory = PROVIDER_FACTORIES[backend]
  if (!factory) {
    throw new Error(`Unknown provider backend: ${backend}`)
  }
  return factory(context)
}
