import type { ProviderSet } from '../di/ProviderConfig'
import { createProviderSet } from '../di/ProviderFactory'
import { ProviderRegistry } from '../providers/registry/ProviderRegistry'
import type { RequestContext } from '../providers/contracts/RequestContext'
import type { IProvider } from '../providers/contracts/IProvider'
import type { RuntimeConfig } from './RuntimeConfiguration'
import { MockSalesOrderProvider } from '../providers/implementations/mock/MockSalesOrderProvider'
import { MockCustomerProvider } from '../providers/implementations/mock/MockCustomerProvider'
import { MockProductCatalogProvider } from '../providers/implementations/mock/MockProductCatalogProvider'
import { MockInventoryProvider } from '../providers/implementations/mock/MockInventoryProvider'
import { MockAttendanceProvider } from '../providers/implementations/mock/MockAttendanceProvider'
import { MockCollectionProvider } from '../providers/implementations/mock/MockCollectionProvider'

export interface ResolvedProviders {
  registry: ProviderRegistry
  providerSet: ProviderSet
}

function createHealthRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()
  const healthProviders: IProvider[] = [
    new MockSalesOrderProvider(),
    new MockCustomerProvider(),
    new MockProductCatalogProvider(),
    new MockInventoryProvider(),
    new MockAttendanceProvider(),
    new MockCollectionProvider(),
  ]
  for (const p of healthProviders) {
    registry.register(p.name, p)
  }
  return registry
}

export function resolveProviders(config: RuntimeConfig, context: RequestContext): ResolvedProviders {
  const providerSet = createProviderSet(config.providerBackend, context)
  const registry = createHealthRegistry()
  return { registry, providerSet }
}
