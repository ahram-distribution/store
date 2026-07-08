import type { ProviderBackend } from '../di/ProviderConfig'
import { resolveBackend, DEFAULT_BACKEND } from '../di/ProviderConfig'
import type { EnvironmentInfo } from './EnvironmentResolver'

export type AppMode = ProviderBackend | 'test'

export interface RuntimeConfig {
  mode: AppMode
  providerBackend: ProviderBackend
  environment: EnvironmentInfo
  apiUrl: string
  version: string
}

export function modeToBackend(mode: AppMode): ProviderBackend {
  if (mode === 'test') return 'mock'
  return mode
}

export interface RuntimeConfigOverrides {
  mode?: AppMode
  apiUrl?: string
  version?: string
}

export function createRuntimeConfig(
  environment: EnvironmentInfo,
  overrides?: RuntimeConfigOverrides,
): RuntimeConfig {
  const mode = overrides?.mode ?? resolveMode(environment)
  return {
    mode,
    providerBackend: modeToBackend(mode),
    environment,
    apiUrl: overrides?.apiUrl ?? resolveApiUrl(environment),
    version: overrides?.version ?? resolveVersion(),
  }
}

function resolveMode(env: EnvironmentInfo): AppMode {
  if (env.isTest) return 'test'
  if (env.isDesktop) return 'desktop'
  return DEFAULT_BACKEND
}

function resolveApiUrl(env: EnvironmentInfo): string {
  if (env.isProduction) return '/store/api'
  if (env.isTest) return ''
  return 'http://localhost:3000'
}

function resolveVersion(): string {
  try {
    const v = (typeof document !== 'undefined')
      ? document.querySelector('meta[name="app-version"]')?.getAttribute('content')
      : undefined
    return v ?? import.meta.env.VITE_APP_VERSION ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
