import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupabaseSalesOrderProvider } from '../SupabaseSalesOrderProvider'
import { SupabaseCustomerProvider } from '../SupabaseCustomerProvider'
import { SupabaseProductCatalogProvider } from '../SupabaseProductCatalogProvider'
import { SupabaseInventoryProvider } from '../SupabaseInventoryProvider'
import { SupabaseAttendanceProvider } from '../SupabaseAttendanceProvider'
import { SupabaseCollectionProvider } from '../SupabaseCollectionProvider'
import { ProviderException } from '../../../contracts/exceptions'
import type { RequestContext } from '../../../contracts/RequestContext'
import { OrderStatus } from '../../../../domain/enums/OrderStatus'
import { WorkdayStatus } from '../../../../domain/enums/WorkdayStatus'
import { StockReservationStatus } from '../../../../domain/enums/DocumentStatus'

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

let mockCurrentResult: unknown = null

const mockThen = (resolve: (value: unknown) => unknown) => resolve({ data: mockCurrentResult, error: null })

const mockChain: any = {
  then: mockThen,
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
  neq: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  in: vi.fn(),
  or: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  range: vi.fn(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
}

function resetChain() {
  mockCurrentResult = null
  for (const key of Object.keys(mockChain)) {
    if (typeof mockChain[key]?.mockReset === 'function') mockChain[key].mockReset()
  }
  mockChain.then = (resolve: (value: unknown) => unknown) => resolve({ data: mockCurrentResult, error: null })
  mockChain.select.mockReturnValue(mockChain)
  mockChain.insert.mockReturnValue(mockChain)
  mockChain.update.mockReturnValue(mockChain)
  mockChain.delete.mockReturnValue(mockChain)
  mockChain.eq.mockReturnValue(mockChain)
  mockChain.neq.mockReturnValue(mockChain)
  mockChain.gte.mockReturnValue(mockChain)
  mockChain.lte.mockReturnValue(mockChain)
  mockChain.in.mockReturnValue(mockChain)
  mockChain.or.mockReturnValue(mockChain)
  mockChain.order.mockReturnValue(mockChain)
  mockChain.limit.mockReturnValue(mockChain)
  mockChain.range.mockReturnValue(mockChain)
  mockChain.upsert.mockReturnValue(mockChain)
}

function mockResult(result: unknown) {
  resetChain()
  mockCurrentResult = result
  const promise = Promise.resolve({ data: result, error: null })
  mockChain.single.mockReturnValue(promise)
  mockChain.maybeSingle.mockReturnValue(promise)
  mockChain.then = (resolve: (value: unknown) => unknown) => resolve({ data: result, error: null })
  return promise
}

function mockError(msg: string) {
  resetChain()
  mockCurrentResult = null
  const promise = Promise.resolve({ data: null, error: new Error(msg) })
  mockChain.single.mockReturnValue(promise)
  mockChain.maybeSingle.mockReturnValue(promise)
  mockChain.then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: new Error(msg) })
  return promise
}

const mockFrom = vi.fn()
vi.mock('../client', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}))

beforeEach(() => {
  vi.clearAllMocks()
  resetChain()
  mockFrom.mockReturnValue(mockChain)
})

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

