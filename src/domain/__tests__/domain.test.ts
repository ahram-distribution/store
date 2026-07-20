import { describe, it, expect } from 'vitest'

// ── Value Objects ──────────────────────────────────────────────
import {
  createMoney, addMoney, subtractMoney, multiplyMoney,
  isMoneyGreaterThan, isMoneyZero, formatMoney, ZeroMoney,
} from '../value-objects/Money'

import { createGeoLocation, isValidGeoLocation } from '../value-objects/GeoLocation'

import { createPhoneNumber, formatPhoneNumber } from '../value-objects/PhoneNumber'

import { createDateRange, isInRange, durationInDays } from '../value-objects/DateRange'

import { createQuantity, addQuantity } from '../value-objects/Quantity'

import { UnitOfMeasure, getUnitOfMeasure, convertToPieces } from '../value-objects/UnitOfMeasure'

// ── Enums ──────────────────────────────────────────────────────
import {
  OrderStatus, isTerminalStatus, isValidTransition,
  UnitType, IdentityType, PaymentMethod, CheckStatus, CustomerType,
  WorkdayStatus,
} from '../enums'

// ── Models ─────────────────────────────────────────────────────
import {
  createSalesOrder, submitOrder, reviewOrder, approveOrder, rejectOrder, cancelOrder,
  recordPayment, addLineToOrder, createOrderLine,
} from '../models/salesOrder'

import {
  createCustomer, suspendCustomer, isCustomerSuspended, canPlaceOrder,
} from '../models/customer'

import {
  createProduct, markProductOutOfStock, markProductInStock,
} from '../models/product'

import { createIdentity, deactivateIdentity, hasCapability } from '../models/identity'

import { createCashPayment, createCheckPayment, depositCheck, clearCheck, bounceCheck } from '../models/payment'

import { createCredit, applyCredit, payDownCredit } from '../models/credit'

import { startWorkday, endWorkday } from '../models/attendance'

import { createInventoryRecord, adjustInventory, countInventory } from '../models/inventory'

import { startTrackingSession, endTrackingSession, addCheckIn, createCheckIn } from '../models/tracking'

// ── Services ───────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════
//  VALUE OBJECT TESTS
// ═══════════════════════════════════════════════════════════════

describe('Money', () => {
  it('creates with default EGP currency', () => {
    const m = createMoney(100)
    expect(m.amount).toBe(100)
    expect(m.currency).toBe('EGP')
  })

  it('creates with specified currency', () => {
    const m = createMoney(50, 'USD')
    expect(m.currency).toBe('USD')
  })

  it('adds same currency', () => {
    const a = createMoney(100)
    const b = createMoney(50)
    expect(addMoney(a, b).amount).toBe(150)
  })

  it('throws on add with different currencies', () => {
    expect(() => addMoney(createMoney(1, 'USD'), createMoney(1, 'EGP'))).toThrow('Currency mismatch')
  })

  it('subtracts', () => {
    expect(subtractMoney(createMoney(100), createMoney(30)).amount).toBe(70)
  })

  it('multiplies', () => {
    expect(multiplyMoney(createMoney(10), 3).amount).toBe(30)
  })

  it('compares greater than', () => {
    expect(isMoneyGreaterThan(createMoney(100), createMoney(50))).toBe(true)
    expect(isMoneyGreaterThan(createMoney(50), createMoney(100))).toBe(false)
  })

  it('detects zero', () => {
    expect(isMoneyZero(ZeroMoney)).toBe(true)
    expect(isMoneyZero(createMoney(1))).toBe(false)
  })

  it('formats', () => {
    expect(formatMoney(createMoney(100.5))).toBe('100.50 EGP')
  })
})

describe('GeoLocation', () => {
  it('creates valid location', () => {
    const loc = createGeoLocation(30.0444, 31.2357)
    expect(isValidGeoLocation(loc)).toBe(true)
  })

  it('rejects invalid latitude', () => {
    expect(isValidGeoLocation(createGeoLocation(100, 0))).toBe(false)
  })

  it('rejects invalid longitude', () => {
    expect(isValidGeoLocation(createGeoLocation(0, 200))).toBe(false)
  })
})

