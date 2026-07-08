import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LegacySalesOrderProvider } from '../LegacySalesOrderProvider'
import { LegacyCustomerProvider } from '../LegacyCustomerProvider'
import { LegacyProductCatalogProvider } from '../LegacyProductCatalogProvider'
import { LegacyInventoryProvider } from '../LegacyInventoryProvider'
import { LegacyAttendanceProvider } from '../LegacyAttendanceProvider'
import { LegacyCollectionProvider } from '../LegacyCollectionProvider'
import { ProviderException } from '../../../contracts/exceptions'
import type { RequestContext } from '../../../contracts/RequestContext'
import { OrderStatus } from '../../../../domain/enums/OrderStatus'
import { WorkdayStatus } from '../../../../domain/enums/WorkdayStatus'
import { StockReservationStatus } from '../../../../domain/enums/DocumentStatus'

const mockRpc = vi.fn()
vi.mock('../../../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}))

function mockContext(overrides?: Partial<RequestContext>): RequestContext {
  return {
    token: 'test-token',
    identityId: 'identity-1',
    identityType: 'employee',
    companyId: 'comp-1',
    roles: ['admin'],
    device: 'web',
    timestamp: new Date('2026-07-05T10:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

const sampleUnifiedOrder = () => ({
  order: {
    id: 'ord-1',
    company_id: 'comp-1',
    customer_id: 'cust-1',
    snapshot_customer_name: 'Test Customer',
    owner_id: 'emp-1',
    created_by: 'emp-1',
    status: 'draft',
    subtotal: 1000,
    discount_amount: 0,
    total_amount: 1000,
    notes: null,
    created_at: '2026-07-05T10:00:00Z',
    updated_at: '2026-07-05T10:00:00Z',
  },
  items: [{
    id: 'li-1',
    product_id: 'p1',
    product_name: 'Product A',
    unit_type: 'carton',
    unit_price: 1000,
    unit_quantity: 1,
    total_price: 1000,
  }],
  collections: [],
  customer: null,
  status_history: [],
  modification_history: [],
  current_delivery: null,
  delivery_history: [],
  preparation: null,
  returns: [],
})

const sampleProductRow = () => ({
  id: 'p1',
  company_id: 'comp-1',
  category_id: 'cat-1',
  product_name: 'Product A',
  legacy_code: 'P001',
  description: 'Test product',
  carton_quantity: 24,
  carton_price: 2400,
  is_active: true,
  is_out_of_stock: false,
  product_units: [{ unit_type: 'carton', is_active: true }],
  inventory: { id: 'inv-1', quantity: 100 },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

const sampleCustomerRow = () => ({
  id: 'cust-1',
  company_id: 'comp-1',
  name: 'Test Co',
  full_name: 'Test Customer',
  phone: '01234567890',
  customer_type: 'retail',
  is_active: true,
  credit_limit: 5000,
  outstanding_balance: 0,
  address_line1: 'St',
  address_line2: 'District',
  city: 'City',
  governorate: 'Gov',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

const sampleWorkdayRow = () => ({
  session_id: 'wd-1',
  company_id: 'comp-1',
  employee_id: 'emp-1',
  status: 'active',
  started_at: '2026-07-05T08:00:00Z',
  date: '2026-07-05',
})

// ═══════════════════════════════════════════════════════════════
//  SALES ORDER PROVIDER
// ═══════════════════════════════════════════════════════════════

describe('LegacySalesOrderProvider', () => {
  const provider = new LegacySalesOrderProvider(mockContext())

  it('placeNewOrder calls governed_create_order', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'ord-1' }, error: null })
    const order = { id: 'ord-1', customerId: 'cust-1', lines: [], notes: null } as any
    await provider.placeNewOrder(order)
    expect(mockRpc).toHaveBeenCalledWith('governed_create_order', expect.objectContaining({
      p_customer_id: 'cust-1',
    }))
  })

  it('submitOrder calls governed_submit_order', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    const order = { id: 'ord-1' } as any
    await provider.submitOrder(order)
    expect(mockRpc).toHaveBeenCalledWith('governed_submit_order', { p_token: 'test-token', p_id: 'ord-1' })
  })

  it('approveOrder calls governed_approve_order', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    const order = { id: 'ord-1' } as any
    await provider.approveOrder(order)
    expect(mockRpc).toHaveBeenCalledWith('governed_approve_order', { p_token: 'test-token', p_id: 'ord-1' })
  })

  it('rejectOrder calls governed_return_order_for_revision', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    await provider.rejectOrder('ord-1', 'Invalid')
    expect(mockRpc).toHaveBeenCalledWith('governed_return_order_for_revision', {
      p_token: 'test-token', p_id: 'ord-1', p_reason: 'Invalid',
    })
  })

  it('cancelOrder calls governed_change_order_status', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    await provider.cancelOrder('ord-1')
    expect(mockRpc).toHaveBeenCalledWith('governed_change_order_status', {
      p_token: 'test-token', p_order_id: 'ord-1', p_new_status: 'cancelled', p_reason: null,
    })
  })

  it('recordPayment calls governed_record_credit_payment', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    const order = { id: 'ord-1' } as any
    await provider.recordPayment(order)
    expect(mockRpc).toHaveBeenCalledWith('governed_record_credit_payment', {
      p_token: 'test-token', p_invoice_id: 'ord-1', p_payment_method: 'cash',
    })
  })

  it('getOrderById returns mapped SalesOrder', async () => {
    mockRpc.mockResolvedValue({ data: sampleUnifiedOrder(), error: null })
    const result = await provider.getOrderById('ord-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('ord-1')
    expect(result!.status).toBe(OrderStatus.Draft)
    expect(result!.lines).toHaveLength(1)
    expect(result!.lines[0].productId).toBe('p1')
  })

  it('getOrderById returns null when not found', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    const result = await provider.getOrderById('ord-1')
    expect(result).toBeNull()
  })

  it('getCustomerOrders returns mapped orders', async () => {
    mockRpc.mockResolvedValue({ data: [{ ...sampleUnifiedOrder().order, id: 'ord-1' }], error: null })
    const result = await provider.getCustomerOrders('cust-1')
    expect(result).toHaveLength(1)
    expect(mockRpc).toHaveBeenCalledWith('get_customer_orders', {
      p_token: 'test-token', p_customer_id: 'cust-1',
    })
  })

  it('searchOrders calls get_unified_orders with criteria', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    await provider.searchOrders({ companyId: 'comp-1', searchText: 'test', limit: 10 })
    expect(mockRpc).toHaveBeenCalledWith('get_unified_orders', expect.objectContaining({
      p_search: 'test',
    }))
  })

  it('throws ProviderException on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('DB_ERROR') })
    await expect(provider.getOrderById('ord-1')).rejects.toThrow(ProviderException)
  })
})

