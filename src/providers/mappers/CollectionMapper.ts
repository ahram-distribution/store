import type { Payment, CheckPayment } from '../../domain/models/payment'
import { createMoney } from '../../domain/value-objects/Money'
import { PaymentMethod } from '../../domain/enums/PaymentMethod'
import { CheckStatus } from '../../domain/enums/CheckStatus'

export class CollectionMapper {
  static paymentFromLegacyRow(row: any, orderId?: string): Payment {
    return {
      id: row.id,
      orderId: orderId ?? row.order_id ?? '',
      customerId: row.customer_id ?? '',
      amount: createMoney(Number(row.amount) || 0),
      paymentMethod: (row.method === 'check' ? PaymentMethod.Check : PaymentMethod.Cash),
      checkNumber: row.reference_number ?? null,
      collectedAt: new Date(row.collected_at ?? row.created_at),
    }
  }

  static checkPaymentFromLegacyRow(row: any, orderId?: string): CheckPayment {
    return {
      id: row.id,
      orderId: orderId ?? row.order_id ?? '',
      customerId: row.customer_id ?? '',
      amount: createMoney(Number(row.amount) || 0),
      paymentMethod: PaymentMethod.Check,
      checkNumber: row.reference_number ?? '',
      bankName: row.bank_name ?? '',
      dueDate: new Date(row.due_date ?? row.collected_at ?? row.created_at),
      status: CheckStatus.Received,
      collectedAt: new Date(row.collected_at ?? row.created_at),
    }
  }
}