describe('PhoneNumber', () => {
  it('formats with country code', () => {
    const p = createPhoneNumber('01234567890')
    expect(formatPhoneNumber(p)).toBe('+201234567890')
  })
})

describe('DateRange', () => {
  it('creates valid range', () => {
    const r = createDateRange(new Date('2026-01-01'), new Date('2026-01-31'))
    expect(durationInDays(r)).toBe(30)
  })

  it('throws when end before start', () => {
    expect(() => createDateRange(new Date('2026-02-01'), new Date('2026-01-01'))).toThrow()
  })

  it('checks if date is in range', () => {
    const r = createDateRange(new Date('2026-01-01'), new Date('2026-01-31'))
    expect(isInRange(r, new Date('2026-01-15'))).toBe(true)
    expect(isInRange(r, new Date('2026-02-01'))).toBe(false)
  })
})

describe('Quantity', () => {
  it('rejects negative', () => {
    expect(() => createQuantity(-1, UnitOfMeasure.Piece)).toThrow('cannot be negative')
  })

  it('adds same unit', () => {
    const q = addQuantity(createQuantity(5, UnitOfMeasure.Piece), createQuantity(3, UnitOfMeasure.Piece))
    expect(q.value).toBe(8)
  })
})

describe('UnitOfMeasure', () => {
  it('looks up by code', () => {
    expect(getUnitOfMeasure('piece')).toBe(UnitOfMeasure.Piece)
    expect(getUnitOfMeasure('invalid')).toBeUndefined()
  })

  it('converts to pieces', () => {
    expect(convertToPieces(2, UnitOfMeasure.Dozen, 12)).toBe(24)
    expect(convertToPieces(1, UnitOfMeasure.Piece, 12)).toBe(1)
    expect(convertToPieces(3, UnitOfMeasure.Carton, 24)).toBe(72)
  })
})

// ═══════════════════════════════════════════════════════════════
//  ENUM TESTS
// ═══════════════════════════════════════════════════════════════

describe('OrderStatus', () => {
  it('has correct string values', () => {
    expect(OrderStatus.Draft).toBe('draft')
    expect(OrderStatus.Delivered).toBe('delivered')
  })

  it('terminal statuses', () => {
    expect(isTerminalStatus(OrderStatus.Delivered)).toBe(true)
    expect(isTerminalStatus(OrderStatus.Rejected)).toBe(true)
    expect(isTerminalStatus(OrderStatus.Cancelled)).toBe(true)
    expect(isTerminalStatus(OrderStatus.Draft)).toBe(false)
  })

  it('valid transitions', () => {
    expect(isValidTransition(OrderStatus.Draft, OrderStatus.Submitted)).toBe(true)
    expect(isValidTransition(OrderStatus.Draft, OrderStatus.Approved)).toBe(false)
    expect(isValidTransition(OrderStatus.Approved, OrderStatus.Preparing)).toBe(true)
    expect(isValidTransition(OrderStatus.Delivered, OrderStatus.Draft)).toBe(false)
  })
})

describe('Enum values', () => {
  it('UnitType', () => {
    expect(UnitType.Piece).toBe('piece')
    expect(UnitType.Carton).toBe('carton')
  })
  it('IdentityType', () => {
    expect(IdentityType.Employee).toBe('employee')
  })
  it('PaymentMethod', () => {
    expect(PaymentMethod.Cash).toBe('cash')
    expect(PaymentMethod.Check).toBe('check')
  })
  it('CheckStatus', () => {
    expect(CheckStatus.Cleared).toBe('cleared')
    expect(CheckStatus.Bounced).toBe('bounced')
  })
  it('CustomerType', () => {
    expect(CustomerType.Retail).toBe('retail')
  })
  it('WorkdayStatus', () => {
    expect(WorkdayStatus.Active).toBe('active')
  })
})

