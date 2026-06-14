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

let _lastLocation: FreshLocation | null = null
const CACHE_TTL_MS = 10000
const _reverseGeocodeCache = new Map<string, string>()

export const locationService = {
  buildGoogleMapsUrl(lat: number, lng: number): string {
    return 'https://www.google.com/maps?q=' + lat + ',' + lng
  },

  openGoogleMaps(lat: number, lng: number): void {
    window.location.href = this.buildGoogleMapsUrl(lat, lng)
  },

  formatAccuracy(accuracy: number | null | undefined): { label: string; className: string; detail: string } {
    if (accuracy === null || accuracy === undefined) {
      return { label: 'غير محدد', className: 'text-text-secondary', detail: '' }
    }
    const rounded = Math.round(accuracy)
    const detail = rounded + ' متر'
    if (rounded <= 20) return { label: 'ممتازة', className: 'text-success', detail }
    if (rounded <= 50) return { label: 'جيدة', className: 'text-accent', detail }
    if (rounded <= 100) return { label: 'مقبولة', className: 'text-warning', detail }
    if (rounded <= 200) return { label: 'ضعيفة', className: 'text-danger', detail }
    return { label: 'ضعيفة جداً', className: 'text-danger/70', detail }
  },

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    const cacheKey = lat.toFixed(5) + ',' + lng.toFixed(5)
    const cached = _reverseGeocodeCache.get(cacheKey)
    if (cached) return cached
    try {
      const response = await fetch(
        'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng + '&accept-language=ar',
        { headers: { 'User-Agent': 'AhramDistApp/1.0' } }
      )
      if (!response.ok) return null
      const data = await response.json()
      const address = data.display_name || null
      if (address) _reverseGeocodeCache.set(cacheKey, address)
      return address
    } catch {
      return null
    }
  },

  async fetchLocation(locationId: string): Promise<LocationRecord | null> {
    const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (!token) return null
    const { data } = await supabase.rpc('get_governed_location', { p_token: token, p_id: locationId })
    const result = data as any
    if (result?.error) return null
    return result as LocationRecord
  },

  async fetchLocations(locationIds: string[]): Promise<Map<string, LocationRecord>> {
    const ids = locationIds.filter(Boolean)
    if (ids.length === 0) return new Map()
    const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (!token) return new Map()
    const { data } = await supabase.rpc('get_governed_locations', { p_token: token, p_ids: ids })
    const map = new Map<string, LocationRecord>()
    if (Array.isArray(data)) {
      for (const r of data) {
        if (r && !r.error) map.set(r.id, r as LocationRecord)
      }
    }
    return map
  },

  captureLocation(opName?: string, maxWaitMs: number = 30000): Promise<LocationCaptureResult> {
    if (typeof opName === 'number') {
      maxWaitMs = opName
      opName = undefined
    }
    return this._capture(opName, maxWaitMs)
  },

  saveLocation(gps: FreshLocation): Promise<string | null> {
    const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (!token) return Promise.resolve(null)
    return supabase.rpc('governed_create_location', {
      p_token: token,
      p_latitude: gps.latitude,
      p_longitude: gps.longitude,
      p_accuracy_meters: gps.accuracy,
    }).then(({ data }) => {
      const result = data as any
      if (result?.error) return null
      return result.id as string
    })
  },

  async _capture(opName: string | undefined, maxWaitMs: number = 30000): Promise<LocationCaptureResult> {
    console.log('GPS_CAPTURE_START', { opName, maxWaitMs })
    console.log('GEOLOCATION_AVAILABLE', !!navigator.geolocation)
    if (!navigator.geolocation) {
      return { success: false, location: null, error: { code: 'UNSUPPORTED', message: 'الموقع غير مدعوم على هذا الجهاز' } }
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      console.log('GPS_INSECURE_CONTEXT_BLOCKED', { isSecureContext: window.isSecureContext, location: window.location.href })
      return { success: false, location: null, error: { code: 'INSECURE_CONTEXT', message: 'الموقع يتطلب اتصال آمن (HTTPS)' } }
    }
    console.log('GPS_SECURITY_CHECK_PASSED')

    const startTs = Date.now()
    const opTag = opName ? `[GPS:${opName}]` : '[GPS]'

    if (_lastLocation) {
      const age = Date.now() - new Date(_lastLocation.capturedAt).getTime()
      if (age < CACHE_TTL_MS && _lastLocation.accuracy <= 100) {
        return { success: true, location: _lastLocation }
      }
    }

    return this._progressiveGPS(opTag, startTs, maxWaitMs)
  },

  async _progressiveGPS(opTag: string, startTs: number, maxWaitMs: number): Promise<LocationCaptureResult> {
    console.log('GPS_PROGRESSIVE_START', { opTag, startTs, maxWaitMs })
    const elapsed = () => ((Date.now() - startTs) / 1000).toFixed(1)

    const tryPhase = (phaseName: string, enableHighAccuracy: boolean, ms: number, earlyExit: number, maxAccept: number): Promise<LocationCaptureResult | null> => {
      const remaining = maxWaitMs - (Date.now() - startTs)
      if (remaining <= 0) return Promise.resolve(null)
      const duration = Math.min(ms, remaining)
      return this._runPhase(opTag, enableHighAccuracy, duration, earlyExit, maxAccept)
    }

    let result = await tryPhase('1-high', true, 8000, 30, 100)
    if (result?.success) return result

    result = await tryPhase('2-retry', true, 5000, 50, 150)
    if (result?.success) return result

    result = await tryPhase('3-fallback', false, 5000, 999999, 999999)
    if (result?.success) return result

    return {
      success: false, location: null,
      error: { code: 'POSITION_UNAVAILABLE', message: 'تعذر الحصول على موقع دقيق' },
    }
  },

  _runPhase(
    opTag: string,
    enableHighAccuracy: boolean,
    phaseTimeout: number,
    earlyExitAccuracy: number,
    maxAcceptableAccuracy: number
  ): Promise<LocationCaptureResult | null> {
    console.log('GPS_RUNPHASE', { phaseTimeout, enableHighAccuracy })
    return new Promise((resolve) => {
      const fixes: { accuracy: number; latitude: number; longitude: number; capturedAt: string }[] = []
      let watchId: number
      let timer: ReturnType<typeof setTimeout>

      const cleanup = () => {
        navigator.geolocation.clearWatch(watchId)
        clearTimeout(timer)
      }

      const selectBest = (): FreshLocation => {
        const best = fixes.reduce((a, b) => a.accuracy <= b.accuracy ? a : b)
        const loc = { latitude: best.latitude, longitude: best.longitude, accuracy: best.accuracy, capturedAt: best.capturedAt }
        _lastLocation = loc
        return loc
      }

      console.log('GPS_BEFORE_WATCHPOSITION')
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          console.log('GPS_SUCCESS_CALLBACK', { accuracy: pos.coords.accuracy, lat: pos.coords.latitude, lng: pos.coords.longitude })
          const accuracy = Math.round(pos.coords.accuracy)
          fixes.push({
            accuracy,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            capturedAt: new Date().toISOString(),
          })
          if (accuracy <= earlyExitAccuracy) {
            cleanup()
            console.log('GPS_RESOLVE', 'early exit at accuracy=' + accuracy)
            resolve({ success: true, location: selectBest() })
          }
        },
        (err) => {
          console.log('GPS_ERROR_CALLBACK', { code: err.code, message: err.message })
          if (err.code === err.PERMISSION_DENIED) {
            cleanup()
            console.log('GPS_RESOLVE', 'permission denied')
            resolve({
              success: false, location: null,
              error: { code: 'PERMISSION_DENIED', message: 'تم رفض إذن الموقع' },
            })
          }
        },
        { enableHighAccuracy, timeout: phaseTimeout, maximumAge: 0 }
      )

      console.log('GPS_TIMEOUT_SCHEDULED', phaseTimeout)
      timer = setTimeout(() => {
        cleanup()
        if (fixes.length > 0) {
          const best = selectBest()
          if (best.accuracy > maxAcceptableAccuracy) {
            console.log('GPS_RESOLVE', 'timeout — accuracy ' + best.accuracy + ' > max ' + maxAcceptableAccuracy)
            resolve(null)
          } else {
            console.log('GPS_RESOLVE', 'timeout — best accuracy ' + best.accuracy)
            resolve({ success: true, location: best })
          }
        } else {
          console.log('GPS_RESOLVE', 'timeout — no fixes')
          resolve(null)
        }
      }, phaseTimeout)
    })
  },
}

