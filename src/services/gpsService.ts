export interface GpsLocation {
  latitude: number
  longitude: number
  accuracy: number
  capturedAt: string
}

export interface GpsResult {
  success: boolean
  location: GpsLocation | null
  error?: { code: string; message: string }
}

export interface GpsWatchCallbacks {
  onLocation: (loc: GpsLocation) => void
  onError?: (err: GeolocationPositionError) => void
}

let _lastLocation: GpsLocation | null = null
let _watchId: number | null = null
let _watchCallbacks: GpsWatchCallbacks | null = null

const CACHE_TTL = 10000
const DEFAULT_MAX_WAIT = 30000
const DEFAULT_MAX_ACCURACY = 100

/**
 * One-shot GPS acquisition.
 *  1. Returns cached location if fresh (≤10s) and accurate (≤maxAccuracy).
 *  2. Uses watchPosition with enableHighAccuracy.
 *  3. Accepts fix immediately when accuracy ≤ maxAccuracy.
 *  4. Waits up to maxWaitMs total.
 *  5. Returns null if no acceptable fix within timeout.
 */
export async function getCurrentLocation(options?: {
  maxWaitMs?: number
  maxAccuracy?: number
}): Promise<GpsResult> {
  const maxWaitMs = options?.maxWaitMs ?? DEFAULT_MAX_WAIT
  const maxAccuracy = options?.maxAccuracy ?? DEFAULT_MAX_ACCURACY

  if (_lastLocation) {
    const age = Date.now() - new Date(_lastLocation.capturedAt).getTime()
    if (age < CACHE_TTL && _lastLocation.accuracy <= maxAccuracy) {
      return { success: true, location: _lastLocation }
    }
  }

  if (!navigator.geolocation) {
    return { success: false, location: null, error: { code: 'UNSUPPORTED', message: 'الموقع غير مدعوم على هذا الجهاز' } }
  }

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { success: false, location: null, error: { code: 'INSECURE_CONTEXT', message: 'الموقع يتطلب اتصال آمن (HTTPS)' } }
  }

  return new Promise((resolve) => {
    const startTs = Date.now()
    let watchId: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let resolved = false
    const fixes: GpsLocation[] = []

    const finish = (result: GpsResult) => {
      if (resolved) return
      resolved = true
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      if (timer !== null) clearTimeout(timer)
      if (result.success && result.location) {
        _lastLocation = result.location
      }
      resolve(result)
    }

    timer = setTimeout(() => {
      const best = fixes.length > 0
        ? fixes.reduce((a, b) => a.accuracy <= b.accuracy ? a : b)
        : null
      if (best && best.accuracy <= maxAccuracy) {
        finish({ success: true, location: best })
      } else {
        finish({
          success: false, location: null,
          error: { code: 'TIMEOUT', message: 'لم نتمكن من الحصول على موقع دقيق. يرجى المحاولة مرة أخرى.' },
        })
      }
    }, maxWaitMs)

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const loc: GpsLocation = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy),
            capturedAt: new Date().toISOString(),
          }
          fixes.push(loc)
          if (loc.accuracy <= maxAccuracy) {
            finish({ success: true, location: loc })
          }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      )
    } catch {
      finish({
        success: false, location: null,
        error: { code: 'UNKNOWN_ERROR', message: 'فشل تشغيل GPS' },
      })
    }
  })
}

/**
 * Start continuous GPS watching (for tracking engine / background monitoring).
 */
export function startWatching(callbacks: GpsWatchCallbacks): void {
  if (_watchId !== null) return
  if (!navigator.geolocation) return

  _watchCallbacks = callbacks

  _watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const loc: GpsLocation = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy),
        capturedAt: new Date().toISOString(),
      }
      _lastLocation = loc
      _watchCallbacks?.onLocation(loc)
    },
    (err) => {
      _watchCallbacks?.onError?.(err)
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
  )
}

export function stopWatching(): void {
  if (_watchId !== null) {
    navigator.geolocation.clearWatch(_watchId)
    _watchId = null
  }
  _watchCallbacks = null
}

export function isWatching(): boolean {
  return _watchId !== null
}

export function getLastKnownLocation(): GpsLocation | null {
  return _lastLocation
}

export function clearLocationCache(): void {
  _lastLocation = null
}

export function getAccuracyLabel(accuracy: number | null | undefined): { label: string; color: string } {
  if (accuracy === null || accuracy === undefined) {
    return { label: 'غير معروف', color: 'text-gray-500' }
  }
  if (accuracy <= 10) return { label: 'ممتازة', color: 'text-green-600' }
  if (accuracy <= 30) return { label: 'جيدة', color: 'text-blue-600' }
  if (accuracy <= 100) return { label: 'مقبولة', color: 'text-amber-600' }
  if (accuracy <= 200) return { label: 'ضعيفة', color: 'text-red-600' }
  return { label: 'ضعيفة جداً', color: 'text-red-700' }
}
