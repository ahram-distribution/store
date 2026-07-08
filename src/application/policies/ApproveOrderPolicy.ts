import type { IAuthorizationPolicy } from '../contracts/IAuthorizationPolicy'

export const approveOrderPolicy: IAuthorizationPolicy = {
  policyName: 'ApproveOrderPolicy',
  authorize(session, resource) {
    const hasCapability = session.roles.some(r =>
      r.capabilities.some(c => c.code === 'orders.approve'),
    )
    if (!hasCapability) return { allowed: false, reason: 'Only managers can approve orders' }
    return { allowed: true }
  },
}
