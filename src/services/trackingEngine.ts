import { supabase } from '../lib/supabase'
import { trackingQueue } from './trackingQueue'
import { heartbeatService } from './heartbeatService'
import { lastSeenTracker } from './lastSeenTracker'
import { failureLogger } from './failureLogger'
import * as gpsService from './gpsService'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export interface TrackingStatus {
  running: boolean
  intervalSeconds: number
  lastPointAt: string | null
  lastSyncAt: string | null
  pendingCount: number
  gpsAvailable: boolean
  gpsAccuracy: number | null
  watchActive: boolean
  nativeService: boolean
}

type Listener = (status: TrackingStatus) => void

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function getBattery(): Promise<number | null> {
  try {
    const b = (navigator as any).getBattery?.()
    return b ? Promise.resolve(b.level) : Promise.resolve(null)
  } catch { return Promise.resolve(null) }
}

function isNative(): boolean {
  return typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.()
}

class TrackingEngine {
  private _intervalId: ReturnType<typeof setInterval> | null = null
  private _sessionId: string | null = null
  private _employeeId: string | null = null
  private _intervalSeconds = 900
  private _lastPointAt: string | null = null
  private _lastSyncAt: string | null = null
  private _gpsAvailable = false
  private _gpsAccuracy: number | null = null
  private _running = false
  private _watchActive = false
  private _listeners: Set<Listener> = new Set()
  private _flushInterval: ReturnType<typeof setInterval> | null = null
  private _onlineHandler: (() => void) | null = null
  private _visibilityHandler: (() => void) | null = null
  private _lastPosition: { latitude: number; longitude: number; accuracy: number } | null = null
  private _authStored = false
  private _nativeService = false
  private _gpsDeniedLogged = false
  private _wasHidden = false

  get status(): TrackingStatus {
    return {
      running: this._running,
      intervalSeconds: this._intervalSeconds,
      lastPointAt: this._lastPointAt,
      lastSyncAt: this._lastSyncAt,
      pendingCount: 0,
      gpsAvailable: this._gpsAvailable,
      gpsAccuracy: this._gpsAccuracy,
      watchActive: this._watchActive,
      nativeService: this._nativeService,
    }
  }

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  private _telemetry = { captured: 0, synced: 0, queued: 0, failed: 0, dropped: 0 }

  private _notify() {
    trackingQueue.count().then((pendingCount) => {
      const s: TrackingStatus = {
        running: this._running,
        intervalSeconds: this._intervalSeconds,
        lastPointAt: this._lastPointAt,
        lastSyncAt: this._lastSyncAt,
        pendingCount,
        gpsAvailable: this._gpsAvailable,
        gpsAccuracy: this._gpsAccuracy,
        watchActive: this._watchActive,
        nativeService: this._nativeService,
      }
      this._listeners.forEach((fn) => fn(s))
    })
  }

  get sessionId(): string | null { return this._sessionId }
  get employeeId(): string | null { return this._employeeId }

  setEmployeeId(id: string) {
    this._employeeId = id
  }

  private async _storeAuth() {
    if (this._authStored && this._sessionId) return
    const token = getToken()
    if (!token || !this._employeeId) {
      failureLogger.log('auth_missing', `Cannot store auth: missing ${!token ? 'token' : 'employeeId'}`, { sessionId: this._sessionId })
      return
    }
    const info = { supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, token, employeeId: this._employeeId, sessionId: this._sessionId ?? undefined }
    await trackingQueue.storeAuth(info)
    if (this._sessionId) await trackingQueue.storeSessionId(this._sessionId)
    this._authStored = true
  }

  private async _restoreSession(): Promise<boolean> {
    if (this._sessionId) return true
    try {
      const stored = await trackingQueue.getSessionId()
      if (stored) {
        this._sessionId = stored
        failureLogger.log('session_restored', `Session restored from storage: ${stored}`, { sessionId: stored })
        return true
      }
    } catch {
      try {
        const legacy = localStorage.getItem('tracking_session_id')
        if (legacy) {
          this._sessionId = legacy
          failureLogger.log('session_restored', `Session restored from localStorage: ${legacy}`, { sessionId: legacy })
          return true
        }
      } catch {}
    }
    return false
  }

