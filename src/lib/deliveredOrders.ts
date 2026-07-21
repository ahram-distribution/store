/**
 * Single source of truth for delivered-order calculations.
 * Used by SalesAnalyticsPage and DeliveredOrdersKPI.
 */

/** Canonical delivered check — status === 'delivered' only. No delivered_at requirement. */
export function isDelivered(order: any): boolean {
  return order.status === 'delivered'
}

/** Filter orders to only delivered orders. */
export function filterDelivered(orders: any[]): any[] {
  return orders.filter(isDelivered)
}

/** Sum total_amount for delivered orders. */
export function deliveredTotalAmount(deliveredOrders: any[]): number {
  return deliveredOrders.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0)
}

/** Count delivered orders. */
export function deliveredOrderCount(deliveredOrders: any[]): number {
  return deliveredOrders.length
}

/**
 * Count customers whose FIRST EVER delivered order falls within [dateFrom, dateTo).
 * `allDeliveredOrders` must be ALL delivered orders across all time (not just the target range).
 * Uses delivered_at when available, falls back to created_at.
 */
export function deliveredNewCustomerCount(
  allDeliveredOrders: any[],
  dateFrom: string,
  dateTo: string,
): number {
  const customerFirstDelivery = new Map<string, string>()
  for (const o of allDeliveredOrders) {
    const customerId = o.customer_id as string
    const deliveredAt = (o.delivered_at || o.created_at) as string
    if (!deliveredAt) continue
    const existing = customerFirstDelivery.get(customerId)
    if (!existing || deliveredAt < existing) {
      customerFirstDelivery.set(customerId, deliveredAt)
    }
  }
  let count = 0
  for (const firstDate of customerFirstDelivery.values()) {
    if (firstDate >= dateFrom && firstDate < dateTo) count++
  }
  return count
}
