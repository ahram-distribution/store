import { describe, it, expect, vi } from 'vitest'

// ── Results ────────────────────────────────────────────────────
import {
  success, failure, validationFailure, authorizationFailure, conflict,
  isSuccess, isFailure, isValidationFailure, isAuthorizationFailure, isConflict,
} from '../results/ApplicationResult'

// ── Validators ──────────────────────────────────────────────────
import { createOrderValidator } from '../validators/CreateOrderValidator'
import { submitOrderValidator } from '../validators/SubmitOrderValidator'
import { createCustomerValidator } from '../validators/CreateCustomerValidator'
import { receiveCollectionValidator } from '../validators/ReceiveCollectionValidator'

// ── Policies ───────────────────────────────────────────────────
import { approveOrderPolicy } from '../policies/ApproveOrderPolicy'
import { createOrderPolicy } from '../policies/CreateOrderPolicy'
import { collectionPolicy } from '../policies/CollectionPolicy'
import { attendancePolicy } from '../policies/AttendancePolicy'

// ── Pipeline ───────────────────────────────────────────────────
import { createPipeline } from '../pipeline/ApplicationPipeline'

// ── Commands ───────────────────────────────────────────────────
import { CreateOrderHandler } from '../commands/CreateOrderCommand'
import { SubmitOrderHandler } from '../commands/SubmitOrderCommand'
import { ApproveOrderHandler } from '../commands/ApproveOrderCommand'
import { RejectOrderHandler } from '../commands/RejectOrderCommand'
import { CancelOrderHandler } from '../commands/CancelOrderCommand'
import { CreateCustomerHandler } from '../commands/CreateCustomerCommand'
import { ReceiveCollectionHandler } from '../commands/ReceiveCollectionCommand'
import { StartWorkdayHandler } from '../commands/StartWorkdayCommand'
import { EndWorkdayHandler } from '../commands/EndWorkdayCommand'
import { ReserveCreditHandler } from '../commands/ReserveCreditCommand'

// ── Queries ────────────────────────────────────────────────────
import { GetOrderHandler } from '../queries/GetOrderQuery'
import { GetCustomerHandler } from '../queries/GetCustomerQuery'
import { SearchProductsHandler } from '../queries/SearchProductsQuery'
import { GetInventoryHandler } from '../queries/GetInventoryQuery'
import { GetWorkdayHandler } from '../queries/GetWorkdayQuery'
import { GetSalesDashboardHandler } from '../queries/GetSalesDashboardQuery'

import { OrderStatus } from '../../domain/enums'
import { createMoney } from '../../domain/value-objects/Money'
import { createSalesOrder, createOrderLine } from '../../domain/models/salesOrder'

function mockSession(overrides?: Record<string, unknown>) {
  return {
    id: 'session-1',
    identityId: 'identity-1',
    identityType: 'employee' as const,
    companyId: 'comp-1',
    roles: [{ id: 'role-1', name: 'Sales Rep', capabilities: [{ code: 'orders.create', name: 'Create Orders' }] }],
    startedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    ...overrides,
  }
}

function mockManagerSession() {
  return mockSession({
    roles: [
      { id: 'role-1', name: 'Manager', capabilities: [
        { code: 'orders.create', name: 'Create Orders' },
        { code: 'orders.approve', name: 'Approve Orders' },
        { code: 'collections.receive', name: 'Receive Collections' },
        { code: 'attendance.record', name: 'Record Attendance' },
      ] },
    ],
  })
}

// ═══════════════════════════════════════════════════════════════
//  RESULT TESTS
// ═══════════════════════════════════════════════════════════════