// ═══════════════════════════════════════════════════════════════
//  CUSTOMER PROVIDER
// ═══════════════════════════════════════════════════════════════

describe('LegacyCustomerProvider', () => {
  const provider = new LegacyCustomerProvider(mockContext())

  it('registerNewCustomer calls governed_create_customer', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    const customer = {
      tradeName: 'Test Co', fullName: 'Test Customer',
      phone: { number: '0123', countryCode: '+2' },
      customerType: 'retail',
      creditLimit: { amount: 5000, currency: 'EGP' },
      address: { street: 'St', district: 'D', city: 'C', governorate: 'G' },
    } as any
    await provider.registerNewCustomer(customer)
    expect(mockRpc).toHaveBeenCalledWith('governed_create_customer', expect.objectContaining({
      p_name: 'Test Co', p_phone: '0123', p_credit_limit: 5000,
    }))
  })

  it('suspendCustomer calls governed_deactivate_customer', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    await provider.suspendCustomer('cust-1')
    expect(mockRpc).toHaveBeenCalledWith('governed_deactivate_customer', {
      p_token: 'test-token', p_id: 'cust-1',
    })
  })

  it('updateCreditLimit calls governed_update_customer', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    await provider.updateCreditLimit('cust-1', 10000)
    expect(mockRpc).toHaveBeenCalledWith('governed_update_customer', {
      p_token: 'test-token', p_id: 'cust-1', p_credit_limit: 10000,
    })
  })

  it('getCustomerById returns mapped Customer', async () => {
    mockRpc.mockResolvedValue({ data: sampleCustomerRow(), error: null })
    const result = await provider.getCustomerById('cust-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('cust-1')
    expect(result!.tradeName).toBe('Test Co')
  })

  it('getCustomerById returns null for empty result', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    const result = await provider.getCustomerById('cust-1')
    expect(result).toBeNull()
  })

  it('searchCustomers calls get_governed_customers', async () => {
    mockRpc.mockResolvedValue({ data: [sampleCustomerRow()], error: null })
    const result = await provider.searchCustomers({ companyId: 'comp-1', searchQuery: 'Test' })
    expect(result).toHaveLength(1)
    expect(mockRpc).toHaveBeenCalledWith('get_governed_customers', expect.objectContaining({
      p_search: 'Test',
    }))
  })
})