  private async _registerBackgroundSync() {
    try {
      const reg = await navigator.serviceWorker.ready
      if ('sync' in reg) {
        await (reg as any).sync.register('sync-tracking-points')
      }
    } catch (err) {
      failureLogger.log('sync_failed', `Background sync registration failed: ${err instanceof Error ? err.message : String(err)}`, { sessionId: this._sessionId })
    }
  }

  async start(sessionId: string, employeeId?: string, intervalSeconds?: number) {
    this._sessionId = sessionId
    if (employeeId) this._employeeId = employeeId
    if (intervalSeconds && intervalSeconds > 0) {
      this._intervalSeconds = intervalSeconds
    }
    this._running = true
    this._authStored = false
    await this._storeAuth()

    if (isNative()) {
      await this._startNativeService()
    } else {
      this._startWatch()
    }

    if (!this._nativeService) {
      this._flushInterval = setInterval(() => this._flush(), 30000)
    }

    heartbeatService.setEmployeeId(this._employeeId)
    heartbeatService.start(this._sessionId!)
    lastSeenTracker.setSession(this._sessionId)
    lastSeenTracker.setOnline(navigator.onLine)

    this._setupListeners()

    this._flush()

    const lastLocationJson = localStorage.getItem('tracking_last_location')
    if (lastLocationJson) {
      try {
        const lastLoc = JSON.parse(lastLocationJson)
        const age = lastLoc.capturedAt ? Date.now() - new Date(lastLoc.capturedAt).getTime() : Infinity
        if (lastLoc.latitude != null && lastLoc.longitude != null && age < this._intervalSeconds * 2000) {
          this._captureFromPositionImmediate(lastLoc)
        }
      } catch {}
    }

    this._notify()

    if (!navigator.onLine) {
      failureLogger.log({ category: 'offline', detail: 'Tracking started while offline', sessionId: this._sessionId })
    }

    this._recoverSessionIfNeeded()
  }