describe('ApplicationResult', () => {
  it('creates success result', () => {
    const r = success({ id: '123' })
    expect(isSuccess(r)).toBe(true)
    expect(r.data.id).toBe('123')
  })

  it('creates failure result', () => {
    const r = failure('Something went wrong', 'ERR_001')
    expect(isFailure(r)).toBe(true)
    expect(r.message).toBe('Something went wrong')
    expect(r.code).toBe('ERR_001')
  })

  it('creates validation failure', () => {
    const r = validationFailure([{ field: 'name', message: 'Name is required' }])
    expect(isValidationFailure(r)).toBe(true)
    expect(r.errors[0].field).toBe('name')
  })

  it('creates authorization failure', () => {
    const r = authorizationFailure('Not allowed')
    expect(isAuthorizationFailure(r)).toBe(true)
  })

  it('creates conflict result', () => {
    const r = conflict('Already exists')
    expect(isConflict(r)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
//  VALIDATOR TESTS
// ═══════════════════════════════════════════════════════════════

describe('CreateOrderValidator', () => {
  const validInput = {
    commandId: 'c1', commandType: 'CreateOrderCommand' as const, timestamp: new Date(),
    companyId: 'comp-1', customerId: 'cust-1', customerName: 'Test', salesRepId: 'emp-1',
    lines: [{ productId: 'p1', productName: 'P1', unitType: 'carton' as const, unitPrice: 100, quantity: 2 }],
    session: mockSession(),
  }

  it('passes valid input', () => {
    expect(createOrderValidator.validate(validInput)).toHaveLength(0)
  })

  it('rejects missing companyId', () => {
    const errors = createOrderValidator.validate({ ...validInput, companyId: '' })
    expect(errors.some(e => e.field === 'companyId')).toBe(true)
  })

  it('rejects empty lines', () => {
    const errors = createOrderValidator.validate({ ...validInput, lines: [] })
    expect(errors.some(e => e.field === 'lines')).toBe(true)
  })

  it('rejects negative price', () => {
    const errors = createOrderValidator.validate({ ...validInput, lines: [{ ...validInput.lines[0], unitPrice: -1 }] })
    expect(errors.some(e => e.field === 'lines[0].unitPrice')).toBe(true)
  })
})

describe('SubmitOrderValidator', () => {
  it('rejects missing orderId', () => {
    const errors = submitOrderValidator.validate({
      commandId: 'c1', commandType: 'SubmitOrderCommand', timestamp: new Date(), orderId: '', session: mockSession(),
    })
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('CreateCustomerValidator', () => {
  it('rejects missing trade name', () => {
    const errors = createCustomerValidator.validate({
      commandId: 'c1', commandType: 'CreateCustomerCommand', timestamp: new Date(),
      tradeName: '', fullName: 'Test', phone: '0123', street: 'S', district: 'D', city: 'C', governorate: 'G',
      customerType: 'retail', creditLimit: 1000, session: mockSession(),
    })
    expect(errors.some(e => e.field === 'tradeName')).toBe(true)
  })

  it('rejects negative credit limit', () => {
    const errors = createCustomerValidator.validate({
      commandId: 'c1', commandType: 'CreateCustomerCommand', timestamp: new Date(),
      tradeName: 'T', fullName: 'Test', phone: '0123', street: 'S', district: 'D', city: 'C', governorate: 'G',
      customerType: 'retail', creditLimit: -100, session: mockSession(),
    })
    expect(errors.some(e => e.field === 'creditLimit')).toBe(true)
  })
})

describe('ReceiveCollectionValidator', () => {
  it('rejects non-positive amount', () => {
    const errors = receiveCollectionValidator.validate({
      commandId: 'c1', commandType: 'ReceiveCollectionCommand', timestamp: new Date(),
      orderId: 'o1', amount: 0, paymentMethod: 'cash', session: mockSession(),
    })
    expect(errors.some(e => e.field === 'amount')).toBe(true)
  })

  it('requires check number for check payments', () => {
    const errors = receiveCollectionValidator.validate({
      commandId: 'c1', commandType: 'ReceiveCollectionCommand', timestamp: new Date(),
      orderId: 'o1', amount: 100, paymentMethod: 'check', session: mockSession(),
    })
    expect(errors.some(e => e.field === 'checkNumber')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
//  POLICY TESTS
// ═══════════════════════════════════════════════════════════════

describe('Policies', () => {
  it('approveOrderPolicy allows manager', () => {
    const result = approveOrderPolicy.authorize(mockManagerSession())
    expect(result.allowed).toBe(true)
  })

  it('approveOrderPolicy denies sales rep', () => {
    const result = approveOrderPolicy.authorize(mockSession())
    expect(result.allowed).toBe(false)
  })

  it('createOrderPolicy allows sales rep', () => {
    expect(createOrderPolicy.authorize(mockSession()).allowed).toBe(true)
  })

  it('createOrderPolicy denies without capability', () => {
    const noCapSession = mockSession({ roles: [] })
    expect(createOrderPolicy.authorize(noCapSession).allowed).toBe(false)
  })

  it('collectionPolicy allows with capability', () => {
    expect(collectionPolicy.authorize(mockManagerSession()).allowed).toBe(true)
  })

  it('attendancePolicy allows with capability', () => {
    expect(attendancePolicy.authorize(mockManagerSession()).allowed).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
//  PIPELINE TESTS
// ═══════════════════════════════════════════════════════════════

describe('ApplicationPipeline', () => {
  it('executes command through pipeline', async () => {
    const handler = vi.fn().mockResolvedValue(success({ done: true }))
    const pipeline = createPipeline({
      validators: new Map(),
      policies: new Map(),
      commandHandlers: new Map([['TestCommand', { commandType: 'TestCommand', handle: handler }]]),
      queryHandlers: new Map(),
    })
    const result = await pipeline.executeCommand({
      commandId: 'c1', commandType: 'TestCommand', timestamp: new Date(), session: mockSession(),
    })
    expect(isSuccess(result)).toBe(true)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('returns HANDLER_NOT_FOUND for unknown command', async () => {
    const pipeline = createPipeline({
      validators: new Map(), policies: new Map(),
      commandHandlers: new Map(), queryHandlers: new Map(),
    })
    const result = await pipeline.executeCommand({
      commandId: 'c1', commandType: 'Unknown', timestamp: new Date(), session: mockSession(),
    })
    expect(isFailure(result)).toBe(true)
  })

  it('runs validator before handler', async () => {
    const handler = vi.fn()
    const pipeline = createPipeline({
      validators: new Map([['FailCommand', { ruleName: 'FailValidator', validate: () => [{ field: 'x', message: 'Invalid' }] }]]),
      policies: new Map(),
      commandHandlers: new Map([['FailCommand', { commandType: 'FailCommand', handle: handler }]]),
      queryHandlers: new Map(),
    })
    const result = await pipeline.executeCommand({
      commandId: 'c1', commandType: 'FailCommand', timestamp: new Date(), session: mockSession(),
    })
    expect(isValidationFailure(result)).toBe(true)
    expect(handler).not.toHaveBeenCalled()
  })

  it('runs policy check before handler', async () => {
    const handler = vi.fn()
    const pipeline = createPipeline({
      validators: new Map(),
      policies: new Map([['SecureCommand', { policyName: 'Secure', authorize: () => ({ allowed: false, reason: 'Denied' }) }]]),
      commandHandlers: new Map([['SecureCommand', { commandType: 'SecureCommand', handle: handler }]]),
      queryHandlers: new Map(),
    })
    const result = await pipeline.executeCommand({
      commandId: 'c1', commandType: 'SecureCommand', timestamp: new Date(), session: mockSession(),
    })
    expect(isAuthorizationFailure(result)).toBe(true)
    expect(handler).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════
//  COMMAND HANDLER TESTS
// ═══════════════════════════════════════════════════════════════

describe('CreateOrderHandler', () => {
  it('creates order successfully', async () => {
    const salesOrderProvider = { placeNewOrder: vi.fn(), submitOrder: vi.fn(), approveOrder: vi.fn(), rejectOrder: vi.fn(), cancelOrder: vi.fn(), recordPayment: vi.fn(), getOrderById: vi.fn(), getCustomerOrders: vi.fn(), searchOrders: vi.fn() }
    const handler = new CreateOrderHandler({ salesOrderProvider })

    const result = await handler.handle({
      commandId: 'c1', commandType: 'CreateOrderCommand', timestamp: new Date(),
      companyId: 'comp-1', customerId: 'cust-1', customerName: 'Test Co', salesRepId: 'emp-1',
      lines: [{ productId: 'p1', productName: 'Prod A', unitType: 'carton', unitPrice: 100, quantity: 2 }],
      session: mockSession(),
    })

    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) {
      expect(result.data.status).toBe(OrderStatus.Draft)
    }
    expect(salesOrderProvider.placeNewOrder).toHaveBeenCalledOnce()
  })
})

describe('SubmitOrderHandler', () => {
  it('submits existing draft order', async () => {
    const order = createSalesOrder('ord-1', 'comp-1', 'cust-1', 'Test', 'emp-1', [])
    const salesOrderProvider = { placeNewOrder: vi.fn(), submitOrder: vi.fn().mockResolvedValue(undefined), approveOrder: vi.fn(), rejectOrder: vi.fn(), cancelOrder: vi.fn(), recordPayment: vi.fn(), getOrderById: vi.fn().mockResolvedValue(order), getCustomerOrders: vi.fn(), searchOrders: vi.fn() }
    const handler = new SubmitOrderHandler({ salesOrderProvider })

    const result = await handler.handle({
      commandId: 'c1', commandType: 'SubmitOrderCommand', timestamp: new Date(),
      orderId: 'ord-1', session: mockSession(),
    })

    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) {
      expect(result.data.order.status).toBe(OrderStatus.Submitted)
    }
  })

  it('returns failure for missing order', async () => {
    const salesOrderProvider = { placeNewOrder: vi.fn(), submitOrder: vi.fn(), approveOrder: vi.fn(), rejectOrder: vi.fn(), cancelOrder: vi.fn(), recordPayment: vi.fn(), getOrderById: vi.fn().mockResolvedValue(null), getCustomerOrders: vi.fn(), searchOrders: vi.fn() }
    const handler = new SubmitOrderHandler({ salesOrderProvider })

    const result = await handler.handle({
      commandId: 'c1', commandType: 'SubmitOrderCommand', timestamp: new Date(),
      orderId: 'nonexistent', session: mockSession(),
    })

    expect(isFailure(result)).toBe(true)
  })
})

describe('ApproveOrderHandler', () => {
  it('approves submitted order through review flow', async () => {
    const order = createSalesOrder('ord-1', 'comp-1', 'cust-1', 'Test', 'emp-1', [])
    const submitted = { ...order, status: OrderStatus.Submitted }
    const salesOrderProvider = { placeNewOrder: vi.fn(), submitOrder: vi.fn(), approveOrder: vi.fn().mockResolvedValue(undefined), rejectOrder: vi.fn(), cancelOrder: vi.fn(), recordPayment: vi.fn(), getOrderById: vi.fn().mockResolvedValue(submitted), getCustomerOrders: vi.fn(), searchOrders: vi.fn() }
    const handler = new ApproveOrderHandler({ salesOrderProvider })

    const result = await handler.handle({
      commandId: 'c1', commandType: 'ApproveOrderCommand', timestamp: new Date(),
      orderId: 'ord-1', session: mockSession(),
    })

    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) {
      expect(result.data.order.status).toBe(OrderStatus.Approved)
    }
  })
})

describe('RejectOrderHandler', () => {
  it('rejects order', async () => {
    const order = createSalesOrder('ord-1', 'comp-1', 'cust-1', 'Test', 'emp-1', [])
    const submitted = { ...order, status: OrderStatus.Submitted }
    const salesOrderProvider = { placeNewOrder: vi.fn(), submitOrder: vi.fn(), approveOrder: vi.fn(), rejectOrder: vi.fn().mockResolvedValue(undefined), cancelOrder: vi.fn(), recordPayment: vi.fn(), getOrderById: vi.fn().mockResolvedValue(submitted), getCustomerOrders: vi.fn(), searchOrders: vi.fn() }
    const handler = new RejectOrderHandler({ salesOrderProvider })

    const result = await handler.handle({
      commandId: 'c1', commandType: 'RejectOrderCommand', timestamp: new Date(),
      orderId: 'ord-1', reason: 'Insufficient credit', session: mockSession(),
    })

    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) {
      expect(result.data.order.status).toBe(OrderStatus.Rejected)
    }
  })
})

describe('CancelOrderHandler', () => {
  it('cancels draft order', async () => {
    const order = createSalesOrder('ord-1', 'comp-1', 'cust-1', 'Test', 'emp-1', [])
    const salesOrderProvider = { placeNewOrder: vi.fn(), submitOrder: vi.fn(), approveOrder: vi.fn(), rejectOrder: vi.fn(), cancelOrder: vi.fn().mockResolvedValue(undefined), recordPayment: vi.fn(), getOrderById: vi.fn().mockResolvedValue(order), getCustomerOrders: vi.fn(), searchOrders: vi.fn() }
    const handler = new CancelOrderHandler({ salesOrderProvider })

    const result = await handler.handle({
      commandId: 'c1', commandType: 'CancelOrderCommand', timestamp: new Date(),
      orderId: 'ord-1', session: mockSession(),
    })

    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) {
      expect(result.data.order.status).toBe(OrderStatus.Cancelled)
    }
  })
})

describe('CreateCustomerHandler', () => {
  it('creates customer', async () => {
    const customerProvider = { registerNewCustomer: vi.fn(), suspendCustomer: vi.fn(), updateCreditLimit: vi.fn(), getCustomerById: vi.fn(), searchCustomers: vi.fn() }
    const handler = new CreateCustomerHandler({ customerProvider })

    const result = await handler.handle({
      commandId: 'c1', commandType: 'CreateCustomerCommand', timestamp: new Date(),
      companyId: 'comp-1', tradeName: 'Test Co', fullName: 'Test Customer', phone: '01234567890',
      street: 'St', district: 'D', city: 'C', governorate: 'G',
      customerType: 'retail', creditLimit: 5000, session: mockSession(),
    })

    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) {
      expect(result.data.tradeName).toBe('Test Co')
    }
    expect(customerProvider.registerNewCustomer).toHaveBeenCalledOnce()
  })
})

describe('ReceiveCollectionHandler', () => {
  it('records cash payment', async () => {
    const line = createOrderLine('l1', 'p1', 'P1', 'carton', createMoney(200), 1)
    const order = createSalesOrder('ord-1', 'comp-1', 'cust-1', 'Test', 'emp-1', [line])
    const salesOrderProvider = { placeNewOrder: vi.fn(), submitOrder: vi.fn(), approveOrder: vi.fn(), rejectOrder: vi.fn(), cancelOrder: vi.fn(), recordPayment: vi.fn().mockResolvedValue(undefined), getOrderById: vi.fn().mockResolvedValue(order), getCustomerOrders: vi.fn(), searchOrders: vi.fn() }
    const collectionProvider = { receiveCashPayment: vi.fn().mockResolvedValue(undefined), receiveCheckPayment: vi.fn(), depositCheck: vi.fn(), clearCheck: vi.fn(), returnCheck: vi.fn(), getPaymentsByOrder: vi.fn(), getPaymentById: vi.fn() }
    const handler = new ReceiveCollectionHandler({ salesOrderProvider, collectionProvider })

    const result = await handler.handle({
      commandId: 'c1', commandType: 'ReceiveCollectionCommand', timestamp: new Date(),
      orderId: 'ord-1', customerId: 'cust-1', amount: 100, paymentMethod: 'cash', session: mockSession(),
    })

    expect(isSuccess(result)).toBe(true)
    expect(salesOrderProvider.recordPayment).toHaveBeenCalled()
    expect(collectionProvider.receiveCashPayment).toHaveBeenCalled()
  })
})

describe('StartWorkdayHandler', () => {
  it('starts workday', async () => {
    const attendanceProvider = { startWorkday: vi.fn().mockResolvedValue(undefined), endWorkday: vi.fn(), getWorkdayById: vi.fn(), getWorkdayByEmployeeAndDate: vi.fn().mockResolvedValue(null), getWorkdayRange: vi.fn() }
    const handler = new StartWorkdayHandler({ attendanceProvider })

    const result = await handler.handle({
      commandId: 'c1', commandType: 'StartWorkdayCommand', timestamp: new Date(),
      companyId: 'comp-1', employeeId: 'emp-1', date: '2026-07-05', session: mockSession(),
    })

    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) {
      expect(result.data.status).toBe('active')
    }
  })

  it('rejects duplicate active workday', async () => {
    const existing = { id: 'wd-1', companyId: 'comp-1', employeeId: 'emp-1', date: new Date('2026-07-05'), status: 'active', checkIn: new Date(), checkOut: null, checkInLocation: null, checkOutLocation: null, notes: null }
    const attendanceProvider = { startWorkday: vi.fn(), endWorkday: vi.fn(), getWorkdayById: vi.fn(), getWorkdayByEmployeeAndDate: vi.fn().mockResolvedValue(existing), getWorkdayRange: vi.fn() }
    const handler = new StartWorkdayHandler({ attendanceProvider })

    const result = await handler.handle({
      commandId: 'c1', commandType: 'StartWorkdayCommand', timestamp: new Date(),
      companyId: 'comp-1', employeeId: 'emp-1', date: '2026-07-05', session: mockSession(),
    })

    expect(isFailure(result)).toBe(true)
  })
})

describe('EndWorkdayHandler', () => {
  it('ends workday', async () => {
    const active = { id: 'wd-1', companyId: 'comp-1', employeeId: 'emp-1', date: new Date('2026-07-05'), status: 'active', checkIn: new Date(), checkOut: null, checkInLocation: null, checkOutLocation: null, notes: null }
    const attendanceProvider = { startWorkday: vi.fn(), endWorkday: vi.fn().mockResolvedValue(undefined), getWorkdayById: vi.fn().mockResolvedValue(active), getWorkdayByEmployeeAndDate: vi.fn(), getWorkdayRange: vi.fn() }
    const handler = new EndWorkdayHandler({ attendanceProvider })

    const result = await handler.handle({
      commandId: 'c1', commandType: 'EndWorkdayCommand', timestamp: new Date(),
      workdayId: 'wd-1', session: mockSession(),
    })

    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) {
      expect(result.data.status).toBe('completed')
    }
  })
})

describe('ReserveCreditHandler', () => {
  it('reserves credit within limit', async () => {
    const customer = { id: 'cust-1', companyId: 'comp-1', customerType: 'retail' as const, tradeName: 'Test', fullName: 'Test Customer', phone: { number: '0123', countryCode: '+2' }, address: { street: 'S', district: 'D', city: 'C', governorate: 'G' }, status: 'active' as const, creditLimit: { amount: 5000, currency: 'EGP' }, outstandingBalance: { amount: 0, currency: 'EGP' }, createdAt: new Date(), updatedAt: new Date() }
    const customerProvider = { registerNewCustomer: vi.fn(), suspendCustomer: vi.fn(), updateCreditLimit: vi.fn(), getCustomerById: vi.fn().mockResolvedValue(customer), searchCustomers: vi.fn() }
    const handler = new ReserveCreditHandler({ customerProvider })

    const result = await handler.handle({
      commandId: 'c1', commandType: 'ReserveCreditCommand', timestamp: new Date(),
      customerId: 'cust-1', amount: 2000, reason: 'Order #123', session: mockSession(),
    })

    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) {
      expect(result.data.outstandingBalance.amount).toBe(2000)
    }
  })
})

// ═══════════════════════════════════════════════════════════════
//  QUERY HANDLER TESTS
// ═══════════════════════════════════════════════════════════════

describe('Query handlers', () => {
  it('GetOrderHandler returns order', async () => {
    const order = createSalesOrder('ord-1', 'comp-1', 'cust-1', 'Test', 'emp-1', [])
    const salesOrderProvider = { placeNewOrder: vi.fn(), submitOrder: vi.fn(), approveOrder: vi.fn(), rejectOrder: vi.fn(), cancelOrder: vi.fn(), recordPayment: vi.fn(), getOrderById: vi.fn().mockResolvedValue(order), getCustomerOrders: vi.fn(), searchOrders: vi.fn() }
    const handler = new GetOrderHandler({ salesOrderProvider })

    const result = await handler.handle({ queryId: 'q1', queryType: 'GetOrderQuery', orderId: 'ord-1' })
    expect(isSuccess(result)).toBe(true)
  })

  it('GetCustomerHandler returns customer', async () => {
    const customer = { id: 'cust-1', companyId: 'comp-1', customerType: 'retail' as const, tradeName: 'T', fullName: 'F', phone: { number: '0123', countryCode: '+2' }, address: { street: 'S', district: 'D', city: 'C', governorate: 'G' }, status: 'active' as const, creditLimit: { amount: 5000, currency: 'EGP' }, outstandingBalance: { amount: 0, currency: 'EGP' }, createdAt: new Date(), updatedAt: new Date() }
    const customerProvider = { registerNewCustomer: vi.fn(), suspendCustomer: vi.fn(), updateCreditLimit: vi.fn(), getCustomerById: vi.fn().mockResolvedValue(customer), searchCustomers: vi.fn() }
    const handler = new GetCustomerHandler({ customerProvider })

    const result = await handler.handle({ queryId: 'q1', queryType: 'GetCustomerQuery', customerId: 'cust-1' })
    expect(isSuccess(result)).toBe(true)
  })

  it('SearchProductsHandler returns products', async () => {
    const products = [{ id: 'p1', companyId: 'comp-1', categoryId: 'cat-1', productName: 'Prod A', legacyCode: '001', description: null, defaultUnit: 'carton' as const, availableUnits: ['carton' as const], cartonQuantity: 24, cartonPrice: 2400, status: 'active' as const, isOutOfStock: false, createdAt: new Date(), updatedAt: new Date() }]
    const productCatalogProvider = { getProductById: vi.fn(), searchProducts: vi.fn().mockResolvedValue(products), getCompanyProducts: vi.fn() }
    const handler = new SearchProductsHandler({ productCatalogProvider })

    const result = await handler.handle({ queryId: 'q1', queryType: 'SearchProductsQuery', companyId: 'comp-1', searchQuery: 'Prod' })
    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) expect(result.data).toHaveLength(1)
  })

  it('GetInventoryHandler returns record', async () => {
    const record = { id: 'inv-1', productId: 'p1', companyId: 'comp-1', quantity: 100, lastCountedAt: null, notes: null, updatedAt: new Date() }
    const inventoryProvider = { reserveStock: vi.fn(), releaseReservation: vi.fn(), adjustInventory: vi.fn(), confirmShipment: vi.fn(), getInventoryLevel: vi.fn().mockResolvedValue(record), getInventoryByCompany: vi.fn() }
    const handler = new GetInventoryHandler({ inventoryProvider })

    const result = await handler.handle({ queryId: 'q1', queryType: 'GetInventoryQuery', productId: 'p1' })
    expect(isSuccess(result)).toBe(true)
  })

  it('GetWorkdayHandler returns workday', async () => {
    const workday = { id: 'wd-1', companyId: 'comp-1', employeeId: 'emp-1', date: new Date('2026-07-05'), status: 'active' as const, checkIn: new Date(), checkOut: null, checkInLocation: null, checkOutLocation: null, notes: null }
    const attendanceProvider = { startWorkday: vi.fn(), endWorkday: vi.fn(), getWorkdayById: vi.fn(), getWorkdayByEmployeeAndDate: vi.fn().mockResolvedValue(workday), getWorkdayRange: vi.fn() }
    const handler = new GetWorkdayHandler({ attendanceProvider })

    const result = await handler.handle({ queryId: 'q1', queryType: 'GetWorkdayQuery', employeeId: 'emp-1', date: '2026-07-05' })
    expect(isSuccess(result)).toBe(true)
  })

  it('GetSalesDashboardHandler returns aggregated data', async () => {
    const orders = [
      { ...createSalesOrder('o1', 'comp-1', 'c1', 'A', 'e1', []), status: OrderStatus.Delivered, grandTotal: { amount: 500, currency: 'EGP' } },
      { ...createSalesOrder('o2', 'comp-1', 'c1', 'B', 'e1', []), status: OrderStatus.Submitted, grandTotal: { amount: 300, currency: 'EGP' } },
    ]
    const salesOrderProvider = { placeNewOrder: vi.fn(), submitOrder: vi.fn(), approveOrder: vi.fn(), rejectOrder: vi.fn(), cancelOrder: vi.fn(), recordPayment: vi.fn(), getOrderById: vi.fn(), getCustomerOrders: vi.fn(), searchOrders: vi.fn().mockResolvedValue(orders) }
    const handler = new GetSalesDashboardHandler({ salesOrderProvider })

    const result = await handler.handle({ queryId: 'q1', queryType: 'GetSalesDashboardQuery', companyId: 'comp-1', fromDate: '2026-01-01', toDate: '2026-12-31' })
    expect(isSuccess(result)).toBe(true)
    if (isSuccess(result)) {
      expect(result.data.totalOrders).toBe(2)
      expect(result.data.totalSales).toBe(800)
    }
  })
})
