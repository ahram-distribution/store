import type { IProvider, HealthCheckResult, ProviderStatus } from '../../contracts/IProvider'
import type { ICollectionProvider } from '../../contracts/ICollectionProvider'
import type { Payment, CheckPayment } from '../../../domain/models/payment'
import { createMoney } from '../../../domain/value-objects/Money'
import { PaymentMethod } from '../../../domain/enums/PaymentMethod'

export class MockCollectionProvider implements ICollectionProvider, IProvider {
  readonly name = 'collection'
  readonly status: ProviderStatus = 'connected'

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthCheck(): Promise<HealthCheckResult> {
    return { status: 'connected', latencyMs: 0, message: 'Mock OK', timestamp: new Date() }
  }

  async receiveCashPayment(payment: Payment): Promise<void> {
    return
  }

  async receiveCheckPayment(payment: CheckPayment): Promise<void> {
    return
  }

  async depositCheck(checkId: string): Promise<void> {
    return
  }

  async clearCheck(checkId: string): Promise<void> {
    return
  }

  async returnCheck(checkId: string, reason: string): Promise<void> {
    return
  }

  async getPaymentsByOrder(orderId: string): Promise<Payment[]> {
    return []
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    if (id === 'nonexistent') return null
    return {
      id,
      orderId: 'ord-1',
      customerId: 'cust-1',
      amount: createMoney(500),
      paymentMethod: PaymentMethod.Cash,
      checkNumber: null,
      collectedAt: new Date('2026-07-05T12:00:00Z'),
    }
  }
}
