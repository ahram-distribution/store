import { locationService, type LocationCaptureResult } from '../services/location'

export async function gpsOperation(opName: string, maxWaitMs?: number): Promise<LocationCaptureResult> {
  return locationService.captureLocation(opName, maxWaitMs)
}
