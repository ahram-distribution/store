export const OrderStatus = {
  Draft: 'draft',
  Submitted: 'submitted',
  Reviewing: 'reviewing',
  Approved: 'approved',
  Rejected: 'rejected',
  Preparing: 'preparing',
  Dispatched: 'dispatched',
  Delivered: 'delivered',
  Cancelled: 'cancelled',
} as const

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus]

export const OrderStatusLabel: Record<OrderStatus, string> = {
  draft: 'مسودة',
  submitted: 'مقدم',
  reviewing: 'قيد المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض',
  preparing: 'قيد التحضير',
  dispatched: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return status === OrderStatus.Delivered
    || status === OrderStatus.Rejected
    || status === OrderStatus.Cancelled
}

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  const transitions: Record<OrderStatus, OrderStatus[]> = {
    draft: [OrderStatus.Submitted, OrderStatus.Cancelled],
    submitted: [OrderStatus.Reviewing, OrderStatus.Rejected],
    reviewing: [OrderStatus.Approved, OrderStatus.Rejected],
    approved: [OrderStatus.Preparing, OrderStatus.Cancelled],
    rejected: [],
    preparing: [OrderStatus.Dispatched],
    dispatched: [OrderStatus.Delivered],
    delivered: [],
    cancelled: [],
  }
  return transitions[from]?.includes(to) ?? false
}
