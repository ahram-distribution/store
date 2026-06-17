const MAX_LOGS = 200
const STORAGE_KEY = 'pwa_tracking_failures'

export type FailureType = 'gps_denied' | 'offline' | 'tab_suspended' | 'browser_closed' | 'sync_failed' | 'heartbeat_failed' | 'visibility' | 'session_recovery' | 'send_points_skipped' | 'send_points_invalid' | 'session_restored' | 'point_queued' | 'flush_failed' | 'queue_add_failed' | 'auth_missing'

export interface FailureLog {
  id: string
  timestamp: string
  type: FailureType
  message: string
  details?: Record<string, unknown>
}

function load(): FailureLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function save(logs: FailureLog[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, MAX_LOGS)))
  } catch {}
}

export const failureLogger = {
  log(typeOrObj: FailureType | { category: string; detail: string; sessionId?: string | null }, message?: string, details?: Record<string, unknown>) {
    if (typeof typeOrObj === 'string') {
      this._log(typeOrObj, message || '', details)
    } else {
      this._log(typeOrObj.category as FailureType, typeOrObj.detail, { sessionId: typeOrObj.sessionId })
    }
  },

  _log(type: string, message: string, details?: Record<string, unknown>) {
    const logs = load()
    logs.unshift({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      type: type as FailureType,
      message,
      details,
    })
    save(logs)
  },

  getRecent(limit = 20): FailureLog[] {
    return load().slice(0, limit)
  },

  getByType(type: FailureLog['type']): FailureLog[] {
    return load().filter((l) => l.type === type)
  },

  clear() {
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  },
}
