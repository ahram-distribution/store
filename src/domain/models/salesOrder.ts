import { OrderStatus, isValidTransition } from '../enums'
import type { UnitType } from '../enums'
import { createMoney, addMoney, subtractMoney, ZeroMoney } from '../value-objects'
import type { Money } from '../value-objects'
import { createDomainEvent } from '../events'
import type { DomainEvent } from '../events'

export interface OrderLine {
  readonly id: string
  readonly productId: string
  readonly productName: string
  readonly unitType: UnitType
  readonly unitPrice: Money
  readonly quantity: number
  readonly total: Money
}

export function createOrderLine(
  id: string,
  productId: string,
  productName: string,
  unitType: UnitType,
  unitPrice: Money,
  quantity: number,
): OrderLine {
  const total = { amount: unitPrice.amount * quantity, currency: unitPrice.currency }
  return { id, productId, productName, unitType, unitPrice, quantity, total }
}

export interface SalesOrder {
  readonly id: string
  readonly orderNumber: string
  readonly companyId: string
  readonly customerId: string
  readonly customerName: string
  readonly ownerName: string
  readonly salesRepId: string
  readonly status: OrderStatus
  readonly lines: readonly OrderLine[]
  readonly subtotal: Money
  readonly discount: Money
  readonly grandTotal: Money
  readonly paidAmount: Money
  readonly balanceDue: Money
  readonly notes: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export function createSalesOrder(
  id: string,
  companyId: string,
  customerId: string,
  customerName: string,
  ownerName: string,
  salesRepId: string,
  lines: OrderLine[],
  discount?: Money,
  notes?: string | null,
): SalesOrder {
  const now = new Date()
  const subtotal = lines.reduce((acc, l) => addMoney(acc, l.total), ZeroMoney)
  const disc = discount ?? ZeroMoney
  const grandTotal = subtractMoney(subtotal, disc)
  return {
    id, orderNumber: '', companyId, customerId, customerName, ownerName, salesRepId,
    status: OrderStatus.Draft,
    lines,
    subtotal,
    discount: disc,
    grandTotal,
    paidAmount: ZeroMoney,
    balanceDue: grandTotal,
    notes: notes ?? null,
    createdAt: now,
    updatedAt: now,
  }
}

export function submitOrder(order: SalesOrder): { order: SalesOrder; event: DomainEvent } {
  if (!isValidTransition(order.status, OrderStatus.Submitted)) {
    throw new Error(`Cannot submit order in status ${order.status}`)
  }
  const updated: SalesOrder = { ...order, status: OrderStatus.Submitted, updatedAt: new Date() }
  const event = createDomainEvent('sales_order.submitted', order.id, 'sales_order', { previousStatus: order.status })
  return { order: updated, event }
}

export function reviewOrder(order: SalesOrder): { order: SalesOrder; event: DomainEvent } {
  if (!isValidTransition(order.status, OrderStatus.Reviewing)) {
    throw new Error(`Cannot review order in status ${order.status}`)
  }
  const updated: SalesOrder = { ...order, status: OrderStatus.Reviewing, updatedAt: new Date() }
  const event = createDomainEvent('sales_order.approved', order.id, 'sales_order', { previousStatus: order.status })
  return { order: updated, event }
}

export function approveOrder(order: SalesOrder): { order: SalesOrder; event: DomainEvent } {
  if (!isValidTransition(order.status, OrderStatus.Approved)) {
    throw new Error(`Cannot approve order in status ${order.status}`)
  }
  const updated: SalesOrder = { ...order, status: OrderStatus.Approved, updatedAt: new Date() }
  const event = createDomainEvent('sales_order.approved', order.id, 'sales_order', { previousStatus: order.status })
  return { order: updated, event }
}

export function rejectOrder(order: SalesOrder, reason: string): { order: SalesOrder; event: DomainEvent } {
  if (!isValidTransition(order.status, OrderStatus.Rejected)) {
    throw new Error(`Cannot reject order in status ${order.status}`)
  }
  const updated: SalesOrder = { ...order, status: OrderStatus.Rejected, updatedAt: new Date() }
  const event = createDomainEvent('sales_order.approved', order.id, 'sales_order', { previousStatus: order.status, reason })
  return { order: updated, event }
}

export function cancelOrder(order: SalesOrder): { order: SalesOrder; event: DomainEvent } {
  if (!isValidTransition(order.status, OrderStatus.Cancelled)) {
    throw new Error(`Cannot cancel order in status ${order.status}`)
  }
  const updated: SalesOrder = { ...order, status: OrderStatus.Cancelled, updatedAt: new Date() }
  const event = createDomainEvent('sales_order.cancelled', order.id, 'sales_order', { previousStatus: order.status })
  return { order: updated, event }
}

export function recordPayment(order: SalesOrder, amount: Money): SalesOrder {
  if (order.status !== OrderStatus.Approved && order.status !== OrderStatus.Draft) {
    throw new Error(`Cannot record payment for order in status ${order.status}`)
  }
  const newPaid = addMoney(order.paidAmount, amount)
  const newBalance = subtractMoney(order.grandTotal, newPaid)
  return { ...order, paidAmount: newPaid, balanceDue: newBalance, updatedAt: new Date() }
}

export function addLineToOrder(order: SalesOrder, line: OrderLine): SalesOrder {
  if (order.status !== OrderStatus.Draft) {
    throw new Error('Can only add lines to draft orders')
  }
  const newLines = [...order.lines, line]
  const subtotal = addMoney(order.subtotal, line.total)
  const grandTotal = subtractMoney(subtotal, order.discount)
  const balanceDue = subtractMoney(grandTotal, order.paidAmount)
  return { ...order, lines: newLines, subtotal, grandTotal, balanceDue, updatedAt: new Date() }
}
