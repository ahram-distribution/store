import type { IProvider, HealthCheckResult } from './IProvider'

export interface ProviderRegistration {
  name: string
  provider: IProvider
  isDefault?: boolean
}

export interface IProviderRegistry {
  register<T extends IProvider>(name: string, provider: T): void
  registerMultiple(registrations: ProviderRegistration[]): void
  resolve<T extends IProvider>(name: string): T
  resolveOrNull<T extends IProvider>(name: string): T | null
  setDefault(name: string): void
  getDefault(): string
  getAllProviders(): Map<string, IProvider>
  getStatus(name: string): string
  healthCheckAll(): Promise<Map<string, HealthCheckResult>>
}
