import type { Payment, CheckPayment } from '../../domain/models/payment'

export interface ICollectionProvider {
  receiveCashPayment(payment: Payment): Promise<void>
  receiveCheckPayment(payment: CheckPayment): Promise<void>
  depositCheck(checkId: string): Promise<void>
  clearCheck(checkId: string): Promise<void>
  returnCheck(checkId: string, reason: string): Promise<void>

  getPaymentsByOrder(orderId: string): Promise<Payment[]>
  getPaymentById(id: string): Promise<Payment | null>
}