// ═══════════════════════════════════════════════════════════════
//  PRODUCT CATALOG PROVIDER
// ═══════════════════════════════════════════════════════════════

describe('LegacyProductCatalogProvider', () => {
  const provider = new LegacyProductCatalogProvider(mockContext())

  it('getProductById returns mapped Product', async () => {
    mockRpc.mockResolvedValue({ data: [sampleProductRow()], error: null })
    const result = await provider.getProductById('p1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('p1')
    expect(result!.productName).toBe('Product A')
    expect(result!.isOutOfStock).toBe(false)
  })

  it('getProductById returns null when not found', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    const result = await provider.getProductById('nonexistent')
    expect(result).toBeNull()
  })

  it('searchProducts returns mapped products', async () => {
    mockRpc.mockResolvedValue({ data: [sampleProductRow()], error: null })
    const result = await provider.searchProducts({ companyId: 'comp-1', searchQuery: 'Product' })
    expect(result).toHaveLength(1)
    expect(mockRpc).toHaveBeenCalledWith('get_governed_products', expect.objectContaining({
      p_search: 'Product',
    }))
  })

  it('getCompanyProducts returns all products for company', async () => {
    mockRpc.mockResolvedValue({ data: [sampleProductRow()], error: null })
    const result = await provider.getCompanyProducts('comp-1')
    expect(result).toHaveLength(1)
    expect(mockRpc).toHaveBeenCalledWith('get_governed_products', expect.objectContaining({
      p_company_id: 'comp-1',
    }))
  })
})

// ═══════════════════════════════════════════════════════════════
//  INVENTORY PROVIDER
// ═══════════════════════════════════════════════════════════════

describe('LegacyInventoryProvider', () => {
  const provider = new LegacyInventoryProvider(mockContext())

  it('reserveStock returns in-memory reservation', async () => {
    const result = await provider.reserveStock('p1', 10, 'ord-1')
    expect(result.productId).toBe('p1')
    expect(result.quantityReserved).toBe(10)
    expect(result.orderId).toBe('ord-1')
    expect(result.status).toBe(StockReservationStatus.Active)
  })

  it('adjustInventory calls governed_update_product_inventory', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })
    mockRpc.mockResolvedValueOnce({ data: [{ ...sampleProductRow() }], error: null })
    const result = await provider.adjustInventory('p1', 50, 'restock')
    expect(mockRpc).toHaveBeenCalledWith('governed_update_product_inventory', {
      p_token: 'test-token', p_product_id: 'p1', p_quantity: 50,
    })
    expect(result.productId).toBe('p1')
  })

  it('getInventoryLevel returns inventory from product data', async () => {
    mockRpc.mockResolvedValue({ data: [sampleProductRow()], error: null })
    const result = await provider.getInventoryLevel('p1')
    expect(result).not.toBeNull()
    expect(result!.quantity).toBe(100)
  })

  it('getInventoryLevel returns null for unknown product', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    const result = await provider.getInventoryLevel('unknown')
    expect(result).toBeNull()
  })

  it('getInventoryByCompany returns inventory records', async () => {
    mockRpc.mockResolvedValue({ data: [sampleProductRow()], error: null })
    const result = await provider.getInventoryByCompany('comp-1')
    expect(result).toHaveLength(1)
    expect(result[0].productId).toBe('p1')
  })
})

// ═══════════════════════════════════════════════════════════════
//  ATTENDANCE PROVIDER
// ═══════════════════════════════════════════════════════════════

