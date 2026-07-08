export type RuntimeEnvironment = 'development' | 'production' | 'test' | 'desktop'

export interface EnvironmentInfo {
  environment: RuntimeEnvironment
  isDevelopment: boolean
  isProduction: boolean
  isTest: boolean
  isDesktop: boolean
  isCapacitor: boolean
  isBrowser: boolean
  mode: string
  baseUrl: string
  userAgent: string
}

export function detectEnvironment(): EnvironmentInfo {
  const mode = typeof import.meta !== 'undefined' ? import.meta.env.MODE : 'production'
  const hasWindow = typeof window !== 'undefined'
  const hasCapacitor = hasWindow && !!(window as any).Capacitor?.isNativePlatform?.()
  const ua = hasWindow ? navigator.userAgent : ''
  const isElectron = ua.includes('Electron')
  const baseUrl = hasWindow ? `${window.location.protocol}//${window.location.host}` : ''

  let environment: RuntimeEnvironment = 'development'
  if (mode === 'test') {
    environment = 'test'
  } else if (isElectron) {
    environment = 'desktop'
  } else if (mode === 'production') {
    environment = 'production'
  }

  return {
    environment,
    isDevelopment: environment === 'development',
    isProduction: environment === 'production',
    isTest: environment === 'test',
    isDesktop: environment === 'desktop',
    isCapacitor: hasCapacitor,
    isBrowser: hasWindow && !isElectron && !hasCapacitor,
    mode,
    baseUrl,
    userAgent: ua,
  }
}
