import { supabase } from '../lib/supabase'
import { trackingQueue } from './trackingQueue'

const HEARTBEAT_INTERVAL = 60000
const RECONNECT_INTERVAL = 5000

export interface HeartbeatStatus {
  lastHeartbeatAt: string | null
  lastHeartbeatFailed: boolean
  consecutiveFailures: number
  running: boolean
}

export interface SessionTimeoutEvent {
  action: 'ok' | 'warning_issued' | 'warning_active' | 'auto_closed'
  reason?: string
  message?: string
  inactive_hours?: number
}

type HeartbeatListener = (status: HeartbeatStatus) => void
type SessionTimeoutListener = (event: SessionTimeoutEvent) => void

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

class HeartbeatService {
  private _intervalId: ReturnType<typeof setInterval> | null = null
  private _reconnectId: ReturnType<typeof setInterval> | null = null
  private _sessionId: string | null = null
  private _employeeId: string | null = null
  private _running = false
  private _lastHeartbeatAt: string | null = null
  private _consecutiveFailures = 0
  private _listeners: Set<HeartbeatListener> = new Set()
  private _timeoutListeners: Set<SessionTimeoutListener> = new Set()

  get status(): HeartbeatStatus {
    return {
      lastHeartbeatAt: this._lastHeartbeatAt,
      lastHeartbeatFailed: this._consecutiveFailures > 0,
      consecutiveFailures: this._consecutiveFailures,
      running: this._running,
    }
  }

  subscribe(fn: HeartbeatListener): () => void {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  onSessionTimeout(fn: SessionTimeoutListener): () => void {
    this._timeoutListeners.add(fn)
    return () => this._timeoutListeners.delete(fn)
  }

  private _notify() {
    this._listeners.forEach((fn) => fn(this.status))
  }

  private _notifyTimeout(event: SessionTimeoutEvent) {
    this._timeoutListeners.forEach((fn) => fn(event))
  }

  setEmployeeId(id: string) {
    this._employeeId = id
  }

  start(sessionId: string) {
    this._sessionId = sessionId
    this._running = true
    this._consecutiveFailures = 0
    this._doHeartbeat()
    this._intervalId = setInterval(() => this._doHeartbeat(), HEARTBEAT_INTERVAL)
    this._onlineHandler = () => this._doHeartbeat()
    window.addEventListener('online', this._onlineHandler)
    this._notify()
  }

  private _onlineHandler: (() => void) | null = null

  stop() {
    this._running = false
    this._sessionId = null
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null }
    if (this._reconnectId) { clearInterval(this._reconnectId); this._reconnectId = null }
    if (this._onlineHandler) { window.removeEventListener('online', this._onlineHandler); this._onlineHandler = null }
    this._notify()
  }

  private async _doHeartbeat() {
    if (!this._sessionId) return
    const token = getToken()
    if (!token) { this._onFail('NO_TOKEN'); return }

    try {
      const { error } = await supabase.rpc('record_heartbeat', {
        p_token: token,
        p_session_id: this._sessionId,
      })
      if (error) throw error
      this._lastHeartbeatAt = new Date().toISOString()
      this._consecutiveFailures = 0
      this._onSuccess()

      const { data: timeoutData } = await supabase.rpc('check_session_timeout', {
        p_token: token,
        p_session_id: this._sessionId,
      })
      if (timeoutData && typeof timeoutData === 'object' && (timeoutData as any).action !== 'ok') {
        this._notifyTimeout(timeoutData as SessionTimeoutEvent)
        if ((timeoutData as any).action === 'auto_closed') {
          this.stop()
        }
      }
    } catch (err) {
      this._onFail(err instanceof Error ? err.message : 'UNKNOWN')
      if (!navigator.onLine) {
        trackingQueue.addHeartbeat({
          employee_id: this._employeeId || '',
          session_id: this._sessionId,
          recorded_at: new Date().toISOString(),
        })
      }
    }
  }

  private _onSuccess() {
    if (this._reconnectId) {
      clearInterval(this._reconnectId)
      this._reconnectId = null
    }
    this._notify()
  }

  private _onFail(reason: string) {
    this._consecutiveFailures++
    if (this._consecutiveFailures >= 3 && !this._reconnectId && this._running) {
      this._reconnectId = setInterval(() => this._doHeartbeat(), RECONNECT_INTERVAL)
    }
    this._notify()
  }

  async flushQueuedHeartbeats() {
    const pending = await trackingQueue.getPending()
    const heartbeats = pending.filter((p) => p.point_type === 'heartbeat')
    if (heartbeats.length === 0) return
    const sessionIds = [...new Set(heartbeats.map((h) => h.session_id).filter(Boolean))]
    for (const sid of sessionIds) {
      try {
        const token = getToken()
        if (!token) continue
        await supabase.rpc('record_heartbeat', { p_token: token, p_session_id: sid })
      } catch {}
    }
    const ids = heartbeats.filter((h) => h.id != null).map((h) => h.id!)
    if (ids.length > 0) await trackingQueue.removePoints(ids)
  }
}

export const heartbeatService = new HeartbeatService()
