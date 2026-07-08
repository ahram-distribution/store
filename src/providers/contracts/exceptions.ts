export class ProviderException extends Error {
  providerName: string
  originalError?: unknown

  constructor(message: string, providerName: string, originalError?: unknown) {
    super(message)
    this.name = 'ProviderException'
    this.providerName = providerName
    this.originalError = originalError
  }
}

export class ConnectionException extends ProviderException {
  constructor(providerName: string, originalError?: unknown) {
    super('Connection failed: ' + providerName, providerName, originalError)
    this.name = 'ConnectionException'
  }
}

export class NotFoundException extends ProviderException {
  entityId?: string

  constructor(providerName: string, entityId?: string) {
    super('Not found: ' + providerName, providerName)
    this.name = 'NotFoundException'
    this.entityId = entityId
  }
}

export class ConflictException extends ProviderException {
  field?: string
  value?: string

  constructor(providerName: string, field?: string, value?: string) {
    super('Conflict: ' + providerName, providerName)
    this.name = 'ConflictException'
    this.field = field
    this.value = value
  }
}

export class TimeoutException extends ProviderException {
  constructor(providerName: string, timeoutMs: number) {
    super('Timeout after ' + timeoutMs + 'ms: ' + providerName, providerName)
    this.name = 'TimeoutException'
  }
}
