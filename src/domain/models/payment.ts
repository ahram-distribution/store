import type { PaymentMethod, CheckStatus } from '../enums'
import { type Money, createMoney, addMoney } from '../value-objects'

export interface Payment {
  readonly id: string
  readonly orderId: string
  readonly customerId: string
  readonly amount: Money
  readonly paymentMethod: PaymentMethod
  readonly checkNumber: string | null
  readonly collectedAt: Date
}

export interface CheckPayment extends Payment {
  readonly checkNumber: string
  readonly bankName: string
  readonly dueDate: Date
  readonly status: CheckStatus
}

export function createCashPayment(
  id: string,
  orderId: string,
  customerId: string,
  amount: Money,
  collectedAt?: Date,
): Payment {
  return { id, orderId, customerId, amount, paymentMethod: 'cash', checkNumber: null, collectedAt: collectedAt ?? new Date() }
}

export function createCheckPayment(
  id: string,
  orderId: string,
  customerId: string,
  amount: Money,
  checkNumber: string,
  bankName: string,
  dueDate: Date,
): CheckPayment {
  return { id, orderId, customerId, amount, paymentMethod: 'check', checkNumber, collectedAt: new Date(), bankName, dueDate, status: 'received' as CheckStatus }
}

export function depositCheck(check: CheckPayment): CheckPayment {
  if (check.status !== 'received') throw new Error('Check must be in received status to deposit')
  return { ...check, status: 'deposited' as CheckStatus }
}

export function clearCheck(check: CheckPayment): CheckPayment {
  if (check.status !== 'deposited') throw new Error('Check must be deposited to clear')
  return { ...check, status: 'cleared' as CheckStatus }
}

export function bounceCheck(check: CheckPayment): CheckPayment {
  if (check.status !== 'deposited') throw new Error('Check must be deposited to bounce')
  return { ...check, status: 'bounced' as CheckStatus }
}
