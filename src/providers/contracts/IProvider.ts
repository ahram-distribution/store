export interface IProvider {
  readonly name: string
  readonly status: ProviderStatus

  connect(): Promise<void>
  disconnect(): Promise<void>
  healthCheck(): Promise<HealthCheckResult>
}

export type ProviderStatus = 'connected' | 'disconnected' | 'error' | 'suspended'

export interface HealthCheckResult {
  status: ProviderStatus
  latencyMs: number
  message?: string
  timestamp: Date
}
