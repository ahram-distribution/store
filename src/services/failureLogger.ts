const MAX_LOGS = 100
const STORAGE_KEY = 'pwa_tracking_failures'

export interface FailureLog {
  id: string
  timestamp: string
  type: 'gps_denied' | 'offline' | 'tab_suspended' | 'browser_closed' | 'sync_failed' | 'heartbeat_failed' | 'visibility' | 'session_recovery'
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
  log(type: FailureLog['type'], message: string, details?: Record<string, unknown>) {
    const logs = load()
    logs.unshift({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      type,
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
