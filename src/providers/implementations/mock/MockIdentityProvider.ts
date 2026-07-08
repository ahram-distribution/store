import type { IProvider, HealthCheckResult, ProviderStatus } from '../../contracts/IProvider'

export class MockIdentityProvider implements IProvider {
  readonly name = 'identity'
  readonly status: ProviderStatus = 'connected'

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthCheck(): Promise<HealthCheckResult> {
    return { status: 'connected', latencyMs: 0, message: 'Mock OK', timestamp: new Date() }
  }
}
