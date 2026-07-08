export const PaymentMethod = {
  Cash: 'cash',
  Check: 'check',
  Transfer: 'transfer',
} as const

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod]
