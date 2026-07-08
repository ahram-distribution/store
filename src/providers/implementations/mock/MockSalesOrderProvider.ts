import type { IProvider, HealthCheckResult, ProviderStatus } from '../../contracts/IProvider'
import type { ISalesOrderProvider, OrderSearchCriteria } from '../../contracts/ISalesOrderProvider'
import type { SalesOrder } from '../../../domain/models/salesOrder'
import { createMoney } from '../../../domain/value-objects/Money'
import { OrderStatus } from '../../../domain/enums/OrderStatus'

export class MockSalesOrderProvider implements ISalesOrderProvider, IProvider {
  readonly name = 'salesOrder'
  readonly status: ProviderStatus = 'connected'

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthCheck(): Promise<HealthCheckResult> {
    return { status: 'connected', latencyMs: 0, message: 'Mock OK', timestamp: new Date() }
  }

  async placeNewOrder(order: SalesOrder): Promise<void> {
    return
  }

  async submitOrder(order: SalesOrder): Promise<void> {
    return
  }

  async approveOrder(order: SalesOrder): Promise<void> {
    return
  }

  async rejectOrder(orderId: string, reason: string): Promise<void> {
    return
  }

  async cancelOrder(orderId: string): Promise<void> {
    return
  }

  async recordPayment(order: SalesOrder): Promise<void> {
    return
  }

  async getOrderById(id: string): Promise<SalesOrder | null> {
    if (id === 'nonexistent') return null
    return {
      id,
      companyId: 'comp-1',
      customerId: 'cust-1',
      customerName: 'Mock Customer',
      salesRepId: 'emp-1',
      status: OrderStatus.Draft,
      lines: [],
      subtotal: createMoney(0),
      discount: createMoney(0),
      grandTotal: createMoney(0),
      paidAmount: createMoney(0),
      balanceDue: createMoney(0),
      notes: null,
      createdAt: new Date('2026-07-05T10:00:00Z'),
      updatedAt: new Date('2026-07-05T10:00:00Z'),
    }
  }

  async getCustomerOrders(customerId: string): Promise<SalesOrder[]> {
    return []
  }

  async searchOrders(criteria: OrderSearchCriteria): Promise<SalesOrder[]> {
    return []
  }
}
