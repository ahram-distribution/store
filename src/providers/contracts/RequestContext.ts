export interface RequestContext {
  token: string
  identityId: string
  identityType: 'employee' | 'customer'
  companyId: string
  roles: string[]
  device?: 'web' | 'desktop' | 'mobile'
  timestamp: Date
}

export function createRequestContext(params: {
  token: string
  identityId: string
  identityType: 'employee' | 'customer'
  companyId: string
  roles: string[]
  device?: 'web' | 'desktop' | 'mobile'
}): RequestContext {
  return {
    ...params,
    timestamp: new Date(),
  }
}
