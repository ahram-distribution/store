import type { ProviderSet, ProviderBackend } from '../di/ProviderConfig'
import { composeApplication } from '../di/CompositionRoot'
import type { ApplicationApi } from '../di/CompositionRoot'
import { createRequestContext, type RequestContext } from '../providers/contracts/RequestContext'
import { ProviderRegistry } from '../providers/registry/ProviderRegistry'
import { detectEnvironment, type EnvironmentInfo } from './EnvironmentResolver'
import { createRuntimeConfig, type RuntimeConfig, type AppMode, type RuntimeConfigOverrides } from './RuntimeConfiguration'
import { resolveProviders, type ResolvedProviders } from './ProviderResolver'

export interface BootstrapContext {
  registry: ProviderRegistry
  pipeline: ApplicationApi['pipeline']
  providers: ProviderSet
  config: RuntimeConfig
  context: RequestContext
  createContext: typeof createRequestContext
}

export interface BootstrapOptions {
  mode?: AppMode
  backend?: ProviderBackend
  context?: RequestContext
  config?: RuntimeConfigOverrides
  environment?: EnvironmentInfo
}

export function createApp(options?: BootstrapOptions): BootstrapContext {
  const env = options?.environment ?? detectEnvironment()

  const runtimeConfig = createRuntimeConfig(env, {
    mode: options?.mode,
    ...options?.config,
  })

  const context = options?.context ?? createRequestContext({
    token: '',
    identityId: '',
    identityType: 'employee',
    companyId: '',
    roles: [],
    device: env.isDesktop ? 'desktop' : env.isCapacitor ? 'mobile' : 'web',
  })

  const effectiveBackend = options?.backend ?? runtimeConfig.providerBackend
  const effectiveConfig = { ...runtimeConfig, providerBackend: effectiveBackend }
  const { registry, providerSet } = resolveProviders(effectiveConfig, context)

  const api = composeApplication({ backend: effectiveBackend, context })

  return {
    registry,
    pipeline: api.pipeline,
    providers: providerSet,
    config: effectiveConfig,
    context,
    createContext: createRequestContext,
  }
}

export type { ApplicationApi } from '../di/CompositionRoot'
