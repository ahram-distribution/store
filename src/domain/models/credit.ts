import type { DocumentStatus } from '../enums'
import { type Money, createMoney, addMoney, isMoneyGreaterThan, subtractMoney, ZeroMoney } from '../value-objects'

export interface CreditNote {
  readonly id: string
  readonly customerId: string
  readonly amount: Money
  readonly reason: string
  readonly createdAt: Date
}

export interface Credit {
  readonly id: string
  readonly customerId: string
  readonly creditLimit: Money
  readonly outstandingBalance: Money
  readonly notes: readonly CreditNote[]
}

export function createCredit(customerId: string, creditLimit: Money): Credit {
  return { id: crypto.randomUUID?.() ?? `${Date.now()}`, customerId, creditLimit, outstandingBalance: ZeroMoney, notes: [] }
}

export function applyCredit(customerId: string, credit: Credit, amount: Money, reason: string): Credit {
  const newBalance = addMoney(credit.outstandingBalance, amount)
  if (isMoneyGreaterThan(newBalance, credit.creditLimit)) {
    throw new Error('Credit limit exceeded')
  }
  const note: CreditNote = { id: crypto.randomUUID?.() ?? `${Date.now()}`, customerId, amount, reason, createdAt: new Date() }
  return { ...credit, outstandingBalance: newBalance, notes: [...credit.notes, note] }
}

export function payDownCredit(credit: Credit, amount: Money): Credit {
  const newBalance = subtractMoney(credit.outstandingBalance, amount)
  return { ...credit, outstandingBalance: newBalance.amount < 0 ? ZeroMoney : newBalance }
}
