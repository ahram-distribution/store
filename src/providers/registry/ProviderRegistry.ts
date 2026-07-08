import type { IProvider, HealthCheckResult } from '../contracts/IProvider'
import type { IProviderRegistry, ProviderRegistration } from '../contracts/IProviderRegistry'

export class ProviderRegistry implements IProviderRegistry {
  private providers: Map<string, IProvider> = new Map()
  private defaultName: string = ''

  constructor(registrations?: ProviderRegistration[]) {
    if (registrations) {
      this.registerMultiple(registrations)
    }
  }

  register<T extends IProvider>(name: string, provider: T): void {
    this.providers.set(name, provider)
    if (this.defaultName === '') {
      this.defaultName = name
    }
  }

  registerMultiple(registrations: ProviderRegistration[]): void {
    for (const reg of registrations) {
      this.providers.set(reg.name, reg.provider)
      if (reg.isDefault || (this.defaultName === '' && !reg.isDefault)) {
        this.defaultName = reg.name
      }
    }
  }

  resolve<T extends IProvider>(name: string): T {
    const provider = this.providers.get(name)
    if (!provider) {
      throw new Error(`Provider not found: ${name}`)
    }
    return provider as T
  }

  resolveOrNull<T extends IProvider>(name: string): T | null {
    const provider = this.providers.get(name)
    return provider ? (provider as T) : null
  }

  setDefault(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Cannot set default: provider not found: ${name}`)
    }
    this.defaultName = name
  }

  getDefault(): string {
    return this.defaultName
  }

  getAllProviders(): Map<string, IProvider> {
    return new Map(this.providers)
  }

  getStatus(name: string): string {
    const provider = this.providers.get(name)
    return provider?.status ?? 'not_found'
  }

  async healthCheckAll(): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>()
    for (const [name, provider] of this.providers) {
      try {
        const result = await provider.healthCheck()
        results.set(name, result)
      } catch {
        results.set(name, {
          status: 'error',
          latencyMs: 0,
          message: 'Health check failed',
          timestamp: new Date(),
        })
      }
    }
    return results
  }
}
