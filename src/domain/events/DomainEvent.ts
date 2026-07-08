export interface DomainEvent {
  readonly eventId: string
  readonly eventType: string
  readonly aggregateId: string
  readonly aggregateType: string
  readonly occurredAt: Date
  readonly payload: Record<string, unknown>
}

export function createDomainEvent(
  eventType: string,
  aggregateId: string,
  aggregateType: string,
  payload: Record<string, unknown>,
): DomainEvent {
  return {
    eventId: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    eventType,
    aggregateId,
    aggregateType,
    occurredAt: new Date(),
    payload,
  }
}

export type SalesOrderSubmitted = DomainEvent & { eventType: 'sales_order.submitted' }
export type SalesOrderApproved = DomainEvent & { eventType: 'sales_order.approved' }
export type SalesOrderRejected = DomainEvent & { eventType: 'sales_order.rejected' }
export type SalesOrderCancelled = DomainEvent & { eventType: 'sales_order.cancelled' }
export type PaymentCollected = DomainEvent & { eventType: 'payment.collected' }
export type CustomerCreated = DomainEvent & { eventType: 'customer.created' }
export type InventoryAdjusted = DomainEvent & { eventType: 'inventory.adjusted' }