describe('LegacyAttendanceProvider', () => {
  const provider = new LegacyAttendanceProvider(mockContext())

  it('startWorkday calls start_workday RPC', async () => {
    mockRpc.mockResolvedValue({ data: { session_id: 'wd-1', started_at: '2026-07-05T08:00:00Z' }, error: null })
    const workday = { id: 'wd-1', companyId: 'comp-1', employeeId: 'emp-1', date: new Date('2026-07-05'), status: WorkdayStatus.Active, checkIn: new Date(), checkOut: null, checkInLocation: null, checkOutLocation: null, notes: null }
    await provider.startWorkday(workday)
    expect(mockRpc).toHaveBeenCalledWith('start_workday', {
      p_token: 'test-token', p_latitude: null, p_longitude: null, p_device_status: null,
    })
  })

  it('endWorkday calls end_workday RPC', async () => {
    mockRpc.mockResolvedValue({ data: { session_id: 'wd-1', ended_at: '2026-07-05T16:00:00Z' }, error: null })
    await provider.endWorkday('wd-1', new Date('2026-07-05T16:00:00Z'), 30.0, 31.0)
    expect(mockRpc).toHaveBeenCalledWith('end_workday', {
      p_token: 'test-token', p_session_id: 'wd-1', p_latitude: 30.0, p_longitude: 31.0, p_device_status: null,
    })
  })

  it('getWorkdayById returns mapped Workday', async () => {
    mockRpc.mockResolvedValue({ data: sampleWorkdayRow(), error: null })
    const result = await provider.getWorkdayById('wd-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('wd-1')
    expect(result!.status).toBe(WorkdayStatus.Active)
  })

  it('getWorkdayByEmployeeAndDate calls get_employee_workday_history', async () => {
    mockRpc.mockResolvedValue({ data: [{ ...sampleWorkdayRow(), status: 'completed' }], error: null })
    const result = await provider.getWorkdayByEmployeeAndDate('emp-1', new Date('2026-07-05'))
    expect(result).not.toBeNull()
    expect(mockRpc).toHaveBeenCalledWith('get_employee_workday_history', {
      p_token: 'test-token', p_employee_id: 'emp-1', p_from: '2026-07-05', p_to: '2026-07-05',
    })
  })

  it('getWorkdayRange returns workday list', async () => {
    mockRpc.mockResolvedValue({ data: [sampleWorkdayRow()], error: null })
    const result = await provider.getWorkdayRange('comp-1', new Date('2026-07-01'), new Date('2026-07-31'))
    expect(result).toHaveLength(1)
    expect(mockRpc).toHaveBeenCalledWith('get_workday_report', expect.objectContaining({
      p_from: '2026-07-01', p_to: '2026-07-31',
    }))
  })
})

// ═══════════════════════════════════════════════════════════════
//  COLLECTION PROVIDER
// ═══════════════════════════════════════════════════════════════

describe('LegacyCollectionProvider', () => {
  const provider = new LegacyCollectionProvider(mockContext())

  it('receiveCashPayment calls governed_record_credit_payment', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    const payment = { orderId: 'ord-1', amount: { amount: 500 } } as any
    await provider.receiveCashPayment(payment)
    expect(mockRpc).toHaveBeenCalledWith('governed_record_credit_payment', {
      p_token: 'test-token', p_invoice_id: 'ord-1', p_payment_method: 'cash',
    })
  })

  it('receiveCheckPayment calls governed_record_cheque', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    const payment = { orderId: 'ord-1', checkNumber: 'CHK001', bankName: 'NBE', amount: { amount: 1000 }, dueDate: new Date('2026-08-01') } as any
    await provider.receiveCheckPayment(payment)
    expect(mockRpc).toHaveBeenCalledWith('governed_record_cheque', {
      p_token: 'test-token', p_invoice_id: 'ord-1', p_cheque_number: 'CHK001',
      p_bank_name: 'NBE', p_amount: 1000, p_due_date: '2026-08-01T00:00:00.000Z',
    })
  })

  it('getPaymentsByOrder extracts collections from order', async () => {
    const orderData = sampleUnifiedOrder()
    orderData.collections = [{ id: 'col-1', method: 'cash', amount: 500, status: 'approved', reference_number: null, collected_at: '2026-07-05T12:00:00Z', order_id: 'ord-1' }]
    mockRpc.mockResolvedValue({ data: orderData, error: null })
    const result = await provider.getPaymentsByOrder('ord-1')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('col-1')
    expect(result[0].amount.amount).toBe(500)
  })

  it('getPaymentById returns payment from collections', async () => {
    mockRpc.mockResolvedValue({ data: [{ id: 'col-1', method: 'cash', amount: 500, status: 'approved', reference_number: null, collected_at: '2026-07-05T12:00:00Z' }], error: null })
    const result = await provider.getPaymentById('col-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('col-1')
  })

  it('getPaymentById returns null when not found', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    const result = await provider.getPaymentById('nonexistent')
    expect(result).toBeNull()
  })
})
