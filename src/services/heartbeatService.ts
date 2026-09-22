export interface HeartbeatStatus {
  lastHeartbeatAt: string | null
  lastHeartbeatFailed: boolean
  consecutiveFailures: number
  running: boolean
}

export interface SessionTimeoutEvent {
  action: 'ok' | 'warning_issued' | 'warning_active' | 'warning_cleared' | 'auto_closed' | 'completed'
  reason?: string
  message?: string
  inactive_minutes?: number
  warning_remaining_seconds?: number
}

type HeartbeatListener = (status: HeartbeatStatus) => void
type SessionTimeoutListener = (event: SessionTimeoutEvent) => void

class HeartbeatService {
  private _listeners = new Set<HeartbeatListener>()
  private _timeoutListeners = new Set<SessionTimeoutListener>()
  private _running = false

  get status(): HeartbeatStatus {
    return {
      lastHeartbeatAt: null,
      lastHeartbeatFailed: false,
      consecutiveFailures: 0,
      running: this._running
    }
  }

  subscribe(fn: HeartbeatListener): () => void {
    this._listeners.add(fn)
    return () => { this._listeners.delete(fn) }
  }

  onSessionTimeout(fn: SessionTimeoutListener): () => void {
    this._timeoutListeners.add(fn)
    return () => { this._timeoutListeners.delete(fn) }
  }

  setEmployeeId(_id: string) {}

  start(_sessionId: string) {
    this._running = true
  }

  stop() {
    this._running = false
  }

  async flushQueuedHeartbeats() {}
}

export const heartbeatService = new HeartbeatService()
