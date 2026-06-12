import { registerPlugin } from '@capacitor/core'

export interface TrackingServicePlugin {
  start(options: {
    sessionId: string
    token: string
    supabaseUrl: string
    anonKey: string
    intervalSeconds: number
  }): Promise<void>

  stop(): Promise<void>

  getStatus(): Promise<{ running: boolean; nativeService: boolean }>

  isBatteryOptimizationEnabled(): Promise<{ enabled: boolean }>

  requestDisableBatteryOptimization(): Promise<void>

  openBatterySettings(): Promise<void>

  getBatteryLevel(): Promise<{ level: number }>
}

const TrackingService = registerPlugin<TrackingServicePlugin>('TrackingService', {
  web: () => import('./tracking-service.web').then(m => new m.TrackingServiceWeb()),
})

export default TrackingService
