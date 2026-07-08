import type { IAuthorizationPolicy } from '../contracts/IAuthorizationPolicy'

export const collectionPolicy: IAuthorizationPolicy = {
  policyName: 'CollectionPolicy',
  authorize(session) {
    const hasCapability = session.roles.some(r =>
      r.capabilities.some(c => c.code === 'collections.receive'),
    )
    if (!hasCapability) return { allowed: false, reason: 'Collection permission required' }
    return { allowed: true }
  },
}
