export const CustomerType = {
  Retail: 'retail',
  Wholesale: 'wholesale',
  Distributor: 'distributor',
} as const

export type CustomerType = (typeof CustomerType)[keyof typeof CustomerType]
