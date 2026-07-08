export {
  detectEnvironment,
  createRuntimeConfig,
  modeToBackend,
  resolveProviders,
  createApp,
} from './bootstrap/index'
export type {
  EnvironmentInfo,
  RuntimeEnvironment,
  AppMode,
  RuntimeConfig,
  RuntimeConfigOverrides,
  ResolvedProviders,
  BootstrapContext,
  BootstrapOptions,
} from './bootstrap/index'

export { ProviderRegistry } from './providers/registry/ProviderRegistry'
export type { IProviderRegistry } from './providers/contracts/IProviderRegistry'
export type { RequestContext } from './providers/contracts/RequestContext'
export { createRequestContext } from './providers/contracts/RequestContext'

export { composeApplication, createProviderSet, resolveBackend, DEFAULT_BACKEND } from './di'
export type { ProviderBackend, ProviderSet, AppConfig, ApplicationApi } from './di'
