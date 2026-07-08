export interface Capability {
  readonly code: string
  readonly name: string
}

export interface Role {
  readonly id: string
  readonly name: string
  readonly capabilities: Capability[]
}

export interface Identity {
  readonly id: string
  readonly identityType: import('../enums').IdentityType
  readonly displayName: string
  readonly phone: string
  readonly isActive: boolean
}

export interface Session {
  readonly id: string
  readonly identityId: string
  readonly identityType: import('../enums').IdentityType
  readonly companyId: string
  readonly roles: Role[]
  readonly startedAt: Date
  readonly expiresAt: Date
}

export function createIdentity(
  id: string,
  identityType: import('../enums').IdentityType,
  displayName: string,
  phone: string,
): Identity {
  return { id, identityType, displayName, phone, isActive: true }
}

export function deactivateIdentity(identity: Identity): Identity {
  return { ...identity, isActive: false }
}

export function hasCapability(session: Session, capabilityCode: string): boolean {
  return session.roles.some(role =>
    role.capabilities.some(cap => cap.code === capabilityCode),
  )
}
