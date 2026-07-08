export interface Money {
  readonly amount: number
  readonly currency: string
}

export function createMoney(amount: number, currency: string = 'EGP'): Money {
  return { amount, currency }
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error('Currency mismatch')
  return { amount: a.amount + b.amount, currency: a.currency }
}

export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error('Currency mismatch')
  return { amount: a.amount - b.amount, currency: a.currency }
}

export function multiplyMoney(a: Money, factor: number): Money {
  return { amount: a.amount * factor, currency: a.currency }
}

export function isMoneyGreaterThan(a: Money, b: Money): boolean {
  if (a.currency !== b.currency) throw new Error('Currency mismatch')
  return a.amount > b.amount
}

export function isMoneyZero(a: Money): boolean {
  return a.amount === 0
}

export function formatMoney(a: Money): string {
  return `${a.amount.toFixed(2)} ${a.currency}`
}

export const ZeroMoney: Money = { amount: 0, currency: 'EGP' }