const sampleOrderRow = () => ({
  id: 'ord-1',
  company_id: 'comp-1',
  customer_id: 'cust-1',
  snapshot_customer_name: 'Test Customer',
  owner_id: 'emp-1',
  created_by: 'emp-1',
  status: 'draft',
  order_number: null,
  subtotal: 1000,
  discount_amount: 0,
  total_amount: 1000,
  notes: null,
  created_at: '2026-07-05T10:00:00Z',
  updated_at: '2026-07-05T10:00:00Z',
  order_items: [{
    id: 'li-1', order_id: 'ord-1', product_id: 'p1',
    product_name: 'Product A', unit_type: 'carton',
    unit_price: 1000, unit_quantity: 1, total_price: 1000,
  }],
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
  image_url: null,
  product_units: [{ id: 'pu-1', product_id: 'p1', unit_type: 'carton', is_active: true, created_at: '2026-01-01T00:00:00Z' }],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

const sampleInventoryRow = () => ({
  id: 'inv-1',
  product_id: 'p1',
  quantity: 100,
  last_counted_at: null,
  notes: null,
  updated_at: '2026-01-01T00:00:00Z',
})

const sampleWorkdayRow = () => ({
  session_id: 'wd-1',
  company_id: 'comp-1',
  employee_id: 'emp-1',
  date: '2026-07-05',
  status: 'active',
  started_at: '2026-07-05T08:00:00Z',
  ended_at: null,
  check_in_latitude: null,
  check_in_longitude: null,
  check_in_accuracy: null,
  check_in_captured_at: null,
  check_out_latitude: null,
  check_out_longitude: null,
  check_out_accuracy: null,
  check_out_captured_at: null,
  notes: null,
})

const sampleCollectionRow = () => ({
  id: 'col-1',
  order_id: 'ord-1',
  customer_id: 'cust-1',
  method: 'cash',
  amount: 500,
  reference_number: null,
  bank_name: null,
  due_date: null,
  status: 'approved',
  collected_at: '2026-07-05T12:00:00Z',
  created_at: '2026-07-05T12:00:00Z',
})

// ═══════════════════════════════════════════════════════════════
//  SALES ORDER PROVIDER
// ═══════════════════════════════════════════════════════════════

describe('SupabaseSalesOrderProvider', () => {
  const provider = new SupabaseSalesOrderProvider(mockContext())

  it('placeNewOrder inserts order + items', async () => {
    mockChain.single.mockReturnValue(Promise.resolve({ data: { id: 'ord-1' }, error: null }))
    mockChain.insert.mockReturnValue(mockChain)
    mockChain.select.mockReturnValue(mockChain)
    mockFrom.mockReturnValue(mockChain)
    const order = { id: 'ord-1', companyId: 'comp-1', customerId: 'cust-1', customerName: 'Test Co', salesRepId: 'emp-1', subtotal: { amount: 1000 }, discount: { amount: 0 }, grandTotal: { amount: 1000 }, lines: [{ productId: 'p1', productName: 'Prod', unitType: 'carton', unitPrice: { amount: 1000 }, quantity: 1, total: { amount: 1000 } }], notes: null } as any
    await provider.placeNewOrder(order)
    expect(mockFrom).toHaveBeenCalledWith('orders')
    expect(mockFrom).toHaveBeenCalledWith('order_items')
  })

  it('submitOrder updates order status to submitted', async () => {
    mockResult(null)
    const order = { id: 'ord-1' } as any
    await provider.submitOrder(order)
    expect(mockFrom).toHaveBeenCalledWith('orders')
    expect(mockChain.update).toHaveBeenCalled()
    expect(mockChain.eq).toHaveBeenCalledWith('id', 'ord-1')
  })

  it('approveOrder updates order status to reviewing', async () => {
    mockResult(null)
    const order = { id: 'ord-1' } as any
    await provider.approveOrder(order)
    expect(mockChain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'reviewing' }))
  })

  it('rejectOrder updates status with reason', async () => {
    mockResult(null)
    await provider.rejectOrder('ord-1', 'Invalid')
    expect(mockChain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'returned_for_revision', notes: 'Invalid' }))
    expect(mockChain.eq).toHaveBeenCalledWith('id', 'ord-1')
  })

  it('cancelOrder updates status to cancelled', async () => {
    mockResult(null)
    await provider.cancelOrder('ord-1')
    expect(mockChain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })

  it('recordPayment inserts collection', async () => {
    mockResult(null)
    const order = { id: 'ord-1', customerId: 'cust-1', grandTotal: { amount: 1000 } } as any
    await provider.recordPayment(order)
    expect(mockFrom).toHaveBeenCalledWith('collections')
    expect(mockChain.insert).toHaveBeenCalledWith(expect.objectContaining({ order_id: 'ord-1', method: 'cash' }))
  })

  it('getOrderById returns mapped SalesOrder', async () => {
    mockResult(sampleOrderRow())
    const result = await provider.getOrderById('ord-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('ord-1')
    expect(result!.status).toBe(OrderStatus.Draft)
    expect(result!.lines).toHaveLength(1)
    expect(mockChain.select).toHaveBeenCalledWith('*, order_items(*)')
  })

  it('getOrderById returns null when not found', async () => {
    mockResult(null)
    const result = await provider.getOrderById('ord-1')
    expect(result).toBeNull()
  })

  it('getCustomerOrders returns mapped orders', async () => {
    mockResult([sampleOrderRow()])
    const result = await provider.getCustomerOrders('cust-1')
    expect(result).toHaveLength(1)
    expect(mockChain.eq).toHaveBeenCalledWith('customer_id', 'cust-1')
  })

  it('searchOrders builds query with criteria', async () => {
    mockResult([sampleOrderRow()])
    await provider.searchOrders({ companyId: 'comp-1', searchText: 'test', limit: 10 })
    expect(mockChain.eq).toHaveBeenCalledWith('company_id', 'comp-1')
    expect(mockChain.limit).toHaveBeenCalledWith(10)
  })

  it('throws ProviderException on error', async () => {
    mockError('DB_ERROR')
    await expect(provider.getOrderById('ord-1')).rejects.toThrow(ProviderException)
  })
})

