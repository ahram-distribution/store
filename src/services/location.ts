import { supabase } from '../lib/supabase'

export interface LocationRecord {
  id: string
  latitude: number
  longitude: number
  accuracy_meters: number | null
  google_maps_url: string
  formatted_address: string | null
  captured_at: string
  created_at: string
}

export interface FreshLocation {
  latitude: number
  longitude: number
  accuracy: number
  capturedAt: string
}

export type LocationErrorCode =
  | 'UNSUPPORTED'
  | 'INSECURE_CONTEXT'
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNKNOWN_ERROR'

export interface LocationCaptureResult {
  success: boolean
  location: FreshLocation | null
  error?: {
    code: LocationErrorCode
    message: string
  }
}

const GPS_TIMEOUT_MS = 15000
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

export const locationService = {
  buildGoogleMapsUrl(lat: number, lng: number): string {
    return 'https://www.google.com/maps?q=' + lat + ',' + lng
  },

  openGoogleMaps(lat: number, lng: number): void {
    window.open(this.buildGoogleMapsUrl(lat, lng), '_blank', 'noopener,noreferrer')
  },

  formatAccuracy(accuracy: number | null | undefined): { label: string; className: string; detail: string } {
    if (accuracy === null || accuracy === undefined) {
      return { label: 'غير محدد', className: 'text-text-secondary', detail: '' }
    }
    const rounded = Math.round(accuracy)
    const detail = rounded + ' متر'
    if (rounded <= 20) {
      return { label: 'ممتازة', className: 'text-success', detail }
    }
    if (rounded <= 50) {
      return { label: 'جيدة', className: 'text-accent', detail }
    }
    if (rounded <= 100) {
      return { label: 'مقبولة', className: 'text-warning', detail }
    }
    if (rounded <= 200) {
      return { label: 'ضعيفة', className: 'text-danger', detail }
    }
    return { label: 'ضعيفة جداً', className: 'text-danger/70', detail }
  },

  async fetchLocation(locationId: string): Promise<LocationRecord | null> {
    const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (!token) return null
    const { data } = await supabase.rpc('get_governed_location', {
      p_token: token,
      p_id: locationId,
    })
    const result = data as any
    if (result?.error) return null
    return result as LocationRecord
  },

  async fetchLocations(locationIds: string[]): Promise<Map<string, LocationRecord>> {
    const ids = locationIds.filter(Boolean)
    if (ids.length === 0) return new Map()
    const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (!token) return new Map()
    const { data } = await supabase.rpc('get_governed_locations', {
      p_token: token,
      p_ids: ids,
    })
    const map = new Map<string, LocationRecord>()
    if (Array.isArray(data)) {
      for (const r of data) {
        if (r && !r.error) map.set(r.id, r as LocationRecord)
      }
    }
    return map
  },

  captureFreshLocation(): Promise<LocationCaptureResult> {
    return this._captureWithRetry(1)
  },

  async _captureWithRetry(attempt: number): Promise<LocationCaptureResult> {
    if (!navigator.geolocation) {
      const result: LocationCaptureResult = {
        success: false,
        location: null,
        error: { code: 'UNSUPPORTED', message: 'الموقع غير مدعوم على هذا الجهاز' },
      }
      console.warn('[GPS] Unsupported', result)
      return result
    }

    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      const result: LocationCaptureResult = {
        success: false,
        location: null,
        error: { code: 'INSECURE_CONTEXT', message: 'الموقع يتطلب اتصال آمن (HTTPS)' },
      }
      console.warn('[GPS] Insecure context', result)
      return result
    }

    const result = await this._attemptGPS()

    if (result.success && result.location) {
      console.log('[GPS] Captured on attempt', attempt, { accuracy: result.location.accuracy })
      return result
    }

    console.warn(`[GPS] Attempt ${attempt}/${MAX_RETRIES} failed`, result.error)

    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
      return this._captureWithRetry(attempt + 1)
    }

    return result
  },

  _attemptGPS(): Promise<LocationCaptureResult> {
    return new Promise((resolve) => {
      const CONVERGENCE_MS = 3000
      const EARLY_EXIT_ACCURACY = 10
      const fixes: { accuracy: number; latitude: number; longitude: number; capturedAt: string }[] = []
      let watchId: number
      let timer: ReturnType<typeof setTimeout>

      const cleanup = () => {
        navigator.geolocation.clearWatch(watchId)
        clearTimeout(timer)
      }

      const selectBest = (): FreshLocation => {
        const best = fixes.reduce((a, b) => a.accuracy <= b.accuracy ? a : b)
        return {
          latitude: best.latitude,
          longitude: best.longitude,
          accuracy: best.accuracy,
          capturedAt: best.capturedAt,
        }
      }

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const accuracy = Math.round(pos.coords.accuracy)
          fixes.push({
            accuracy,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            capturedAt: new Date().toISOString(),
          })

          if (accuracy <= EARLY_EXIT_ACCURACY) {
            cleanup()
            resolve({ success: true, location: selectBest() })
          }
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            cleanup()
            resolve({
              success: false,
              location: null,
              error: { code: 'PERMISSION_DENIED' as LocationErrorCode, message: 'تم رفض إذن الموقع' },
            })
            return
          }
          if (fixes.length === 0) {
            cleanup()
            resolve({
              success: false,
              location: null,
              error: { code: 'POSITION_UNAVAILABLE' as LocationErrorCode, message: 'GPS غير مفعل أو الإشارة ضعيفة' },
            })
          }
        },
        { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 0 }
      )

      timer = setTimeout(() => {
        cleanup()
        if (fixes.length > 0) {
          resolve({ success: true, location: selectBest() })
        } else {
          resolve({
            success: false,
            location: null,
            error: { code: 'TIMEOUT', message: 'انتهت مهلة تحديد الموقع' },
          })
        }
      }, CONVERGENCE_MS)
    })
  },

  async createOperationalLocation(gps: FreshLocation): Promise<string | null> {
    const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (!token) return null
    const { data } = await supabase.rpc('governed_create_location', {
      p_token: token,
      p_latitude: gps.latitude,
      p_longitude: gps.longitude,
      p_accuracy_meters: gps.accuracy,
    })
    const result = data as any
    if (result?.error) return null
    return result.id as string
  },

  async captureAndStoreLocation(): Promise<{ locationId: string | null; gps: FreshLocation | null }> {
    const result = await this.captureFreshLocation()
    if (!result.success || !result.location) {
      return { locationId: null, gps: null }
    }
    const locationId = await this.createOperationalLocation(result.location)
    return { locationId, gps: result.location }
  },
}

export function getLocationAccuracyLabel(accuracy: number | null | undefined): string {
  return locationService.formatAccuracy(accuracy).label
}
