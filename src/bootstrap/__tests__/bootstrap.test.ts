import { describe, it, expect } from 'vitest'
import { detectEnvironment } from '../EnvironmentResolver'
import { createRuntimeConfig, modeToBackend } from '../RuntimeConfiguration'
import { resolveProviders } from '../ProviderResolver'
import { createApp } from '../AppBootstrap'
import type { EnvironmentInfo } from '../EnvironmentResolver'
import type { AppMode } from '../RuntimeConfiguration'
import { isSuccess } from '../../application/results/ApplicationResult'

function testEnv(overrides?: Partial<EnvironmentInfo>): EnvironmentInfo {
  return {
    environment: 'test',
    isDevelopment: false,
    isProduction: false,
    isTest: true,
    isDesktop: false,
    isCapacitor: false,
    isBrowser: false,
    mode: 'test',
    baseUrl: '',
    userAgent: 'vitest',
    ...overrides,
  }
}

describe('EnvironmentResolver', () => {
  it('detects test environment via vitest', () => {
    const env = detectEnvironment()
    expect(env.isTest).toBe(true)
    expect(env.environment).toBe('test')
  })

  it('returns all required fields', () => {
    const env = detectEnvironment()
    expect(env).toHaveProperty('environment')
    expect(env).toHaveProperty('isDevelopment')
    expect(env).toHaveProperty('isProduction')
    expect(env).toHaveProperty('isTest')
    expect(env).toHaveProperty('isDesktop')
    expect(env).toHaveProperty('isCapacitor')
    expect(env).toHaveProperty('isBrowser')
    expect(env).toHaveProperty('mode')
    expect(env).toHaveProperty('baseUrl')
    expect(env).toHaveProperty('userAgent')
  })
})

describe('RuntimeConfiguration', () => {
  it('modeToBackend maps test to mock', () => {
    expect(modeToBackend('test')).toBe('mock')
  })

  it('modeToBackend passes through known backends', () => {
    expect(modeToBackend('mock')).toBe('mock')
    expect(modeToBackend('legacy')).toBe('legacy')
    expect(modeToBackend('supabase')).toBe('supabase')
    expect(modeToBackend('desktop')).toBe('desktop')
  })

  it('createRuntimeConfig uses test env to set mode', () => {
    const config = createRuntimeConfig(testEnv())
    expect(config.mode).toBe('test')
    expect(config.providerBackend).toBe('mock')
    expect(config.environment.isTest).toBe(true)
  })

  it('createRuntimeConfig uses overrides', () => {
    const config = createRuntimeConfig(testEnv(), { mode: 'legacy', apiUrl: 'https://api.example.com' })
    expect(config.mode).toBe('legacy')
    expect(config.providerBackend).toBe('legacy')
    expect(config.apiUrl).toBe('https://api.example.com')
  })

  it('createRuntimeConfig uses desktop env for desktop mode', () => {
    const config = createRuntimeConfig(
      testEnv({ isDesktop: true, environment: 'desktop', isTest: false }),
    )
    expect(config.mode).toBe('desktop')
    expect(config.providerBackend).toBe('desktop')
  })

  it('mode override takes precedence over environment', () => {
    const config = createRuntimeConfig(testEnv({ isDesktop: true, environment: 'desktop' }), { mode: 'mock' })
    expect(config.mode).toBe('mock')
    expect(config.providerBackend).toBe('mock')
  })

  it('returns version string', () => {
    const config = createRuntimeConfig(testEnv())
    expect(config.version).toBeTypeOf('string')
  })
})

describe('ProviderResolver', () => {
  it('resolves providers for mock backend', () => {
    const ctx = {
      token: 't', identityId: 'id', identityType: 'employee' as const,
      companyId: 'c1', roles: [], device: 'web' as const, timestamp: new Date(),
    }
    const config = createRuntimeConfig(testEnv(), { mode: 'mock' })
    const { registry, providerSet } = resolveProviders(config, ctx)
    expect(providerSet.salesOrder).toBeDefined()
    expect(providerSet.customer).toBeDefined()
    expect(providerSet.productCatalog).toBeDefined()
    expect(providerSet.inventory).toBeDefined()
    expect(providerSet.attendance).toBeDefined()
    expect(providerSet.collection).toBeDefined()
    expect(registry).toBeDefined()
  })

  it('resolves providers for legacy backend', () => {
    const ctx = {
      token: 't', identityId: 'id', identityType: 'employee' as const,
      companyId: 'c1', roles: [], device: 'web' as const, timestamp: new Date(),
    }
    const config = createRuntimeConfig(testEnv(), { mode: 'legacy' })
    const { providerSet } = resolveProviders(config, ctx)
    expect(providerSet.salesOrder).toBeDefined()
    expect(providerSet.customer).toBeDefined()
  })

  it('resolves providers for supabase backend', () => {
    const ctx = {
      token: 't', identityId: 'id', identityType: 'employee' as const,
      companyId: 'c1', roles: [], device: 'web' as const, timestamp: new Date(),
    }
    const config = createRuntimeConfig(testEnv(), { mode: 'supabase' })
    const { providerSet } = resolveProviders(config, ctx)
    expect(providerSet.salesOrder).toBeDefined()
    expect(providerSet.customer).toBeDefined()
  })

  it('creates registry with all 6 mock providers for health checks', () => {
    const ctx = {
      token: 't', identityId: 'id', identityType: 'employee' as const,
      companyId: 'c1', roles: [], device: 'web' as const, timestamp: new Date(),
    }
    const config = createRuntimeConfig(testEnv(), { mode: 'mock' })
    const { registry } = resolveProviders(config, ctx)
    expect(registry.getDefault()).toBe('salesOrder')
    expect(registry.getStatus('salesOrder')).toBe('connected')
    expect(registry.getStatus('customer')).toBe('connected')
    expect(registry.getStatus('productCatalog')).toBe('connected')
    expect(registry.getStatus('inventory')).toBe('connected')
    expect(registry.getStatus('attendance')).toBe('connected')
    expect(registry.getStatus('collection')).toBe('connected')
  })

  it('registry health checks return connected for all providers', async () => {
    const ctx = {
      token: 't', identityId: 'id', identityType: 'employee' as const,
      companyId: 'c1', roles: [], device: 'web' as const, timestamp: new Date(),
    }
    const config = createRuntimeConfig(testEnv(), { mode: 'mock' })
    const { registry } = resolveProviders(config, ctx)
    const results = await registry.healthCheckAll()
    expect(results.size).toBe(6)
    for (const result of results.values()) {
      expect(result.status).toBe('connected')
    }
  })

  it('throws for unknown backend', () => {
    const ctx = {
      token: 't', identityId: 'id', identityType: 'employee' as const,
      companyId: 'c1', roles: [], device: 'web' as const, timestamp: new Date(),
    }
    expect(() => resolveProviders(
      { mode: 'test', providerBackend: 'unknown' as any, environment: testEnv(), apiUrl: '', version: '0' },
      ctx,
    )).toThrow('Unknown provider backend')
  })
})

