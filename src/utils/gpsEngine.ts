import { getCurrentLocation, startWatching, stopWatching, isWatching, getLastKnownLocation, clearLocationCache, getAccuracyLabel } from '../services/gpsService'

export const gpsEngine = {
  acquire: getCurrentLocation,
  startWatching,
  stopWatching,
  isWatching,
  getLastKnown: getLastKnownLocation,
  clearCache: clearLocationCache,
  getAccuracyLabel,
  reset(): void {
    clearLocationCache()
  },
}
