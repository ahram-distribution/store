import type { TrackingServicePlugin } from './tracking-service'

export class TrackingServiceWeb implements TrackingServicePlugin {
  async start() {}
  async stop() {}
  async getStatus() {
    return { running: false, nativeService: false }
  }
  async isBatteryOptimizationEnabled() {
    return { enabled: false }
  }
  async requestDisableBatteryOptimization() {}
  async openBatterySettings() {}
  async getBatteryLevel() {
    return { level: -1 }
  }
}