describe('AppBootstrap (createApp)', () => {
  it('returns complete bootstrap context with test env', () => {
    const app = createApp({ mode: 'test' })
    expect(app.registry).toBeDefined()
    expect(app.pipeline).toBeDefined()
    expect(app.pipeline.executeCommand).toBeTypeOf('function')
    expect(app.pipeline.executeQuery).toBeTypeOf('function')
    expect(app.providers).toBeDefined()
    expect(app.providers.salesOrder).toBeDefined()
    expect(app.config).toBeDefined()
    expect(app.config.mode).toBe('test')
    expect(app.config.providerBackend).toBe('mock')
    expect(app.context).toBeDefined()
    expect(app.createContext).toBeTypeOf('function')
  })

  it('returns pipeline that can execute mock commands', async () => {
    const app = createApp({ mode: 'mock' })
    const result = await app.pipeline.executeCommand({
      commandType: 'CreateOrderCommand',
      companyId: 'comp-1',
      customerId: 'cust-1',
      customerName: 'Test Co',
      salesRepId: 'emp-1',
      lines: [{
        productId: 'p1', productName: 'Prod', unitType: 'carton',
        unitPrice: 1000, quantity: 1,
      }],
      discount: 0,
      notes: null,
      session: { identityId: 'id-1', roles: [{ name: 'Sales Rep', capabilities: [{ code: 'orders.create', name: 'Create' }] }] },
    } as any)
    expect(isSuccess(result)).toBe(true)
  })

  it('returns pipeline that can execute mock queries', async () => {
    const app = createApp({ mode: 'mock' })
    const result = await app.pipeline.executeQuery({
      queryType: 'GetOrderQuery',
      orderId: 'ord-1',
    } as any)
    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) {
      expect((result.data as any).id).toBe('ord-1')
    }
  })

  it('accepts explicit context', () => {
    const ctx = {
      token: 'custom-token',
      identityId: 'custom-id',
      identityType: 'employee' as const,
      companyId: 'comp-2',
      roles: ['manager'],
      device: 'mobile' as const,
      timestamp: new Date('2026-07-06T12:00:00Z'),
    }
    const app = createApp({ mode: 'mock', context: ctx })
    expect(app.context.token).toBe('custom-token')
    expect(app.context.identityId).toBe('custom-id')
    expect(app.context.companyId).toBe('comp-2')
  })

  it('createContext factory produces valid RequestContext', () => {
    const app = createApp({ mode: 'mock' })
    const newCtx = app.createContext({
      token: 'new-token',
      identityId: 'new-id',
      identityType: 'customer',
      companyId: 'comp-3',
      roles: ['user'],
    })
    expect(newCtx.token).toBe('new-token')
    expect(newCtx.identityType).toBe('customer')
    expect(newCtx.timestamp).toBeInstanceOf(Date)
  })

  it('all backends produce the same bootstrap shape', () => {
    const modes: AppMode[] = ['mock', 'legacy', 'supabase', 'desktop']
    for (const mode of modes) {
      const app = createApp({ mode })
      expect(app.pipeline.executeCommand).toBeTypeOf('function')
      expect(app.pipeline.executeQuery).toBeTypeOf('function')
      expect(app.registry).toBeDefined()
      expect(app.providers.salesOrder).toBeDefined()
    }
  })

  it('test mode uses mock providers internally', () => {
    const app = createApp({ mode: 'test' })
    expect(app.config.mode).toBe('test')
    expect(app.config.providerBackend).toBe('mock')
  })

  it('overrides backend independently of mode', () => {
    const app = createApp({ mode: 'test', backend: 'supabase' })
    expect(app.config.mode).toBe('test')
    expect(app.config.providerBackend).toBe('supabase')
  })
})
