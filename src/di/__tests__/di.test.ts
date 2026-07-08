import { describe, it, expect } from 'vitest'
import { composeApplication } from '../CompositionRoot'
import { createProviderSet } from '../ProviderFactory'
import { resolveBackend, DEFAULT_BACKEND } from '../ProviderConfig'
import type { RequestContext } from '../../providers/contracts/RequestContext'
import { success, isSuccess, isFailure } from '../../application/results/ApplicationResult'

function mockContext(): RequestContext {
  return {
    token: 'test-token',
    identityId: 'identity-1',
    identityType: 'employee',
    companyId: 'comp-1',
    roles: ['admin'],
    device: 'web',
    timestamp: new Date('2026-07-05T10:00:00Z'),
  }
}

// ═══════════════════════════════════════════════════════════════
//  PROVIDER CONFIG
// ═══════════════════════════════════════════════════════════════

describe('ProviderConfig', () => {
  it('resolveBackend defaults to legacy', () => {
    expect(resolveBackend()).toBe('legacy')
    expect(resolveBackend('unknown')).toBe('legacy')
  })

  it('resolveBackend parses known values', () => {
    expect(resolveBackend('mock')).toBe('mock')
    expect(resolveBackend('legacy')).toBe('legacy')
    expect(resolveBackend('supabase')).toBe('supabase')
    expect(resolveBackend('desktop')).toBe('desktop')
  })

  it('DEFAULT_BACKEND is legacy', () => {
    expect(DEFAULT_BACKEND).toBe('legacy')
  })
})

// ═══════════════════════════════════════════════════════════════
//  PROVIDER FACTORY
// ═══════════════════════════════════════════════════════════════

describe('ProviderFactory', () => {
  const ctx = mockContext()

  it('creates mock provider set', () => {
    const set = createProviderSet('mock', ctx)
    expect(set.salesOrder).toBeDefined()
    expect(set.customer).toBeDefined()
    expect(set.productCatalog).toBeDefined()
    expect(set.inventory).toBeDefined()
    expect(set.attendance).toBeDefined()
    expect(set.collection).toBeDefined()
  })

  it('creates legacy provider set', () => {
    const set = createProviderSet('legacy', ctx)
    expect(set.salesOrder).toBeDefined()
    expect(set.customer).toBeDefined()
    expect(set.productCatalog).toBeDefined()
    expect(set.inventory).toBeDefined()
    expect(set.attendance).toBeDefined()
    expect(set.collection).toBeDefined()
  })

  it('creates supabase provider set', () => {
    const set = createProviderSet('supabase', ctx)
    expect(set.salesOrder).toBeDefined()
    expect(set.customer).toBeDefined()
    expect(set.productCatalog).toBeDefined()
    expect(set.inventory).toBeDefined()
    expect(set.attendance).toBeDefined()
    expect(set.collection).toBeDefined()
  })

  it('creates desktop provider set (falls back to legacy)', () => {
    const set = createProviderSet('desktop', ctx)
    expect(set.salesOrder).toBeDefined()
    expect(set.customer).toBeDefined()
  })

  it('throws for unknown backend', () => {
    expect(() => createProviderSet('unknown' as any, ctx)).toThrow('Unknown provider backend')
  })

  it('mock providers return sensible defaults', async () => {
    const set = createProviderSet('mock', ctx)
    const order = await set.salesOrder.getOrderById('test-1')
    expect(order).not.toBeNull()
    expect(order!.id).toBe('test-1')

    const missing = await set.salesOrder.getOrderById('nonexistent')
    expect(missing).toBeNull()

    const customer = await set.customer.getCustomerById('cust-1')
    expect(customer).not.toBeNull()
    expect(customer!.tradeName).toBe('Mock Customer')

    const product = await set.productCatalog.getProductById('p1')
    expect(product).not.toBeNull()
    expect(product!.productName).toBe('Mock Product')

    const inventory = await set.inventory.getInventoryLevel('p1')
    expect(inventory).not.toBeNull()
    expect(inventory!.quantity).toBe(100)

    const workday = await set.attendance.getWorkdayById('wd-1')
    expect(workday).not.toBeNull()
    expect(workday!.employeeId).toBe('emp-1')

    const payment = await set.collection.getPaymentById('col-1')
    expect(payment).not.toBeNull()
    expect(payment!.amount.amount).toBe(500)
  })

  it('mock provider context is not used (no RequestContext param)', () => {
    const set = createProviderSet('mock', mockContext())
    expect(() => set.salesOrder.placeNewOrder({} as any)).not.toThrow()
    expect(() => set.customer.registerNewCustomer({} as any)).not.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════
//  COMPOSITION ROOT
// ═══════════════════════════════════════════════════════════════

describe('CompositionRoot', () => {
  it('composeApplication returns pipeline and providers', () => {
    const app = composeApplication({ backend: 'mock', context: mockContext() })
    expect(app.pipeline).toBeDefined()
    expect(app.pipeline.executeCommand).toBeDefined()
    expect(app.pipeline.executeQuery).toBeDefined()
    expect(app.providers).toBeDefined()
    expect(app.providers.salesOrder).toBeDefined()
  })

  it('executes mock command through pipeline', async () => {
    const app = composeApplication({ backend: 'mock', context: mockContext() })
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

  it('executes mock query through pipeline', async () => {
    const app = composeApplication({ backend: 'mock', context: mockContext() })
    const result = await app.pipeline.executeQuery({
      queryType: 'GetOrderQuery',
      orderId: 'ord-1',
    } as any)
    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) {
      expect((result.data as any).id).toBe('ord-1')
    }
  })

  it('returns HANDLER_NOT_FOUND for unknown command', async () => {
    const app = composeApplication({ backend: 'mock', context: mockContext() })
    const result = await app.pipeline.executeCommand({ commandType: 'UnknownCommand' } as any)
    expect(isFailure(result)).toBe(true)
    expect((result as any).code === 'HANDLER_NOT_FOUND').toBe(true)
  })

  it('returns HANDLER_NOT_FOUND for unknown query', async () => {
    const app = composeApplication({ backend: 'mock', context: mockContext() })
    const result = await app.pipeline.executeQuery({ queryType: 'UnknownQuery' } as any)
    expect(isFailure(result)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
//  BACKEND INTERCHANGEABILITY
// ═══════════════════════════════════════════════════════════════

describe('Backend Interchangeability', () => {
  it('all backends produce the same pipeline shape', () => {
    const ctx = mockContext()
    for (const backend of ['mock', 'legacy', 'supabase', 'desktop'] as const) {
      const app = composeApplication({ backend, context: ctx })
      expect(app.pipeline.executeCommand).toBeTypeOf('function')
      expect(app.pipeline.executeQuery).toBeTypeOf('function')
    }
  })

  it('switching backends does not change application code', () => {
    const ctx = mockContext()
    const mockApp = composeApplication({ backend: 'mock', context: ctx })
    const legacyApp = composeApplication({ backend: 'legacy', context: ctx })
    expect(mockApp.pipeline.executeCommand.name).toBe(legacyApp.pipeline.executeCommand.name)
    expect(typeof mockApp.pipeline.executeCommand).toBe(typeof legacyApp.pipeline.executeCommand)
  })
})