// ═══════════════════════════════════════════════════════════════
//  AGGREGATE TESTS
// ═══════════════════════════════════════════════════════════════

describe('SalesOrder aggregate', () => {
  const companyId = 'comp-1'
  const customerId = 'cust-1'
  const salesRepId = 'emp-1'

  it('creates in Draft status', () => {
    const order = createSalesOrder('ord-1', companyId, customerId, 'Test Customer', salesRepId, [])
    expect(order.status).toBe(OrderStatus.Draft)
    expect(order.subtotal.amount).toBe(0)
  })

  it('calculates subtotal from lines', () => {
    const lines = [
      createOrderLine('line-1', 'prod-1', 'Prod A', 'carton', createMoney(100), 2),
      createOrderLine('line-2', 'prod-2', 'Prod B', 'carton', createMoney(50), 3),
    ]
    const order = createSalesOrder('ord-2', companyId, customerId, 'Test', salesRepId, lines)
    expect(order.subtotal.amount).toBe(350)
    expect(order.grandTotal.amount).toBe(350)
  })

  it('applies discount', () => {
    const lines = [createOrderLine('line-1', 'prod-1', 'A', 'carton', createMoney(100), 2)]
    const order = createSalesOrder('ord-3', companyId, customerId, 'Test', salesRepId, lines, createMoney(50))
    expect(order.discount.amount).toBe(50)
    expect(order.grandTotal.amount).toBe(150)
  })

  it('submits from Draft', () => {
    const order = createSalesOrder('ord-4', companyId, customerId, 'Test', salesRepId, [])
    const { order: submitted } = submitOrder(order)
    expect(submitted.status).toBe(OrderStatus.Submitted)
  })

  it('cannot submit from non-Draft', () => {
    const order = createSalesOrder('ord-5', companyId, customerId, 'Test', salesRepId, [])
    const { order: submitted } = submitOrder(order)
    expect(() => submitOrder(submitted)).toThrow()
  })

  it('approves via submitted → reviewing → approved', () => {
    const order = createSalesOrder('ord-6', companyId, customerId, 'Test', salesRepId, [])
    const { order: submitted } = submitOrder(order)
    const { order: reviewing } = reviewOrder(submitted)
    const { order: approved } = approveOrder(reviewing)
    expect(approved.status).toBe(OrderStatus.Approved)
  })

  it('cannot approve Draft directly', () => {
    const order = createSalesOrder('ord-7', companyId, customerId, 'Test', salesRepId, [])
    expect(() => approveOrder(order)).toThrow()
  })

  it('rejects from submitted', () => {
    const order = createSalesOrder('ord-8', companyId, customerId, 'Test', salesRepId, [])
    const { order: submitted } = submitOrder(order)
    const { order: rejected } = rejectOrder(submitted, 'Not approved')
    expect(rejected.status).toBe(OrderStatus.Rejected)
  })

  it('cancels from Draft', () => {
    const order = createSalesOrder('ord-9', companyId, customerId, 'Test', salesRepId, [])
    const { order: cancelled } = cancelOrder(order)
    expect(cancelled.status).toBe(OrderStatus.Cancelled)
  })

  it('cannot cancel from terminal statuses', () => {
    const order = createSalesOrder('ord-10', companyId, customerId, 'Test', salesRepId, [])
    const { order: cancelled } = cancelOrder(order)
    expect(() => cancelOrder(cancelled)).toThrow()
  })

  it('adds line to Draft', () => {
    const order = createSalesOrder('ord-11', companyId, customerId, 'Test', salesRepId, [])
    const line = createOrderLine('line-x', 'prod-1', 'X', 'carton', createMoney(100), 1)
    const updated = addLineToOrder(order, line)
    expect(updated.lines).toHaveLength(1)
    expect(updated.subtotal.amount).toBe(100)
  })

  it('cannot add line after submission', () => {
    const order = createSalesOrder('ord-12', companyId, customerId, 'Test', salesRepId, [])
    const { order: submitted } = submitOrder(order)
    const line = createOrderLine('line-x', 'prod-1', 'X', 'carton', createMoney(100), 1)
    expect(() => addLineToOrder(submitted, line)).toThrow('only add lines to draft')
  })

  it('records payment against approved order', () => {
    const line = createOrderLine('line-1', 'prod-1', 'A', 'carton', createMoney(200), 1)
    const order = createSalesOrder('ord-13', companyId, customerId, 'Test', salesRepId, [line])
    const { order: submitted } = submitOrder(order)
    const { order: reviewing } = reviewOrder(submitted)
    const { order: approved } = approveOrder(reviewing)
    const paid = recordPayment(approved, createMoney(150))
    expect(paid.paidAmount.amount).toBe(150)
    expect(paid.balanceDue.amount).toBe(50)
  })
})

