import type { Session } from '../../domain/models/identity'

export interface IAuthorizationPolicy {
  readonly policyName: string
  authorize(session: Session, resource?: unknown): { allowed: boolean; reason?: string }
}
