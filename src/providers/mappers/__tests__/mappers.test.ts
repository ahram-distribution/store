import { describe, it, expect } from 'vitest'
import { SalesOrderMapper } from '../SalesOrderMapper'
import { CustomerMapper } from '../CustomerMapper'
import { ProductMapper } from '../ProductMapper'
import { InventoryMapper } from '../InventoryMapper'
import { AttendanceMapper } from '../AttendanceMapper'
import { CollectionMapper } from '../CollectionMapper'
import { OrderStatus } from '../../../domain/enums/OrderStatus'
import { WorkdayStatus } from '../../../domain/enums/WorkdayStatus'
import { PaymentMethod } from '../../../domain/enums/PaymentMethod'

// ═══════════════════════════════════════════════════════════════
//  SALES ORDER MAPPER
// ═══════════════════════════════════════════════════════════════

describe('SalesOrderMapper', () => {
  it('maps unified order to SalesOrder', () => {
    const input = {
      order: {
        id: 'ord-1', company_id: 'comp-1', customer_id: 'cust-1',
        snapshot_customer_name: 'Test Co', owner_id: 'emp-1',
        status: 'submitted', subtotal: 1000, discount_amount: 50,
        total_amount: 950, notes: 'Urgent',
        created_at: '2026-07-05T10:00:00Z', updated_at: '2026-07-05T11:00:00Z',
      },
      items: [{
        id: 'li-1', product_id: 'p1', product_name: 'Prod A',
        unit_type: 'carton', unit_price: 1000, unit_quantity: 1, total_price: 1000,
      }],
    }
    const result = SalesOrderMapper.fromUnifiedOrder(input)
    expect(result.id).toBe('ord-1')
    expect(result.status).toBe(OrderStatus.Submitted)
    expect(result.customerName).toBe('Test Co')
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productName).toBe('Prod A')
    expect(result.subtotal.amount).toBe(1000)
    expect(result.discount.amount).toBe(50)
    expect(result.grandTotal.amount).toBe(950)
    expect(result.notes).toBe('Urgent')
  })

  it('maps unified order item row to SalesOrder (no lines)', () => {
    const row = {
      id: 'ord-1', company_id: 'comp-1', customer_id: 'cust-1',
      customer_name: 'Test Co', status: 'delivered',
      subtotal: 500, discount_amount: 0, total_amount: 500,
      created_at: '2026-07-05T10:00:00Z',
    }
    const result = SalesOrderMapper.fromUnifiedOrderItem(row)
    expect(result.id).toBe('ord-1')
    expect(result.status).toBe(OrderStatus.Delivered)
    expect(result.lines).toHaveLength(0)
  })

  it('maps status correctly for all known statuses', () => {
    expect(SalesOrderMapper.mapStatus('draft')).toBe(OrderStatus.Draft)
    expect(SalesOrderMapper.mapStatus('submitted')).toBe(OrderStatus.Submitted)
    expect(SalesOrderMapper.mapStatus('approved')).toBe(OrderStatus.Approved)
    expect(SalesOrderMapper.mapStatus('cancelled')).toBe(OrderStatus.Cancelled)
    expect(SalesOrderMapper.mapStatus('delivered')).toBe(OrderStatus.Delivered)
    expect(SalesOrderMapper.mapStatus('preparing')).toBe(OrderStatus.Preparing)
    expect(SalesOrderMapper.mapStatus('dispatched')).toBe(OrderStatus.Dispatched)
    expect(SalesOrderMapper.mapStatus('unknown_status')).toBe(OrderStatus.Draft)
  })
})

// ═══════════════════════════════════════════════════════════════
//  CUSTOMER MAPPER
// ═══════════════════════════════════════════════════════════════

describe('CustomerMapper', () => {
  it('maps legacy row to Customer', () => {
    const row = {
      id: 'cust-1', company_id: 'comp-1', name: 'Test Co',
      full_name: 'Test Customer', phone: '01234567890',
      customer_type: 'retail', is_active: true,
      credit_limit: 5000, outstanding_balance: 1000,
      address_line1: 'Street', address_line2: 'District',
      city: 'Cairo', governorate: 'Cairo',
      created_at: '2026-01-01T00:00:00Z',
    }
    const result = CustomerMapper.fromLegacyRow(row)
    expect(result.id).toBe('cust-1')
    expect(result.tradeName).toBe('Test Co')
    expect(result.customerType).toBe('retail')
    expect(result.status).toBe('active')
    expect(result.creditLimit.amount).toBe(5000)
    expect(result.outstandingBalance.amount).toBe(1000)
    expect(result.address.city).toBe('Cairo')
  })

  it('handles inactive customer', () => {
    const row = { id: 'cust-1', is_active: false, created_at: new Date().toISOString() }
    const result = CustomerMapper.fromLegacyRow(row)
    expect(result.status).toBe('suspended')
  })
})