  async stop() {
    this._running = false

    if (this._nativeService) {
      await this._stopNativeService()
    }

    heartbeatService.stop()
    lastSeenTracker.clear()
    try { localStorage.removeItem('tracking_last_location') } catch {}
    this._sessionId = null
    this._employeeId = null
    this._authStored = false
    this._stopWatch()
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null }
    if (this._flushInterval) { clearInterval(this._flushInterval); this._flushInterval = null }
    this._gpsDeniedLogged = false
    this._wasHidden = false
    this._teardownListeners()
    this._notify()
  }

  setInterval(seconds: number) {
    this._intervalSeconds = seconds
    this._notify()
  }

  async checkBatteryOptimization(): Promise<boolean> {
    if (!isNative()) return false
    try {
      const { default: TrackingService } = await import('../capacitor-plugins/tracking-service')
      const { enabled } = await TrackingService.isBatteryOptimizationEnabled()
      return enabled
    } catch { return false }
  }

  async requestBatteryOptimizationDisable() {
    if (!isNative()) return
    try {
      const { default: TrackingService } = await import('../capacitor-plugins/tracking-service')
      await TrackingService.requestDisableBatteryOptimization()
    } catch {}
  }

  async openBatterySettings() {
    if (!isNative()) return
    try {
      const { default: TrackingService } = await import('../capacitor-plugins/tracking-service')
      await TrackingService.openBatterySettings()
    } catch {}
  }

  private async _startNativeService() {
    try {
      const { default: TrackingService } = await import('../capacitor-plugins/tracking-service')
      const token = getToken()
      if (!token || !this._sessionId) {
        failureLogger.log('gps_denied', `Native service not started: missing ${!token ? 'token' : 'sessionId'}`, { sessionId: this._sessionId })
        this._nativeService = false
        this._startWatch()
        return
      }
      await TrackingService.start({
        sessionId: this._sessionId,
        token,
        supabaseUrl: SUPABASE_URL,
        anonKey: SUPABASE_ANON_KEY,
        intervalSeconds: this._intervalSeconds,
      })
      this._nativeService = true
      this._gpsAvailable = true
      this._warnBatteryOptimization()
    } catch (err) {
      console.error('[trackingEngine] Failed to start native service, falling back to browser GPS:', err)
      this._nativeService = false
      this._startWatch()
    }
  }

  private async _warnBatteryOptimization() {
    try {
      const { default: TrackingService } = await import('../capacitor-plugins/tracking-service')
      const { enabled } = await TrackingService.isBatteryOptimizationEnabled()
      if (enabled) {
        console.warn('[trackingEngine] Battery optimization is enabled — tracking may be killed in background')
      }
    } catch {}
  }

  private async _stopNativeService() {
    try {
      const { default: TrackingService } = await import('../capacitor-plugins/tracking-service')
      await TrackingService.stop()
    } catch {}
    this._nativeService = false
  }

  private _startWatch() {
    if (gpsService.isWatching()) return
    if (!('geolocation' in navigator)) return
    this._gpsDeniedLogged = false
    gpsService.startWatching({
      onLocation: (loc) => {
        this._lastPosition = { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, altitude: null, heading: null, speed: null }
        lastSeenTracker.setGps({ accuracy: loc.accuracy, timestamp: loc.capturedAt })
        this._gpsAvailable = true
        this._gpsAccuracy = loc.accuracy
        if (this._intervalId == null && this._running) {
          this._captureFromPositionImmediate(loc)
          this._intervalId = setInterval(() => {
            const last = gpsService.getLastKnownLocation()
            if (last) {
              this._captureFromPositionImmediate(last)
            }
          }, this._intervalSeconds * 1000)
        }
        this._notify()
      },
      onError: (err) => {
        this._gpsAvailable = false
        this._gpsAccuracy = null
        if (!this._gpsDeniedLogged) {
          const code = err.code === 1 ? 'gps_denied' : err.code === 2 ? 'gps_unavailable' : 'gps_timeout'
          failureLogger.log({ category: code, detail: `GPS error: ${err.message}`, sessionId: this._sessionId })
          this._gpsDeniedLogged = true
        }
        this._notify()
      },
    })
    this._watchActive = true
  }

  private _stopWatch() {
    gpsService.stopWatching()
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null }
    this._watchActive = false
    this._lastPosition = null
  }

  private _captureFromPositionImmediate(loc: { latitude: number; longitude: number; accuracy: number }) {
    this._lastPointAt = new Date().toISOString()
    this._telemetry.captured++
    try {
      localStorage.setItem('tracking_last_location', JSON.stringify({
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        capturedAt: this._lastPointAt,
      }))
    } catch {}
    getBattery().then((battery) => {
      const point = {
        employee_id: this._employeeId,
        session_id: this._sessionId!,
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy_meters: loc.accuracy,
        altitude_meters: null,
        speed_mps: null,
        heading_degrees: null,
        battery_pct: battery,
        recorded_at: new Date().toISOString(),
        point_type: 'periodic' as const,
      }
      if (navigator.onLine) {
        this._sendPoints([point]).then(() => {
          this._lastSyncAt = new Date().toISOString()
          lastSeenTracker.setSync(this._lastSyncAt!)
        }).catch(() => {
          this._telemetry.queued++
          failureLogger.log('point_queued', 'Point queued after send failure', { sessionId: this._sessionId })
          trackingQueue.addPoint(point).then(() => this._registerBackgroundSync())
        })
      } else {
        this._telemetry.queued++
        trackingQueue.addPoint(point).then(() => this._registerBackgroundSync())
      }
      this._notify()
    })
  }



  private async _sendPoints(points: Array<Omit<any, 'id' | 'retries'>>) {
    const token = getToken()
    if (!token || !this._sessionId) {
      const restored = !this._sessionId ? await this._restoreSession() : false
      if (!token || (!this._sessionId && !restored)) {
        failureLogger.log('send_points_skipped', `Cannot send ${points.length} points: missing ${!token ? 'token' : 'sessionId'}. Points queued for retry.`, { sessionId: this._sessionId, count: points.length })
        this._telemetry.dropped += points.length
        throw new Error(`Cannot send points: ${!token ? 'no token' : 'no sessionId'}`)
      }
    }

    const invalid = points.filter((p) => p.latitude == null || p.longitude == null)
    const validPoints = points.filter((p) => p.latitude != null && p.longitude != null)

    if (invalid.length > 0) {
      failureLogger.log('send_points_invalid', `${invalid.length} of ${points.length} points have null lat/lng`, { sessionId: this._sessionId, count: invalid.length })
    }

    if (validPoints.length === 0) {
      failureLogger.log('send_points_invalid', `All ${points.length} points have null lat/lng — throwing for retry`, { sessionId: this._sessionId })
      this._telemetry.dropped += points.length
      throw new Error('No valid points to send')
    }

    const { error } = await supabase.rpc('sync_tracking_points', {
      p_token: token,
      p_session_id: this._sessionId,
      p_points: validPoints.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy_meters: p.accuracy_meters,
        altitude_meters: p.altitude_meters,
        speed_mps: p.speed_mps,
        heading_degrees: p.heading_degrees,
        battery_pct: p.battery_pct,
        recorded_at: p.recorded_at,
        point_type: p.point_type,
      })),
    })
    if (error) {
      failureLogger.log('sync_failed', `sync_tracking_points RPC error: ${error.message}`, { sessionId: this._sessionId, count: validPoints.length })
      throw error
    }
    this._telemetry.synced += validPoints.length
  }

  private async _flush() {
    if (!navigator.onLine) {
      this._telemetry.failed++
      return
    }
    if (!this._sessionId) {
      await this._restoreSession()
    }
    const pending = await trackingQueue.getPending()
    if (pending.length === 0) return
    const batchSize = 50
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize)
      try {
        await this._sendPoints(batch)
        await trackingQueue.removePoints(
          batch.filter((p) => p.id != null).map((p) => p.id!)
        )
        this._lastSyncAt = new Date().toISOString()
        lastSeenTracker.setSync(this._lastSyncAt)
      } catch (err) {
        failureLogger.log('flush_failed', `Flush batch failed: ${err instanceof Error ? err.message : String(err)}`, { sessionId: this._sessionId, batchSize: batch.length })
        await trackingQueue.incrementRetries(
          batch.filter((p) => p.id != null).map((p) => p.id!)
        )
        break
      }
    }
    this._notify()
  }

  private _setupListeners() {
    this._onlineHandler = () => {
      lastSeenTracker.setOnline(true)
      failureLogger.log({ category: 'online_recovered', detail: 'Connection restored', sessionId: this._sessionId })
      this._flush()
      this._registerBackgroundSync()
      this._notify()
    }
    window.addEventListener('online', this._onlineHandler)

    const offlineHandler = () => {
      lastSeenTracker.setOnline(false)
      failureLogger.log({ category: 'offline', detail: 'Connection lost', sessionId: this._sessionId })
      this._notify()
    }
    window.addEventListener('offline', offlineHandler)

    this._visibilityHandler = () => {
      const hidden = document.visibilityState !== 'visible'

      if (hidden) {
        this._wasHidden = true
        failureLogger.log({ category: 'tab_suspended', detail: 'Tab hidden, tracking paused by browser', sessionId: this._sessionId })
      } else if (this._wasHidden && this._running) {
        this._wasHidden = false
        failureLogger.log({ category: 'tab_restored', detail: 'Tab visible again, recovering tracking', sessionId: this._sessionId })

        if (!gpsService.isWatching() && !isNative()) {
          this._startWatch()
        }

        const last = gpsService.getLastKnownLocation()
        if (last) {
          this._captureFromPositionImmediate(last)
        }
        this._flush()
        this._notify()
      }
    }
    document.addEventListener('visibilitychange', this._visibilityHandler)

    try {
      navigator.serviceWorker?.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_TRACKING_POINTS') {
          this._flush()
        }
      })
    } catch {}
  }

  private _teardownListeners() {
    if (this._onlineHandler) {
      window.removeEventListener('online', this._onlineHandler)
      this._onlineHandler = null
    }
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler)
      this._visibilityHandler = null
    }
  }

  async flushNow() {
    await this._flush()
  }

  async captureNow() {
    const last = gpsService.getLastKnownLocation()
    if (last) {
      this._captureFromPositionImmediate(last)
    } else {
      failureLogger.log({ category: 'gps_unavailable', detail: 'captureNow called but no GPS position', sessionId: this._sessionId })
    }
  }

  private async _recoverSessionIfNeeded() {
    const recoveryKey = `tracking_recovery_${this._sessionId}`
    try {
      const stored = localStorage.getItem(recoveryKey)
      if (stored) {
        const data = JSON.parse(stored)
        failureLogger.log({ category: 'session_recovered', detail: `Recovered from ${data.reason || 'unknown cause'}`, sessionId: this._sessionId })
      }
    } catch {}
    localStorage.setItem(recoveryKey, JSON.stringify({ reason: 'new_session', ts: new Date().toISOString() }))
  }

  getLastSeen() {
    return lastSeenTracker.getFull()
  }
}

export const trackingEngine = new TrackingEngine()