describe('Customer aggregate', () => {
  const phone = createPhoneNumber('01234567890')
  const address = { street: 'St', district: 'D', city: 'C', governorate: 'G' }

  it('creates active with zero balance', () => {
    const c = createCustomer('c-1', 'comp-1', 'retail' as any, 'Trade', 'Full', phone, address, createMoney(5000))
    expect(c.status).toBe('active')
    expect(c.outstandingBalance.amount).toBe(0)
  })

  it('can be suspended', () => {
    const c = createCustomer('c-2', 'comp-1', 'retail' as any, 'T', 'F', phone, address, createMoney(5000))
    const suspended = suspendCustomer(c)
    expect(isCustomerSuspended(suspended)).toBe(true)
  })

  it('can place order when active and under limit', () => {
    const c = createCustomer('c-3', 'comp-1', 'retail' as any, 'T', 'F', phone, address, createMoney(5000))
    expect(canPlaceOrder(c)).toBe(true)
  })

  it('cannot place order when suspended', () => {
    const c = createCustomer('c-4', 'comp-1', 'retail' as any, 'T', 'F', phone, address, createMoney(5000))
    expect(canPlaceOrder(suspendCustomer(c))).toBe(false)
  })
})

describe('Product', () => {
  it('creates active product', () => {
    const p = createProduct('p-1', 'comp-1', 'cat-1', 'Test Product', 'CODE', 24, 2400)
    expect(p.status).toBe('active')
    expect(p.cartonQuantity).toBe(24)
    expect(p.isOutOfStock).toBe(false)
  })

  it('marks out of stock', () => {
    const p = createProduct('p-1', 'comp-1', 'cat-1', 'Test', 'CODE', 24, 2400)
    expect(markProductOutOfStock(p).isOutOfStock).toBe(true)
    expect(markProductInStock(markProductOutOfStock(p)).isOutOfStock).toBe(false)
  })
})

describe('Check Payment', () => {
  it('follows received → deposited → cleared lifecycle', () => {
    const check = createCheckPayment('ch-1', 'ord-1', 'cust-1', createMoney(1000), 'CH-001', 'Bank ABC', new Date('2026-02-15'))
    expect(check.status).toBe('received')
    const deposited = depositCheck(check)
    expect(deposited.status).toBe('deposited')
    const cleared = clearCheck(deposited)
    expect(cleared.status).toBe('cleared')
  })

  it('can bounce from deposited', () => {
    const check = createCheckPayment('ch-2', 'ord-1', 'cust-1', createMoney(500), 'CH-002', 'Bank XYZ', new Date())
    const bounced = bounceCheck(depositCheck(check))
    expect(bounced.status).toBe('bounced')
  })
})