// ═══════════════════════════════════════════════════════════════
//  PRODUCT MAPPER
// ═══════════════════════════════════════════════════════════════

describe('ProductMapper', () => {
  it('maps legacy row to Product', () => {
    const row = {
      id: 'p1', company_id: 'comp-1', category_id: 'cat-1',
      product_name: 'Product A', legacy_code: 'P001',
      description: 'A product', carton_quantity: 24, carton_price: 2400,
      is_active: true, is_out_of_stock: false,
      product_units: [{ unit_type: 'carton', is_active: true }],
      created_at: '2026-01-01T00:00:00Z',
    }
    const result = ProductMapper.fromLegacyRow(row)
    expect(result.id).toBe('p1')
    expect(result.productName).toBe('Product A')
    expect(result.cartonQuantity).toBe(24)
    expect(result.cartonPrice).toBe(2400)
    expect(result.isOutOfStock).toBe(false)
    expect(result.availableUnits).toEqual(['carton'])
  })

  it('handles out of stock product', () => {
    const row = { id: 'p1', is_out_of_stock: true, created_at: new Date().toISOString() }
    const result = ProductMapper.fromLegacyRow(row)
    expect(result.isOutOfStock).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
//  INVENTORY MAPPER
// ═══════════════════════════════════════════════════════════════

describe('InventoryMapper', () => {
  it('extracts inventory from product row', () => {
    const row = {
      id: 'p1', company_id: 'comp-1',
      inventory: { id: 'inv-1', quantity: 100, last_counted_at: null, notes: null, updated_at: '2026-01-01T00:00:00Z' },
      updated_at: '2026-01-01T00:00:00Z',
    }
    const result = InventoryMapper.fromProductRow(row)
    expect(result.productId).toBe('p1')
    expect(result.quantity).toBe(100)
    expect(result.id).toBe('inv-1')
  })

  it('handles missing inventory', () => {
    const row = { id: 'p1', company_id: 'comp-1', updated_at: '2026-01-01T00:00:00Z' }
    const result = InventoryMapper.fromProductRow(row)
    expect(result.productId).toBe('p1')
    expect(result.quantity).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════
//  ATTENDANCE MAPPER
// ═══════════════════════════════════════════════════════════════

describe('AttendanceMapper', () => {
  it('maps workday row to Workday', () => {
    const row = {
      session_id: 'wd-1', company_id: 'comp-1', employee_id: 'emp-1',
      status: 'active', started_at: '2026-07-05T08:00:00Z', date: '2026-07-05',
    }
    const result = AttendanceMapper.fromLegacyRow(row)
    expect(result.id).toBe('wd-1')
    expect(result.status).toBe(WorkdayStatus.Active)
    expect(result.employeeId).toBe('emp-1')
    expect(result.checkIn).not.toBeNull()
    expect(result.checkOut).toBeNull()
  })

  it('maps completed workday', () => {
    const row = {
      session_id: 'wd-1', status: 'completed',
      started_at: '2026-07-05T08:00:00Z', ended_at: '2026-07-05T16:00:00Z',
    }
    const result = AttendanceMapper.fromLegacyRow(row)
    expect(result.status).toBe(WorkdayStatus.Completed)
    expect(result.checkOut).not.toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
//  COLLECTION MAPPER
// ═══════════════════════════════════════════════════════════════

describe('CollectionMapper', () => {
  it('maps cash collection row to Payment', () => {
    const row = {
      id: 'col-1', method: 'cash', amount: 500,
      reference_number: null, collected_at: '2026-07-05T12:00:00Z',
      created_at: '2026-07-05T12:00:00Z', customer_id: 'cust-1',
    }
    const result = CollectionMapper.paymentFromLegacyRow(row, 'ord-1')
    expect(result.id).toBe('col-1')
    expect(result.orderId).toBe('ord-1')
    expect(result.paymentMethod).toBe(PaymentMethod.Cash)
    expect(result.amount.amount).toBe(500)
  })

  it('maps check collection row to CheckPayment', () => {
    const row = {
      id: 'col-2', method: 'check', amount: 1000,
      reference_number: 'CHK001', bank_name: 'NBE',
      due_date: '2026-08-01T00:00:00Z',
      collected_at: '2026-07-05T12:00:00Z', created_at: '2026-07-05T12:00:00Z',
      customer_id: 'cust-1',
    }
    const result = CollectionMapper.checkPaymentFromLegacyRow(row, 'ord-1')
    expect(result.id).toBe('col-2')
    expect(result.paymentMethod).toBe(PaymentMethod.Check)
    expect(result.checkNumber).toBe('CHK001')
    expect(result.bankName).toBe('NBE')
    expect(result.amount.amount).toBe(1000)
  })
})