export function getLocationAccuracyLabel(accuracy: number | null | undefined): string {
  return locationService.formatAccuracy(accuracy).label
}

/**
 * Acquire a GPS fix following the business rules:
 *  1. Accept immediately if accuracy ≤ 100m.
 *  2. Keep trying for up to maxWaitMs (default 30s) if accuracy > 100m.
 *  3. Proceed immediately once accuracy ≤ 100m.
 *  4. If maxWaitMs expires without a fix ≤ maxAcceptableAccuracy, return null.
 *
 * Never writes null coordinates. The caller must check the return value
 * and reject the action if GPS acquisition failed.
 */
export function acquireGPS(
  maxWaitMs: number = 30000,
  maxAcceptableAccuracy: number = 100
): Promise<{ latitude: number; longitude: number; accuracy: number; capturedAt: string } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null)
      return
    }

    const startTs = Date.now()
    let watchId: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let resolved = false
    const fixes: Array<{ latitude: number; longitude: number; accuracy: number; capturedAt: string }> = []

    const finish = (result: typeof fixes[0] | null) => {
      if (resolved) return
      resolved = true
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      if (timer !== null) clearTimeout(timer)
      if (result) {
        _lastLocation = { latitude: result.latitude, longitude: result.longitude, accuracy: result.accuracy, capturedAt: result.capturedAt }
      }
      resolve(result)
    }

    const bestFix = () => {
      if (fixes.length === 0) return null
      return fixes.reduce((a, b) => (a.accuracy <= b.accuracy ? a : b))
    }

    timer = setTimeout(() => {
      const best = bestFix()
      if (best && best.accuracy <= maxAcceptableAccuracy) {
        finish(best)
      } else {
        finish(null)
      }
    }, maxWaitMs)

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const fix = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy),
            capturedAt: new Date().toISOString(),
          }
          fixes.push(fix)

          if (fix.accuracy <= maxAcceptableAccuracy) {
            finish(fix)
          }
        },
        () => {
          /* ignore individual errors; timeout handles failure */
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      )
    } catch {
      finish(null)
    }
  })
}
