import type { SalesOrder } from '../../domain/models/salesOrder'
import type { OrderStatus } from '../../domain/enums'

export interface OrderSearchCriteria {
  companyId: string
  customerId?: string
  status?: OrderStatus | OrderStatus[]
  fromDate?: Date
  toDate?: Date
  salesRepId?: string
  minAmount?: number
  maxAmount?: number
  searchText?: string
  limit?: number
  offset?: number
}

export interface ISalesOrderProvider {
  placeNewOrder(order: SalesOrder): Promise<void>
  submitOrder(order: SalesOrder): Promise<void>
  approveOrder(order: SalesOrder): Promise<void>
  rejectOrder(orderId: string, reason: string): Promise<void>
  cancelOrder(orderId: string): Promise<void>
  recordPayment(order: SalesOrder): Promise<void>

  getOrderById(id: string): Promise<SalesOrder | null>
  getCustomerOrders(customerId: string): Promise<SalesOrder[]>
  searchOrders(criteria: OrderSearchCriteria): Promise<SalesOrder[]>
}