// ═══════════════════════════════════════════════════════════════
//  CUSTOMER PROVIDER
// ═══════════════════════════════════════════════════════════════

describe('SupabaseCustomerProvider', () => {
  const provider = new SupabaseCustomerProvider(mockContext())

  it('registerNewCustomer inserts customer', async () => {
    mockResult(null)
    const customer = {
      companyId: 'comp-1', tradeName: 'Test Co', fullName: 'Test',
      phone: { number: '0123', countryCode: '+2' },
      customerType: 'retail',
      creditLimit: { amount: 5000 },
      address: { street: 'St', district: 'D', city: 'C', governorate: 'G' },
    } as any
    await provider.registerNewCustomer(customer)
    expect(mockFrom).toHaveBeenCalledWith('customers')
    expect(mockChain.insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test Co' }))
  })

  it('suspendCustomer updates is_active to false', async () => {
    mockResult(null)
    await provider.suspendCustomer('cust-1')
    expect(mockChain.update).toHaveBeenCalledWith({ is_active: false })
    expect(mockChain.eq).toHaveBeenCalledWith('id', 'cust-1')
  })

  it('updateCreditLimit updates credit_limit', async () => {
    mockResult(null)
    await provider.updateCreditLimit('cust-1', 10000)
    expect(mockChain.update).toHaveBeenCalledWith({ credit_limit: 10000 })
  })

  it('getCustomerById returns mapped Customer', async () => {
    mockResult(sampleCustomerRow())
    const result = await provider.getCustomerById('cust-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('cust-1')
    expect(result!.tradeName).toBe('Test Co')
  })

  it('getCustomerById returns null when not found', async () => {
    mockResult(null)
    const result = await provider.getCustomerById('cust-1')
    expect(result).toBeNull()
  })

  it('searchCustomers builds query with filters', async () => {
    mockResult([sampleCustomerRow()])
    const result = await provider.searchCustomers({ companyId: 'comp-1', searchQuery: 'Test' })
    expect(result).toHaveLength(1)
    expect(mockChain.eq).toHaveBeenCalledWith('company_id', 'comp-1')
  })
})

// ═══════════════════════════════════════════════════════════════
//  PRODUCT CATALOG PROVIDER
// ═══════════════════════════════════════════════════════════════

describe('SupabaseProductCatalogProvider', () => {
  const provider = new SupabaseProductCatalogProvider(mockContext())

  it('getProductById returns mapped Product', async () => {
    mockResult(sampleProductRow())
    const result = await provider.getProductById('p1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('p1')
    expect(result!.productName).toBe('Product A')
    expect(mockChain.select).toHaveBeenCalledWith('*, product_units(*)')
  })

  it('getProductById returns null when not found', async () => {
    mockResult(null)
    const result = await provider.getProductById('nonexistent')
    expect(result).toBeNull()
  })

  it('searchProducts returns mapped products', async () => {
    mockResult([sampleProductRow()])
    const result = await provider.searchProducts({ companyId: 'comp-1', searchQuery: 'Product' })
    expect(result).toHaveLength(1)
    expect(mockChain.eq).toHaveBeenCalledWith('company_id', 'comp-1')
  })

  it('getCompanyProducts returns all products for company', async () => {
    mockResult([sampleProductRow()])
    const result = await provider.getCompanyProducts('comp-1')
    expect(result).toHaveLength(1)
    expect(mockChain.eq).toHaveBeenCalledWith('company_id', 'comp-1')
  })
})

// ═══════════════════════════════════════════════════════════════
//  INVENTORY PROVIDER
// ═══════════════════════════════════════════════════════════════

describe('SupabaseInventoryProvider', () => {
  const provider = new SupabaseInventoryProvider(mockContext())

  it('reserveStock returns in-memory reservation', async () => {
    const result = await provider.reserveStock('p1', 10, 'ord-1')
    expect(result.productId).toBe('p1')
    expect(result.quantityReserved).toBe(10)
    expect(result.status).toBe(StockReservationStatus.Active)
  })

  it('adjustInventory upserts inventory', async () => {
    mockChain.single.mockReturnValue(Promise.resolve({ data: null, error: null }))
    mockChain.maybeSingle.mockReturnValue(Promise.resolve({ data: null, error: null }))
    mockChain.upsert.mockReturnValue(mockChain)
    mockFrom.mockReturnValue(mockChain)
    mockChain.eq.mockReturnValue(mockChain)
    mockChain.select.mockReturnValue(mockChain)
    mockResult(null)
    await provider.adjustInventory('p1', 50, 'restock')
    expect(mockFrom).toHaveBeenCalledWith('inventory')
    expect(mockChain.upsert).toHaveBeenCalled()
  })

  it('getInventoryLevel returns inventory from table', async () => {
    mockResult(sampleInventoryRow())
    const result = await provider.getInventoryLevel('p1')
    expect(result).not.toBeNull()
    expect(result!.quantity).toBe(100)
    expect(mockChain.eq).toHaveBeenCalledWith('product_id', 'p1')
  })

  it('getInventoryLevel returns null for unknown product', async () => {
    mockResult(null)
    const result = await provider.getInventoryLevel('unknown')
    expect(result).toBeNull()
  })

  it('getInventoryByCompany returns inventory records', async () => {
    const productData = { ...sampleProductRow(), inventory: sampleInventoryRow() }
    mockResult([productData])
    const result = await provider.getInventoryByCompany('comp-1')
    expect(result).toHaveLength(1)
    expect(result[0].productId).toBe('p1')
  })
})

// ═══════════════════════════════════════════════════════════════
//  ATTENDANCE PROVIDER
// ═══════════════════════════════════════════════════════════════

describe('SupabaseAttendanceProvider', () => {
  const provider = new SupabaseAttendanceProvider(mockContext())

  it('startWorkday inserts workday session', async () => {
    mockResult(null)
    const workday = { id: 'wd-1', companyId: 'comp-1', employeeId: 'emp-1', date: new Date('2026-07-05'), status: WorkdayStatus.Active, checkIn: new Date(), checkOut: null, checkInLocation: null, checkOutLocation: null, notes: null }
    await provider.startWorkday(workday)
    expect(mockFrom).toHaveBeenCalledWith('workday_sessions')
    expect(mockChain.insert).toHaveBeenCalledWith(expect.objectContaining({ employee_id: 'emp-1', status: 'active' }))
  })

  it('endWorkday updates session', async () => {
    mockResult(null)
    await provider.endWorkday('wd-1', new Date('2026-07-05T16:00:00Z'))
    expect(mockChain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
    expect(mockChain.eq).toHaveBeenCalledWith('session_id', 'wd-1')
  })

  it('getWorkdayById returns mapped Workday', async () => {
    mockResult(sampleWorkdayRow())
    const result = await provider.getWorkdayById('wd-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('wd-1')
    expect(result!.status).toBe(WorkdayStatus.Active)
  })

  it('getWorkdayByEmployeeAndDate returns workday', async () => {
    mockResult(sampleWorkdayRow())
    const result = await provider.getWorkdayByEmployeeAndDate('emp-1', new Date('2026-07-05'))
    expect(result).not.toBeNull()
    expect(mockChain.eq).toHaveBeenCalledWith('employee_id', 'emp-1')
    expect(mockChain.eq).toHaveBeenCalledWith('date', '2026-07-05')
  })

  it('getWorkdayRange returns workday list', async () => {
    mockResult([sampleWorkdayRow()])
    const result = await provider.getWorkdayRange('comp-1', new Date('2026-07-01'), new Date('2026-07-31'))
    expect(result).toHaveLength(1)
    expect(mockChain.gte).toHaveBeenCalledWith('date', '2026-07-01')
    expect(mockChain.lte).toHaveBeenCalledWith('date', '2026-07-31')
  })
})

// ═══════════════════════════════════════════════════════════════
//  COLLECTION PROVIDER
// ═══════════════════════════════════════════════════════════════

describe('SupabaseCollectionProvider', () => {
  const provider = new SupabaseCollectionProvider(mockContext())

  it('receiveCashPayment inserts cash collection', async () => {
    mockResult(null)
    const payment = { orderId: 'ord-1', customerId: 'cust-1', amount: { amount: 500 } } as any
    await provider.receiveCashPayment(payment)
    expect(mockFrom).toHaveBeenCalledWith('collections')
    expect(mockChain.insert).toHaveBeenCalledWith(expect.objectContaining({ method: 'cash', status: 'approved' }))
  })

  it('receiveCheckPayment inserts check collection', async () => {
    mockResult(null)
    const payment = { orderId: 'ord-1', customerId: 'cust-1', checkNumber: 'CHK001', bankName: 'NBE', amount: { amount: 1000 }, dueDate: new Date('2026-08-01') } as any
    await provider.receiveCheckPayment(payment)
    expect(mockChain.insert).toHaveBeenCalledWith(expect.objectContaining({ method: 'check', reference_number: 'CHK001', bank_name: 'NBE' }))
  })

  it('depositCheck updates status to deposited', async () => {
    mockResult(null)
    await provider.depositCheck('col-1')
    expect(mockChain.update).toHaveBeenCalledWith({ status: 'deposited' })
    expect(mockChain.eq).toHaveBeenCalledWith('id', 'col-1')
  })

  it('clearCheck updates status to cleared', async () => {
    mockResult(null)
    await provider.clearCheck('col-1')
    expect(mockChain.update).toHaveBeenCalledWith({ status: 'cleared' })
  })

  it('returnCheck updates status to returned', async () => {
    mockResult(null)
    await provider.returnCheck('col-1', 'bounced')
    expect(mockChain.update).toHaveBeenCalledWith({ status: 'returned', reference_number: 'bounced' })
  })

  it('getPaymentsByOrder returns mapped payments', async () => {
    mockResult([sampleCollectionRow()])
    const result = await provider.getPaymentsByOrder('ord-1')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('col-1')
    expect(mockChain.eq).toHaveBeenCalledWith('order_id', 'ord-1')
  })

  it('getPaymentById returns payment', async () => {
    mockResult(sampleCollectionRow())
    const result = await provider.getPaymentById('col-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('col-1')
    expect(result!.amount.amount).toBe(500)
  })

  it('getPaymentById returns null when not found', async () => {
    mockResult(null)
    const result = await provider.getPaymentById('nonexistent')
    expect(result).toBeNull()
  })
})
