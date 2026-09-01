export const OrderStatus = {
  Submitted: 'submitted',
  Approved: 'approved',
  Reviewing: 'reviewing',
  Preparing: 'preparing',
  Prepared: 'prepared',
  Delivered: 'delivered',
  ReturnedForRevision: 'returned_for_revision',
  Cancelled: 'cancelled',
} as const

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus]

export const OrderStatusLabel: Record<OrderStatus, string> = {
  submitted: 'طلب شراء',
  approved: 'معتمد',
  reviewing: 'تم القيد بالسيستم',
  preparing: 'قيد التجهيز',
  prepared: 'تم التجهيز',
  delivered: 'تم التسليم',
  returned_for_revision: 'معاد للتعديل',
  cancelled: 'ملغى',
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return status === OrderStatus.Delivered
    || status === OrderStatus.ReturnedForRevision
    || status === OrderStatus.Cancelled
}

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  const transitions: Record<OrderStatus, OrderStatus[]> = {
    submitted: [OrderStatus.Approved, OrderStatus.Reviewing, OrderStatus.ReturnedForRevision, OrderStatus.Cancelled],
    approved: [OrderStatus.Reviewing, OrderStatus.ReturnedForRevision, OrderStatus.Cancelled],
    reviewing: [OrderStatus.Approved, OrderStatus.ReturnedForRevision, OrderStatus.Cancelled],
    preparing: [OrderStatus.Prepared, OrderStatus.ReturnedForRevision, OrderStatus.Cancelled],
    prepared: [OrderStatus.Delivered, OrderStatus.ReturnedForRevision, OrderStatus.Cancelled],
    delivered: [],
    returned_for_revision: [OrderStatus.Submitted, OrderStatus.Cancelled],
    cancelled: [],
  }
  return transitions[from]?.includes(to) ?? false
}