describe('Credit', () => {
  it('enforces limit', () => {
    const credit = createCredit('cust-1', createMoney(1000))
    expect(() => applyCredit('cust-1', credit, createMoney(1500), 'Large order')).toThrow('Credit limit exceeded')
  })

  it('allows credit within limit', () => {
    const credit = createCredit('cust-1', createMoney(1000))
    const updated = applyCredit('cust-1', credit, createMoney(500), 'Order #1')
    expect(updated.outstandingBalance.amount).toBe(500)
  })

  it('pays down', () => {
    let credit = createCredit('cust-1', createMoney(1000))
    credit = applyCredit('cust-1', credit, createMoney(800), 'Order')
    credit = payDownCredit(credit, createMoney(300))
    expect(credit.outstandingBalance.amount).toBe(500)
  })
})

describe('Workday / Attendance', () => {
  it('starts active with check-in', () => {
    const wd = startWorkday('wd-1', 'comp-1', 'emp-1', new Date())
    expect(wd.status).toBe('active')
    expect(wd.checkIn).toBeTruthy()
    expect(wd.checkOut).toBeNull()
  })

  it('completes with check-out', () => {
    const wd = startWorkday('wd-1', 'comp-1', 'emp-1', new Date())
    const ended = endWorkday(wd)
    expect(ended.status).toBe('completed')
    expect(ended.checkOut).toBeTruthy()
  })
})

describe('Inventory', () => {
  it('adjusts by positive amount', () => {
    const rec = createInventoryRecord('inv-1', 'prod-1', 'comp-1', 100)
    expect(adjustInventory(rec, 50).quantity).toBe(150)
  })

  it('adjusts by negative amount', () => {
    const rec = createInventoryRecord('inv-1', 'prod-1', 'comp-1', 100)
    expect(adjustInventory(rec, -30).quantity).toBe(70)
  })

  it('prevents negative inventory', () => {
    const rec = createInventoryRecord('inv-1', 'prod-1', 'comp-1', 10)
    expect(() => adjustInventory(rec, -20)).toThrow('cannot be negative')
  })

  it('counts inventory', () => {
    const rec = createInventoryRecord('inv-1', 'prod-1', 'comp-1', 100)
    const counted = countInventory(rec, 85)
    expect(counted.quantity).toBe(85)
    expect(counted.lastCountedAt).toBeTruthy()
  })
})

describe('Tracking Session', () => {
  it('starts active', () => {
    const session = startTrackingSession('ts-1', 'emp-1', new Date())
    expect(session.status).toBe('active')
  })

  it('ends as completed', () => {
    const session = startTrackingSession('ts-1', 'emp-1', new Date())
    expect(endTrackingSession(session).status).toBe('completed')
  })

  it('adds check-ins', () => {
    let session = startTrackingSession('ts-1', 'emp-1', new Date())
    const checkIn = createCheckIn('ci-1', 'ts-1', 'cust-1')
    session = addCheckIn(session, checkIn)
    expect(session.checkIns).toHaveLength(1)
  })

  it('prevents check-in to ended session', () => {
    const session = startTrackingSession('ts-1', 'emp-1', new Date())
    const ended = endTrackingSession(session)
    const checkIn = createCheckIn('ci-1', 'ts-1', 'cust-1')
    expect(() => addCheckIn(ended, checkIn)).toThrow('inactive session')
  })
})

describe('Identity / Authorization', () => {
  it('creates active identity', () => {
    const ident = createIdentity('i-1', 'employee' as any, 'Ahmed', '0123')
    expect(ident.isActive).toBe(true)
  })

  it('deactivates identity', () => {
    const ident = createIdentity('i-1', 'employee' as any, 'Ahmed', '0123')
    expect(deactivateIdentity(ident).isActive).toBe(false)
  })

  it('checks capability via session roles', () => {
    const session = {
      id: 's-1',
      identityId: 'i-1',
      identityType: 'employee' as any,
      companyId: 'comp-1',
      roles: [{ id: 'r-1', name: 'Admin', capabilities: [{ code: 'orders.create', name: 'Create Orders' }] }],
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    }
    expect(hasCapability(session, 'orders.create')).toBe(true)
    expect(hasCapability(session, 'orders.delete')).toBe(false)
  })
})
