import type { IAuthorizationPolicy } from '../contracts/IAuthorizationPolicy'

export const createOrderPolicy: IAuthorizationPolicy = {
  policyName: 'CreateOrderPolicy',
  authorize(session) {
    const hasCapability = session.roles.some(r =>
      r.capabilities.some(c => c.code === 'orders.create'),
    )
    if (!hasCapability) return { allowed: false, reason: 'Sales rep permission required to create orders' }
    return { allowed: true }
  },
}
