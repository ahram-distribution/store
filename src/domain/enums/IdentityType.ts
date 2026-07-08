export const IdentityType = {
  Employee: 'employee',
  Customer: 'customer',
} as const

export type IdentityType = (typeof IdentityType)[keyof typeof IdentityType]
