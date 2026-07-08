import { describe, it, expect } from 'vitest'
import { MockSalesOrderProvider } from '../MockSalesOrderProvider'
import { MockCustomerProvider } from '../MockCustomerProvider'
import { MockProductCatalogProvider } from '../MockProductCatalogProvider'
import { MockInventoryProvider } from '../MockInventoryProvider'
import { MockAttendanceProvider } from '../MockAttendanceProvider'
import { MockCollectionProvider } from '../MockCollectionProvider'
import { OrderStatus } from '../../../../domain/enums/OrderStatus'
import { WorkdayStatus } from '../../../../domain/enums/WorkdayStatus'

describe('MockSalesOrderProvider', () => {
  const provider = new MockSalesOrderProvider()

  it('implements IProvider lifecycle', async () => {
    expect(provider.name).toBe('salesOrder')
    await expect(provider.connect()).resolves.toBeUndefined()
    await expect(provider.disconnect()).resolves.toBeUndefined()
    const health = await provider.healthCheck()
    expect(health.status).toBe('connected')
  })

  it('placeNewOrder does not throw', async () => {
    await expect(provider.placeNewOrder({} as any)).resolves.toBeUndefined()
  })

  it('getOrderById returns mock order', async () => {
    const result = await provider.getOrderById('test-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('test-1')
    expect(result!.status).toBe(OrderStatus.Draft)
  })

  it('getOrderById returns null for nonexistent', async () => {
    const result = await provider.getOrderById('nonexistent')
    expect(result).toBeNull()
  })

  it('getCustomerOrders returns empty', async () => {
    const result = await provider.getCustomerOrders('cust-1')
    expect(result).toEqual([])
  })
})

describe('MockCustomerProvider', () => {
  const provider = new MockCustomerProvider()

  it('getCustomerById returns mock customer', async () => {
    const result = await provider.getCustomerById('cust-1')
    expect(result).not.toBeNull()
    expect(result!.tradeName).toBe('Mock Customer')
  })

  it('getCustomerById returns null for nonexistent', async () => {
    const result = await provider.getCustomerById('nonexistent')
    expect(result).toBeNull()
  })

  it('suspendCustomer does not throw', async () => {
    await expect(provider.suspendCustomer('cust-1')).resolves.toBeUndefined()
  })
})

describe('MockProductCatalogProvider', () => {
  const provider = new MockProductCatalogProvider()

  it('getProductById returns mock product', async () => {
    const result = await provider.getProductById('p1')
    expect(result).not.toBeNull()
    expect(result!.productName).toBe('Mock Product')
  })

  it('getProductById returns null for nonexistent', async () => {
    const result = await provider.getProductById('nonexistent')
    expect(result).toBeNull()
  })

  it('searchProducts returns empty', async () => {
    const result = await provider.searchProducts({ companyId: 'comp-1' })
    expect(result).toEqual([])
  })
})

describe('MockInventoryProvider', () => {
  const provider = new MockInventoryProvider()

  it('reserveStock returns reservation', async () => {
    const result = await provider.reserveStock('p1', 10, 'ord-1')
    expect(result.productId).toBe('p1')
    expect(result.quantityReserved).toBe(10)
  })

  it('getInventoryLevel returns mock data', async () => {
    const result = await provider.getInventoryLevel('p1')
    expect(result).not.toBeNull()
    expect(result!.quantity).toBe(100)
  })

  it('getInventoryLevel returns null for unknown', async () => {
    const result = await provider.getInventoryLevel('unknown')
    expect(result).toBeNull()
  })
})

describe('MockAttendanceProvider', () => {
  const provider = new MockAttendanceProvider()

  it('startWorkday does not throw', async () => {
    await expect(provider.startWorkday({} as any)).resolves.toBeUndefined()
  })

  it('getWorkdayById returns mock workday', async () => {
    const result = await provider.getWorkdayById('wd-1')
    expect(result).not.toBeNull()
    expect(result!.employeeId).toBe('emp-1')
    expect(result!.status).toBe(WorkdayStatus.Active)
  })

  it('getWorkdayById returns null for nonexistent', async () => {
    const result = await provider.getWorkdayById('nonexistent')
    expect(result).toBeNull()
  })
})

describe('MockCollectionProvider', () => {
  const provider = new MockCollectionProvider()

  it('receiveCashPayment does not throw', async () => {
    await expect(provider.receiveCashPayment({} as any)).resolves.toBeUndefined()
  })

  it('getPaymentById returns mock payment', async () => {
    const result = await provider.getPaymentById('col-1')
    expect(result).not.toBeNull()
    expect(result!.amount.amount).toBe(500)
  })

  it('getPaymentById returns null for nonexistent', async () => {
    const result = await provider.getPaymentById('nonexistent')
    expect(result).toBeNull()
  })

  it('depositCheck does not throw', async () => {
    await expect(provider.depositCheck('col-1')).resolves.toBeUndefined()
  })
})
